import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Enable console logging
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', req => console.log('REQUEST FAILED:', req.url(), req.failure()?.errorText));
  
  console.log('Loading frontend...');
  await page.goto('https://p01--frontend--h769bkzvfdpf.code.run', { waitUntil: 'networkidle' });
  
  console.log('\nPage title:', await page.title());
  
  // Check for any failed API requests
  console.log('\nWaiting for network activity...');
  await page.waitForTimeout(5000);
  
  // Get page content status
  const statusText = await page.$eval('[class*="status"]', el => el.textContent).catch(() => 'not found');
  console.log('Status element:', statusText);
  
  // Screenshot for debugging
  await page.screenshot({ path: '/tmp/frontend-test.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/frontend-test.png');
  
  await browser.close();
}

test().catch(console.error);
