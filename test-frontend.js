const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push('Console Error: ' + msg.text());
    }
  });

  // Capture page errors
  page.on('pageerror', err => {
    errors.push('Page Error: ' + err.message);
  });

  console.log('Loading frontend...');

  try {
    await page.goto('https://p01--frontend--h769bkzvfdpf.code.run', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait a bit for JS to execute
    await page.waitForTimeout(5000);

    // Wait for potential React hydration
    await page.waitForTimeout(3000);

    // Check for error message in page
    const errorText = await page.locator('text=Application error').count();
    if (errorText > 0) {
      console.log('Found "Application error" on page');

      // Try to get more error details
      const bodyText = await page.textContent('body');
      console.log('Page content preview:', bodyText.substring(0, 500));
    }

    // Check if main content loaded
    const hasLeaderboard = await page.locator('text=Top 10 Traders').count();
    const hasSimulator = await page.locator('text=Copy Trading Simulator').count();

    console.log('Has Leaderboard section:', hasLeaderboard > 0);
    console.log('Has Simulator section:', hasSimulator > 0);

    // Take screenshot
    await page.screenshot({ path: '/tmp/frontend-test.png', fullPage: true });
    console.log('Screenshot saved to /tmp/frontend-test.png');

  } catch (e) {
    errors.push('Navigation Error: ' + e.message);
  }

  if (errors.length > 0) {
    console.log('\n=== ERRORS FOUND ===');
    errors.forEach(e => console.log(e));
  } else {
    console.log('\nNo errors captured');
  }

  await browser.close();
})();
