/**
 * Polymarket Tracker - Automated Deployment via Northflank API
 *
 * Prerequisites:
 * 1. Get your Northflank API token from: Account Settings > API > Tokens
 * 2. Create a GitHub repo and push the code
 * 3. Set environment variables:
 *    - NORTHFLANK_API_TOKEN: Your Northflank API token
 *    - GITHUB_REPO_URL: Full HTTPS URL to your GitHub repo
 *
 * Run with: node deploy-api.mjs
 */

import { ApiClient, ApiClientInMemoryContextProvider } from '@northflank/js-client';
import { execSync } from 'child_process';
import * as readline from 'readline';

// Configuration
const CONFIG = {
  projectName: 'polymarketSim',
  projectDescription: 'Real-time Polymarket trader monitoring and copy trading simulator',
  region: 'europe-west',

  database: {
    name: 'postgres',
    type: 'postgres',
    version: '16-latest',
    plan: 'nf-compute-20', // Minimum for PostgreSQL (0.2 CPU)
    storage: 4096, // 4GB
  },

  backend: {
    name: 'backend',
    dockerfile: '/backend/Dockerfile',
    buildContext: '/backend',
    port: 3001,
    healthPath: '/api/health',
    plan: 'nf-compute-10',
    instances: 1,
    envVars: {
      NODE_ENV: 'production',
      PORT: '3001',
      POLYMARKET_DATA_API: 'https://data-api.polymarket.com',
      POLYMARKET_CLOB_API: 'https://clob.polymarket.com',
      POLYMARKET_GAMMA_API: 'https://gamma-api.polymarket.com',
      POLYMARKET_WS_TRADES: 'wss://ws-live-data.polymarket.com',
      POLYMARKET_WS_ORDERBOOK: 'wss://ws-subscriptions-clob.polymarket.com/ws/',
      TRADE_BACKFILL_DAYS: '7',
      GBP_USD_RATE: '1.27',
    },
  },

  frontend: {
    name: 'frontend',
    dockerfile: '/frontend/Dockerfile',
    buildContext: '/frontend',
    port: 3000,
    plan: 'nf-compute-10',
    instances: 1,
  },
};

// Utilities
function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`${colors[type]}[${timestamp}] ${message}${colors.reset}`);
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStatus(checkFn, targetStatus, maxWaitMs = 300000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const status = await checkFn();
    if (status === targetStatus || status === 'running' || status === 'COMPLETED') {
      return true;
    }
    if (status === 'FAILED' || status === 'error') {
      throw new Error(`Deployment failed with status: ${status}`);
    }
    log(`Current status: ${status}, waiting...`);
    await sleep(10000);
  }
  throw new Error('Timeout waiting for deployment');
}

// Main deployment functions
async function createGitHubRepo(repoName) {
  log('Creating GitHub repository...');

  try {
    // Check if gh CLI is available
    execSync('gh --version', { stdio: 'pipe' });

    // Create repo using gh CLI
    execSync(`cd .. && gh repo create ${repoName} --public --source=. --push`, {
      stdio: 'inherit',
    });

    // Get the repo URL
    const repoUrl = execSync(`cd .. && gh repo view --json url -q .url`, { encoding: 'utf-8' }).trim();
    log(`GitHub repo created: ${repoUrl}`, 'success');
    return repoUrl;
  } catch (error) {
    log('GitHub CLI not available or not authenticated', 'warn');
    log('Please create a GitHub repo manually and push the code', 'warn');

    const repoUrl = await prompt('Enter your GitHub repository URL (https://github.com/username/repo): ');

    if (repoUrl) {
      try {
        execSync(`cd .. && git remote add origin ${repoUrl} 2>/dev/null || git remote set-url origin ${repoUrl}`);
        execSync(`cd .. && git push -u origin main`, { stdio: 'inherit' });
        log('Code pushed to GitHub', 'success');
      } catch (e) {
        log('Failed to push. Please push manually: git push -u origin main', 'warn');
      }
    }

    return repoUrl;
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║       POLYMARKET TRACKER - NORTHFLANK API DEPLOYMENT           ║
╠════════════════════════════════════════════════════════════════╣
║  This script will:                                             ║
║  1. Create/push to GitHub repository                           ║
║  2. Create Northflank project                                  ║
║  3. Create PostgreSQL database addon                           ║
║  4. Deploy backend service                                     ║
║  5. Deploy frontend service                                    ║
╚════════════════════════════════════════════════════════════════╝
`);

  // Get API token
  let apiToken = process.env.NORTHFLANK_API_TOKEN;
  if (!apiToken) {
    log('NORTHFLANK_API_TOKEN not set in environment', 'warn');
    apiToken = await prompt('Enter your Northflank API token: ');
  }

  if (!apiToken) {
    log('API token is required. Get it from: Northflank > Account Settings > API > Tokens', 'error');
    process.exit(1);
  }

  // Initialize Northflank client
  log('Initializing Northflank API client...');
  const contextProvider = new ApiClientInMemoryContextProvider();
  await contextProvider.addContext({
    name: 'deployment',
    token: apiToken,
  });

  const api = new ApiClient(contextProvider);

  try {
    // Test API connection by listing projects
    log('Testing API connection...');
    const projectsList = await api.list.projects({});
    console.log('API Response:', JSON.stringify(projectsList, null, 2).slice(0, 500));
    const projects = projectsList?.data?.projects || projectsList?.projects || [];
    log(`Connected successfully. Found ${projects.length} existing projects.`, 'success');
  } catch (error) {
    log(`API connection failed: ${error.message}`, 'error');
    console.error('Full error:', error);
    process.exit(1);
  }

  // Get or create GitHub repo
  let githubRepoUrl = process.env.GITHUB_REPO_URL;
  if (!githubRepoUrl) {
    githubRepoUrl = await createGitHubRepo(CONFIG.projectName);
  }

  if (!githubRepoUrl) {
    log('GitHub repository URL is required', 'error');
    process.exit(1);
  }

  // Parse GitHub info
  const githubMatch = githubRepoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
  if (!githubMatch) {
    log('Invalid GitHub URL format', 'error');
    process.exit(1);
  }
  const [, githubOwner, githubRepo] = githubMatch;
  log(`GitHub: ${githubOwner}/${githubRepo}`);

  try {
    // Step 1: Get or Create Project
    log('Looking for Northflank project...');
    let project;

    // First try to get the project directly by name
    try {
      log(`Attempting to get project: ${CONFIG.projectName}`);
      const projectResult = await api.get.project({
        parameters: { projectId: CONFIG.projectName },
      });
      console.log('Get project response:', JSON.stringify(projectResult, null, 2).slice(0, 1000));
      project = projectResult.data || projectResult;
      log(`Found existing project: ${project.name || project.id}`, 'success');
    } catch (getError) {
      console.log('Get project error:', getError.message);
      console.log('Full error:', JSON.stringify(getError, null, 2).slice(0, 500));
      log(`Project not found by name, trying to create...`);

      try {
        const createResult = await api.create.project({
          data: {
            name: CONFIG.projectName,
            description: CONFIG.projectDescription,
            region: CONFIG.region,
          },
        });

        if (createResult.error) {
          throw new Error(`API Error ${createResult.error.status}: ${createResult.error.message}`);
        }

        project = createResult.data || createResult;
        log(`Project created: ${project.name || project.id}`, 'success');
      } catch (error) {
        console.log('Create project error:', error.message);
        if (error.message?.includes('already exists') || error.message?.includes('409')) {
          log('Project already exists, fetching...', 'warn');
          const projectsResult = await api.list.projects({});
          const projects = projectsResult.data?.projects || projectsResult.projects || [];
          project = projects.find(p => p.name === CONFIG.projectName);
          if (!project) {
            throw new Error('Could not find existing project');
          }
        } else if (error.message?.includes('401')) {
          log('Token does not have permission to create projects.', 'error');
          log('Please create the project manually in Northflank UI with name: ' + CONFIG.projectName, 'error');
          log('Then re-run this script.', 'error');
          throw error;
        } else {
          throw error;
        }
      }
    }

    const projectId = project.id || project.name;
    log(`Using project ID: ${projectId}`);

    // Step 2: Create or get PostgreSQL Addon
    log('Setting up PostgreSQL database...');
    let addon;

    // First check if addon already exists
    try {
      const existingAddons = await api.list.addons({ parameters: { projectId } });
      const addonsList = existingAddons.data?.addons || existingAddons.addons || [];
      const existingAddon = addonsList.find(a => a.name === CONFIG.database.name);

      if (existingAddon) {
        addon = { data: existingAddon };
        log(`Database addon already exists: ${existingAddon.name}`, 'success');
      }
    } catch (e) {
      log(`Could not check existing addons: ${e.message}`, 'warn');
    }

    // Create addon if it doesn't exist
    if (!addon) {
      try {
        const addonResult = await api.create.addon({
          parameters: { projectId },
          data: {
            name: CONFIG.database.name,
            type: CONFIG.database.type,
            version: CONFIG.database.version,
            billing: {
              deploymentPlan: CONFIG.database.plan,
              storage: CONFIG.database.storage,
              replicas: 1,
            },
          },
        });
        console.log('Addon creation response:', JSON.stringify(addonResult, null, 2).slice(0, 1000));

        if (addonResult.error) {
          throw new Error(`API Error ${addonResult.error.status}: ${addonResult.error.message}`);
        }

        addon = { data: addonResult.data || addonResult };
        log(`Database addon created: ${addon.data?.name || CONFIG.database.name}`, 'success');
      } catch (error) {
        console.log('Addon creation error:', error.message);
        throw error;
      }
    }

    // Wait for addon to be ready
    log('Waiting for database to be ready...');
    await sleep(10000);

    // Get addon connection details
    let databaseUrl = '';
    try {
      const addonDetails = await api.get.addon({
        parameters: { projectId, addonId: addon.data.id || CONFIG.database.name },
      });

      // Try to get connection string from various possible locations
      const connDetails = addonDetails.data.status?.connectionDetails ||
                         addonDetails.data.connectionDetails ||
                         {};

      if (connDetails.uri) {
        databaseUrl = connDetails.uri;
      } else if (connDetails.host) {
        const { host, port, username, password, database } = connDetails;
        databaseUrl = `postgres://${username}:${password}@${host}:${port}/${database}`;
      }

      if (databaseUrl) {
        log('Database connection string obtained', 'success');
      } else {
        // Use Northflank's environment variable interpolation
        databaseUrl = '${NF_POSTGRES_URI}';
        log('Will use Northflank env var interpolation for DB connection', 'info');
      }
    } catch (error) {
      log(`Could not get connection details: ${error.message}`, 'warn');
      databaseUrl = '${NF_POSTGRES_URI}';
    }

    // Step 3: Create or get Backend Service
    log('Setting up backend service...');
    let backendService;

    // First check if service already exists
    try {
      const existingServices = await api.list.services({ parameters: { projectId } });
      const servicesList = existingServices.data?.services || existingServices.services || [];
      const existingBackend = servicesList.find(s => s.name === CONFIG.backend.name);

      if (existingBackend) {
        backendService = { data: existingBackend };
        log(`Backend service already exists: ${existingBackend.name}`, 'success');
      }
    } catch (e) {
      log(`Could not check existing services: ${e.message}`, 'warn');
    }

    // Create service if it doesn't exist
    if (!backendService) {
      try {
        const backendResult = await api.create.service.combined({
          parameters: { projectId },
          data: {
            name: CONFIG.backend.name,
            description: 'Polymarket Tracker API Backend',
            billing: {
              deploymentPlan: CONFIG.backend.plan,
            },
            deployment: {
              instances: CONFIG.backend.instances,
            },
            ports: [
              {
                name: 'p01',
                internalPort: CONFIG.backend.port,
                public: true,
                protocol: 'HTTP',
              },
            ],
            vcsData: {
              projectUrl: githubRepoUrl,
              projectType: 'github',
              projectBranch: 'main',
            },
            buildConfiguration: {
              dockerfile: {
                dockerFilePath: CONFIG.backend.dockerfile,
                dockerWorkDir: CONFIG.backend.buildContext,
              },
            },
            runtimeEnvironment: {
              ...CONFIG.backend.envVars,
              DATABASE_URL: databaseUrl,
            },
          },
        });
        console.log('Backend service response:', JSON.stringify(backendResult, null, 2).slice(0, 1500));

        if (backendResult.error) {
          throw new Error(`API Error ${backendResult.error.status}: ${backendResult.error.message}`);
        }

        backendService = { data: backendResult.data || backendResult };
        log(`Backend service created: ${backendService.data?.name || CONFIG.backend.name}`, 'success');
      } catch (error) {
        console.log('Backend service error:', error.message);
        throw error;
      }
    }

    // Get backend URL
    let backendUrl = '';
    try {
      const backendDetails = await api.get.service({
        parameters: { projectId, serviceId: backendService.data.id || CONFIG.backend.name },
      });
      const ports = backendDetails.data.ports || [];
      const httpPort = ports.find(p => p.public);
      if (httpPort?.dns) {
        backendUrl = `https://${httpPort.dns}`;
      }
    } catch (error) {
      log('Could not get backend URL yet', 'warn');
    }

    if (!backendUrl) {
      // Construct expected URL
      backendUrl = `https://${CONFIG.backend.name}--${CONFIG.projectName}.code.run`;
    }
    log(`Backend URL: ${backendUrl}`, 'info');

    // Step 4: Create or get Frontend Service
    log('Setting up frontend service...');
    let frontendService;

    // Check if frontend already exists (reuse the services list we got earlier)
    try {
      const existingServices = await api.list.services({ parameters: { projectId } });
      const servicesList = existingServices.data?.services || existingServices.services || [];
      const existingFrontend = servicesList.find(s => s.name === CONFIG.frontend.name);

      if (existingFrontend) {
        frontendService = { data: existingFrontend };
        log(`Frontend service already exists: ${existingFrontend.name}`, 'success');
      }
    } catch (e) {
      log(`Could not check existing frontend: ${e.message}`, 'warn');
    }

    if (!frontendService) {
      try {
        const frontendResult = await api.create.service.combined({
          parameters: { projectId },
          data: {
            name: CONFIG.frontend.name,
            description: 'Polymarket Tracker Dashboard',
            billing: {
              deploymentPlan: CONFIG.frontend.plan,
            },
            deployment: {
              instances: CONFIG.frontend.instances,
            },
            ports: [
              {
                name: 'p01',
                internalPort: CONFIG.frontend.port,
                public: true,
                protocol: 'HTTP',
              },
            ],
            vcsData: {
              projectUrl: githubRepoUrl,
              projectType: 'github',
              projectBranch: 'main',
            },
            buildConfiguration: {
              dockerfile: {
                dockerFilePath: CONFIG.frontend.dockerfile,
                dockerWorkDir: CONFIG.frontend.buildContext,
              },
              buildArguments: {
                NEXT_PUBLIC_API_URL: backendUrl,
              },
            },
            runtimeEnvironment: {
              NEXT_PUBLIC_API_URL: backendUrl,
            },
          },
        });
        console.log('Frontend service response:', JSON.stringify(frontendResult, null, 2).slice(0, 1500));

        if (frontendResult.error) {
          throw new Error(`API Error ${frontendResult.error.status}: ${frontendResult.error.message}`);
        }

        frontendService = { data: frontendResult.data || frontendResult };
        log(`Frontend service created: ${frontendService.data?.name || CONFIG.frontend.name}`, 'success');
      } catch (error) {
        console.log('Frontend service error:', error.message);
        throw error;
      }
    }

    // Get frontend URL
    let frontendUrl = `https://${CONFIG.frontend.name}--${CONFIG.projectName}.code.run`;

    // Note: Addon linking is done via the Northflank UI or by using the connection string directly
    // The DATABASE_URL environment variable is already set with the connection string

    // Summary
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT INITIATED!                        ║
╠════════════════════════════════════════════════════════════════╣
║  Services are now building and deploying.                      ║
║  This may take 5-10 minutes for the first deployment.          ║
╚════════════════════════════════════════════════════════════════╝

📦 GitHub Repository:
   ${githubRepoUrl}

🗄️  Database:
   PostgreSQL addon: ${CONFIG.database.name}

🖥️  Backend API:
   ${backendUrl}
   Health check: ${backendUrl}/api/health

🌐 Frontend Dashboard:
   ${frontendUrl}

📊 Northflank Dashboard:
   https://app.northflank.com/projects/${CONFIG.projectName}

⏳ Next Steps:
   1. Wait for builds to complete (check Northflank dashboard)
   2. Backend will auto-run database migrations on first start
   3. Backend will backfill 7 days of Polymarket trade data
   4. Access the dashboard at the frontend URL

⚠️  IMPORTANT:
   The first build may take 5-10 minutes.
   Monitor progress at: https://app.northflank.com/projects/${CONFIG.projectName}/services

`);

  } catch (error) {
    log(`Deployment error: ${error.message}`, 'error');
    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2));
    }
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  log(`Fatal error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
