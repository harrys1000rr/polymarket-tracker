const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading frontend...');
  await page.goto('https://p01--frontend--h769bkzvfdpf.code.run', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(5000);

  // Wait for leaderboard to load
  try {
    await page.waitForSelector('text=Top 10 Traders', { timeout: 20000 });
    console.log('Leaderboard loaded');
  } catch (e) {
    console.log('Leaderboard not found, checking page state...');
    await page.screenshot({ path: '/tmp/wallet-debug.png', fullPage: true });
    await browser.close();
    return;
  }

  // Click on first trader row
  const firstRow = page.locator('tbody tr').first();
  await firstRow.click();
  console.log('Clicked on first trader');

  // Wait for wallet details panel to appear
  await page.waitForTimeout(2000);

  // Check if recent trades section appears
  const hasRecentTrades = await page.locator('text=Recent Trades').count();
  console.log('Has Recent Trades section:', hasRecentTrades > 0);

  // Take screenshot
  await page.screenshot({ path: '/tmp/wallet-details.png', fullPage: true });
  console.log('Screenshot saved to /tmp/wallet-details.png');

  await browser.close();
})();
