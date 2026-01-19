const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const start = Date.now();

  await page.goto('https://p01--frontend--h769bkzvfdpf.code.run', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for either loading state or actual content
  const loadingSelector = 'text=Loading leaderboard';
  const contentSelector = 'text=Top 10 Traders';

  // Check initial state
  const hasLoading = await page.locator(loadingSelector).count();
  console.log('Initial state (' + (Date.now() - start) + 'ms): Loading spinner = ' + (hasLoading > 0));

  // Wait for content to appear
  try {
    await page.waitForSelector(contentSelector, { timeout: 15000 });
    console.log('Content loaded at: ' + (Date.now() - start) + 'ms');
  } catch (e) {
    console.log('Content did not load within 15s');
  }

  // Check if loading spinner is still visible
  const stillLoading = await page.locator(loadingSelector).count();
  console.log('Final state: Loading spinner = ' + (stillLoading > 0));

  await page.screenshot({ path: '/tmp/frontend-load.png' });

  await browser.close();
})();
