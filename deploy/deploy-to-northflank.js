/**
 * Automated Deployment Script for Polymarket Tracker
 * Uses Playwright to automate GitHub and Northflank deployment
 *
 * Run with: node deploy-to-northflank.js
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const readline = require('readline');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..');
const REPO_NAME = 'polymarket-tracker';
const PROJECT_NAME = 'polymarket-tracker';

// Configuration
const CONFIG = {
  github: {
    repoName: REPO_NAME,
    description: 'Real-time Polymarket trader monitoring and copy trading simulator',
    isPrivate: false,
  },
  northflank: {
    projectName: PROJECT_NAME,
    region: 'europe-west', // or 'us-east', 'us-west'
    backend: {
      name: 'backend',
      port: 3001,
      resources: { cpu: 0.5, memory: 512 },
      healthPath: '/api/health',
      dockerfile: '/backend/Dockerfile',
      context: '/backend',
    },
    frontend: {
      name: 'frontend',
      port: 3000,
      resources: { cpu: 0.25, memory: 256 },
      dockerfile: '/frontend/Dockerfile',
      context: '/frontend',
    },
    database: {
      name: 'postgres',
      type: 'postgresql',
      tier: 'nf-compute-10',
    },
  },
};

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };
  console.log(`${colors[type]}[${type.toUpperCase()}]${colors.reset} ${message}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createGitHubRepo(page) {
  log('Creating GitHub repository...');

  // Navigate to GitHub new repo page
  await page.goto('https://github.com/new');

  // Check if we need to log in
  if (page.url().includes('login')) {
    log('Please log in to GitHub in the browser window...', 'warn');
    await page.waitForURL('https://github.com/new', { timeout: 300000 });
    log('Logged in to GitHub', 'success');
  }

  // Fill in repo details
  await page.fill('input[data-testid="repository-name-input"]', CONFIG.github.repoName);
  await sleep(1000);

  // Wait for name validation
  await page.waitForSelector('[data-testid="repository-name-input"]:not([aria-invalid="true"])', { timeout: 10000 }).catch(() => {});

  // Set description
  const descInput = await page.$('input[name="Description"]');
  if (descInput) {
    await descInput.fill(CONFIG.github.description);
  }

  // Select public/private
  if (CONFIG.github.isPrivate) {
    await page.click('input[type="radio"][value="private"]');
  } else {
    await page.click('input[type="radio"][value="public"]');
  }

  // Create repository
  await page.click('button[data-testid="create-repository-button"]');

  // Wait for repo to be created
  await page.waitForURL(`https://github.com/**/${CONFIG.github.repoName}`, { timeout: 30000 });

  const repoUrl = page.url();
  log(`GitHub repository created: ${repoUrl}`, 'success');

  return repoUrl;
}

async function pushToGitHub(repoUrl) {
  log('Pushing code to GitHub...');

  // Extract the SSH/HTTPS URL
  const httpsUrl = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`;

  try {
    execSync(`cd "${PROJECT_DIR}" && git remote add origin ${httpsUrl} 2>/dev/null || git remote set-url origin ${httpsUrl}`);
    execSync(`cd "${PROJECT_DIR}" && git branch -M main`);
    execSync(`cd "${PROJECT_DIR}" && git push -u origin main`, { stdio: 'inherit' });
    log('Code pushed to GitHub', 'success');
    return true;
  } catch (error) {
    log(`Failed to push: ${error.message}`, 'error');
    return false;
  }
}

async function deployToNorthflank(page, githubRepoUrl) {
  log('Starting Northflank deployment...');

  // Navigate to Northflank
  await page.goto('https://app.northflank.com');

  // Check if we need to log in
  if (page.url().includes('login') || page.url().includes('auth')) {
    log('Please log in to Northflank in the browser window...', 'warn');
    log('(You can use GitHub OAuth for quick login)', 'info');

    // Wait for redirect to dashboard
    await page.waitForURL('**/projects**', { timeout: 300000 });
    log('Logged in to Northflank', 'success');
  }

  await sleep(2000);

  // Step 1: Create new project
  log('Creating Northflank project...');

  // Click "New Project" button
  const newProjectBtn = await page.waitForSelector('button:has-text("New project"), a:has-text("New project"), [data-testid*="new-project"]', { timeout: 10000 }).catch(() => null);
  if (newProjectBtn) {
    await newProjectBtn.click();
  } else {
    // Try direct navigation
    await page.goto('https://app.northflank.com/create/project');
  }

  await sleep(1000);

  // Fill project name
  const projectNameInput = await page.waitForSelector('input[name="name"], input[placeholder*="name" i], input[id*="name" i]', { timeout: 10000 });
  await projectNameInput.fill(CONFIG.northflank.projectName);

  // Select region if available
  const regionSelector = await page.$('select[name="region"], [data-testid*="region"]');
  if (regionSelector) {
    await regionSelector.selectOption({ label: new RegExp(CONFIG.northflank.region, 'i') }).catch(() => {});
  }

  // Create project
  const createBtn = await page.waitForSelector('button:has-text("Create project"), button[type="submit"]');
  await createBtn.click();

  // Wait for project to be created
  await page.waitForURL(`**/projects/${CONFIG.northflank.projectName}**`, { timeout: 30000 });
  log('Project created', 'success');

  await sleep(2000);

  // Step 2: Add PostgreSQL database
  log('Adding PostgreSQL database...');

  // Navigate to addons
  await page.click('a:has-text("Add-ons"), [data-testid*="addon"]').catch(async () => {
    await page.goto(`https://app.northflank.com/projects/${CONFIG.northflank.projectName}/addons`);
  });

  await sleep(1000);

  // Click add database
  const addDbBtn = await page.waitForSelector('button:has-text("Add addon"), button:has-text("Create addon"), a:has-text("Add addon")', { timeout: 10000 });
  await addDbBtn.click();

  await sleep(1000);

  // Select PostgreSQL
  await page.click('[data-testid*="postgresql"], div:has-text("PostgreSQL"):not(:has-text("MySQL"))').catch(async () => {
    await page.click('text=PostgreSQL');
  });

  await sleep(500);

  // Fill addon name
  const addonNameInput = await page.$('input[name="name"]');
  if (addonNameInput) {
    await addonNameInput.fill(CONFIG.northflank.database.name);
  }

  // Create addon
  const createAddonBtn = await page.waitForSelector('button:has-text("Create"), button[type="submit"]');
  await createAddonBtn.click();

  // Wait for creation
  await page.waitForSelector('text=Connection details, text=Running, [data-status="running"]', { timeout: 120000 }).catch(() => {});
  log('PostgreSQL addon created', 'success');

  // Get database connection string
  await sleep(2000);
  let databaseUrl = '';

  // Try to find and copy connection string
  const connStringEl = await page.$('[data-testid*="connection-string"], code:has-text("postgres://"), pre:has-text("postgres://")');
  if (connStringEl) {
    databaseUrl = await connStringEl.textContent();
    log(`Database URL obtained`, 'success');
  }

  await sleep(1000);

  // Step 3: Create backend service
  log('Creating backend service...');

  // Navigate to services
  await page.goto(`https://app.northflank.com/projects/${CONFIG.northflank.projectName}/services`);
  await sleep(1000);

  // Create new service
  const newServiceBtn = await page.waitForSelector('button:has-text("Add service"), a:has-text("Create service")', { timeout: 10000 });
  await newServiceBtn.click();

  await sleep(1000);

  // Select "Combined" or "Deployment" service type
  await page.click('text=Combined, text=Deployment').catch(() => {});

  await sleep(500);

  // Fill service name
  const serviceNameInput = await page.waitForSelector('input[name="name"]');
  await serviceNameInput.fill(CONFIG.northflank.backend.name);

  // Connect to GitHub repo
  await page.click('text=GitHub, button:has-text("Connect"), [data-testid*="github"]').catch(() => {});

  await sleep(1000);

  // Search for our repo
  const repoSearchInput = await page.$('input[placeholder*="Search"], input[name*="repo"]');
  if (repoSearchInput) {
    await repoSearchInput.fill(CONFIG.github.repoName);
    await sleep(1000);
    await page.click(`text=${CONFIG.github.repoName}`).catch(() => {});
  }

  // Set Dockerfile path
  const dockerfileInput = await page.$('input[name*="dockerfile"], input[placeholder*="Dockerfile"]');
  if (dockerfileInput) {
    await dockerfileInput.fill(CONFIG.northflank.backend.dockerfile);
  }

  // Set context
  const contextInput = await page.$('input[name*="context"], input[placeholder*="context"]');
  if (contextInput) {
    await contextInput.fill(CONFIG.northflank.backend.context);
  }

  // Set port
  const portInput = await page.$('input[name*="port"]');
  if (portInput) {
    await portInput.fill(String(CONFIG.northflank.backend.port));
  }

  // Add environment variables
  log('Adding environment variables...');

  // Find env vars section and add variables
  const envVars = {
    'NODE_ENV': 'production',
    'PORT': '3001',
    'DATABASE_URL': databaseUrl || '${NF_ADDON_POSTGRES_URI}',
    'POLYMARKET_DATA_API': 'https://data-api.polymarket.com',
    'POLYMARKET_CLOB_API': 'https://clob.polymarket.com',
    'POLYMARKET_GAMMA_API': 'https://gamma-api.polymarket.com',
    'POLYMARKET_WS_TRADES': 'wss://ws-live-data.polymarket.com',
    'POLYMARKET_WS_ORDERBOOK': 'wss://ws-subscriptions-clob.polymarket.com/ws/',
    'TRADE_BACKFILL_DAYS': '7',
    'GBP_USD_RATE': '1.27',
  };

  // Try to add env vars through UI
  const addEnvBtn = await page.$('button:has-text("Add variable"), button:has-text("Add environment")');
  if (addEnvBtn) {
    for (const [key, value] of Object.entries(envVars)) {
      await addEnvBtn.click();
      await sleep(300);
      const keyInput = await page.$('input[name="key"]:last-of-type, input[placeholder="KEY"]:last-of-type');
      const valueInput = await page.$('input[name="value"]:last-of-type, input[placeholder="VALUE"]:last-of-type');
      if (keyInput && valueInput) {
        await keyInput.fill(key);
        await valueInput.fill(value);
      }
    }
  }

  // Set health check
  const healthInput = await page.$('input[name*="health"], input[placeholder*="health"]');
  if (healthInput) {
    await healthInput.fill(CONFIG.northflank.backend.healthPath);
  }

  // Create service
  const createServiceBtn = await page.waitForSelector('button:has-text("Create"), button[type="submit"]:has-text("Create")');
  await createServiceBtn.click();

  // Wait for deployment
  await page.waitForSelector('text=Running, text=Deployed, [data-status="running"]', { timeout: 300000 }).catch(() => {});
  log('Backend service created and deploying', 'success');

  // Get backend URL
  await sleep(5000);
  let backendUrl = '';
  const urlEl = await page.$('a[href*="northflank.app"], code:has-text(".northflank.app")');
  if (urlEl) {
    backendUrl = await urlEl.textContent();
    backendUrl = backendUrl.match(/https?:\/\/[^\s]+/)?.[0] || '';
  }

  // Step 4: Create frontend service
  log('Creating frontend service...');

  await page.goto(`https://app.northflank.com/projects/${CONFIG.northflank.projectName}/services`);
  await sleep(1000);

  const newFrontendBtn = await page.waitForSelector('button:has-text("Add service"), a:has-text("Create service")');
  await newFrontendBtn.click();

  await sleep(1000);

  // Fill frontend service details
  const frontendNameInput = await page.waitForSelector('input[name="name"]');
  await frontendNameInput.fill(CONFIG.northflank.frontend.name);

  // Connect to same repo
  await page.click('text=GitHub').catch(() => {});
  await sleep(500);

  const frontendRepoSearch = await page.$('input[placeholder*="Search"]');
  if (frontendRepoSearch) {
    await frontendRepoSearch.fill(CONFIG.github.repoName);
    await sleep(1000);
    await page.click(`text=${CONFIG.github.repoName}`).catch(() => {});
  }

  // Set frontend Dockerfile
  const frontendDockerfile = await page.$('input[name*="dockerfile"]');
  if (frontendDockerfile) {
    await frontendDockerfile.fill(CONFIG.northflank.frontend.dockerfile);
  }

  const frontendContext = await page.$('input[name*="context"]');
  if (frontendContext) {
    await frontendContext.fill(CONFIG.northflank.frontend.context);
  }

  // Set build args for frontend
  const buildArgBtn = await page.$('button:has-text("Add build arg")');
  if (buildArgBtn && backendUrl) {
    await buildArgBtn.click();
    await sleep(300);
    const argKeyInput = await page.$('input[name="buildArgKey"]:last-of-type');
    const argValueInput = await page.$('input[name="buildArgValue"]:last-of-type');
    if (argKeyInput && argValueInput) {
      await argKeyInput.fill('NEXT_PUBLIC_API_URL');
      await argValueInput.fill(backendUrl);
    }
  }

  // Set env var
  const frontendEnvBtn = await page.$('button:has-text("Add variable")');
  if (frontendEnvBtn && backendUrl) {
    await frontendEnvBtn.click();
    await sleep(300);
    const envKeyInput = await page.$('input[name="key"]:last-of-type');
    const envValueInput = await page.$('input[name="value"]:last-of-type');
    if (envKeyInput && envValueInput) {
      await envKeyInput.fill('NEXT_PUBLIC_API_URL');
      await envValueInput.fill(backendUrl);
    }
  }

  // Set port
  const frontendPort = await page.$('input[name*="port"]');
  if (frontendPort) {
    await frontendPort.fill('3000');
  }

  // Create frontend service
  const createFrontendBtn = await page.waitForSelector('button:has-text("Create"), button[type="submit"]');
  await createFrontendBtn.click();

  // Wait for deployment
  await page.waitForSelector('text=Running, text=Deployed', { timeout: 300000 }).catch(() => {});
  log('Frontend service created and deploying', 'success');

  // Get frontend URL
  await sleep(5000);
  let frontendUrl = '';
  const frontendUrlEl = await page.$('a[href*="northflank.app"], code:has-text(".northflank.app")');
  if (frontendUrlEl) {
    frontendUrl = await frontendUrlEl.textContent();
    frontendUrl = frontendUrl.match(/https?:\/\/[^\s]+/)?.[0] || '';
  }

  return { backendUrl, frontendUrl };
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          POLYMARKET TRACKER - AUTOMATED DEPLOYMENT           ║
║                                                              ║
║  This script will:                                           ║
║  1. Create a GitHub repository                               ║
║  2. Push the code                                            ║
║  3. Deploy to Northflank (PostgreSQL + Backend + Frontend)   ║
║                                                              ║
║  You will need to log in to GitHub and Northflank when       ║
║  prompted in the browser window.                             ║
╚══════════════════════════════════════════════════════════════╝
  `);

  const proceed = await prompt('Press Enter to start deployment (or Ctrl+C to cancel)...');

  // Launch browser (not headless so user can log in)
  log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100, // Slow down for visibility
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  try {
    // Step 1: Create GitHub repo
    const githubRepoUrl = await createGitHubRepo(page);

    // Step 2: Push code to GitHub
    const pushSuccess = await pushToGitHub(githubRepoUrl);
    if (!pushSuccess) {
      throw new Error('Failed to push code to GitHub');
    }

    // Step 3: Deploy to Northflank
    const { backendUrl, frontendUrl } = await deployToNorthflank(page, githubRepoUrl);

    // Print summary
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT COMPLETE!                       ║
╚══════════════════════════════════════════════════════════════╝

📦 GitHub Repository:
   ${githubRepoUrl}

🖥️  Backend API:
   ${backendUrl || 'Check Northflank dashboard'}
   Health: ${backendUrl ? backendUrl + '/api/health' : ''}

🌐 Frontend Dashboard:
   ${frontendUrl || 'Check Northflank dashboard'}

📊 Database:
   PostgreSQL addon created in Northflank

⚠️  IMPORTANT:
   - Wait a few minutes for services to fully deploy
   - Check Northflank dashboard for deployment status
   - Backend will start backfilling 7 days of trade data

🔗 Northflank Dashboard:
   https://app.northflank.com/projects/${CONFIG.northflank.projectName}

`);

    await prompt('Press Enter to close the browser...');

  } catch (error) {
    log(`Deployment error: ${error.message}`, 'error');
    console.error(error);
    await prompt('Press Enter to close the browser...');
  } finally {
    await browser.close();
  }
}

// Run
main().catch(console.error);
