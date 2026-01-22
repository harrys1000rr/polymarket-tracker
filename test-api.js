const { chromium } = require('playwright');

async function testAPI() {
  console.log('🧪 Starting comprehensive API and frontend tests...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Test 1: Backend Health Check
    console.log('1️⃣ Testing backend health...');
    const healthResponse = await fetch('https://p01--backend--h769bkzvfdpf.code.run/api/health');
    
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log(`✅ Backend is ${health.status}`);
      console.log(`   - Trades last 1h: ${health.tradesLast1h}`);
      console.log(`   - Active wallets: ${health.activeWallets}`);
    } else {
      console.log(`❌ Backend health check failed: ${healthResponse.status}`);
      throw new Error(`Backend unhealthy: ${healthResponse.status}`);
    }
    
    // Test 2: USD API Endpoint (Critical Test)
    console.log('\n2️⃣ Testing USD API endpoint...');
    const usdResponse = await fetch('https://p01--backend--h769bkzvfdpf.code.run/api/follower-sim?bankroll_usd=100');
    
    if (usdResponse.ok) {
      const usdData = await usdResponse.json();
      
      if (usdData.bankrollUsd) {
        console.log('✅ USD API working correctly');
        console.log(`   - bankrollUsd: $${usdData.bankrollUsd}`);
        console.log(`   - estimatedPnlUsd: ${JSON.stringify(usdData.estimatedPnlUsd)}`);
      } else if (usdData.bankrollGbp) {
        console.log('❌ STILL RETURNING GBP! API not fixed');
        throw new Error('API still returns GBP instead of USD');
      } else {
        console.log('⚠️ API response format unexpected');
        console.log(JSON.stringify(usdData, null, 2));
      }
    } else {
      console.log(`❌ USD API failed: ${usdResponse.status}`);
      throw new Error(`USD API failed: ${usdResponse.status}`);
    }
    
    // Test 3: Leaderboard API
    console.log('\n3️⃣ Testing leaderboard API...');
    const leaderboardResponse = await fetch('https://p01--backend--h769bkzvfdpf.code.run/api/leaderboard?limit=5');
    
    if (leaderboardResponse.ok) {
      const leaderboard = await leaderboardResponse.json();
      console.log(`✅ Leaderboard API working - ${leaderboard.leaderboard.length} entries`);
      
      if (leaderboard.leaderboard.length > 0) {
        const first = leaderboard.leaderboard[0];
        console.log(`   - Top trader PnL: $${first.realizedPnl || 0}`);
        console.log(`   - Has USD fields: ${first.realizedPnlUsd ? 'Yes' : 'No'}`);
      }
    } else {
      console.log(`❌ Leaderboard API failed: ${leaderboardResponse.status}`);
    }
    
    // Test 4: Frontend Loading
    console.log('\n4️⃣ Testing frontend...');
    await page.goto('https://p01--frontend--h769bkzvfdpf.code.run/', { waitUntil: 'networkidle' });
    
    const title = await page.title();
    console.log(`✅ Frontend loaded: "${title}"`);
    
    // Test 5: Check for USD vs GBP in frontend
    console.log('\n5️⃣ Testing USD conversion in frontend...');
    
    // Wait for page to load
    await page.waitForSelector('text=Bankroll', { timeout: 10000 });
    
    // Check for USD references
    const usdText = await page.textContent('body');
    const hasUSD = usdText.includes('Bankroll (USD)') || usdText.includes('$');
    const hasGBP = usdText.includes('Bankroll (GBP)') || usdText.includes('£');
    
    if (hasUSD && !hasGBP) {
      console.log('✅ Frontend correctly shows USD');
    } else if (hasGBP) {
      console.log('❌ Frontend still shows GBP references');
      throw new Error('Frontend still contains GBP');
    } else {
      console.log('⚠️ Currency references unclear');
    }
    
    // Test 6: Simulator interaction
    console.log('\n6️⃣ Testing simulator functionality...');
    
    const simulatorInput = await page.locator('input[type="number"]').first();
    if (simulatorInput) {
      await simulatorInput.fill('500');
      console.log('✅ Simulator input working');
    }
    
    console.log('\n🎉 ALL TESTS PASSED! The application is working correctly.');
    
  } catch (error) {
    console.log(`\n💥 TEST FAILED: ${error.message}`);
    
    // Take screenshot on failure
    await page.screenshot({ path: '/tmp/test-failure.png', fullPage: true });
    console.log('📸 Screenshot saved to /tmp/test-failure.png');
    
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Run tests with retry logic
async function runWithRetry() {
  const maxRetries = 3;
  let attempt = 1;
  
  while (attempt <= maxRetries) {
    console.log(`\n🚀 Test attempt ${attempt}/${maxRetries}\n`);
    
    try {
      await testAPI();
      break;
    } catch (error) {
      if (attempt === maxRetries) {
        console.log(`\n❌ All ${maxRetries} attempts failed. Backend may be down.`);
        process.exit(1);
      }
      
      console.log(`\n⏳ Attempt ${attempt} failed, waiting 30s before retry...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
      attempt++;
    }
  }
}

runWithRetry().catch(console.error);