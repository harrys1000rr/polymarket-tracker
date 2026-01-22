async function quickTest() {
  console.log('🚀 Quick endpoint test...\n');
  
  try {
    // Test backend health
    console.log('Testing backend health...');
    const healthResponse = await fetch('https://p01--backend--h769bkzvfdpf.code.run/api/health');
    console.log(`Health status: ${healthResponse.status}`);
    
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log(`✅ Backend is ${health.status}`);
      
      // Test USD endpoint
      console.log('\nTesting USD endpoint...');
      const usdResponse = await fetch('https://p01--backend--h769bkzvfdpf.code.run/api/follower-sim?bankroll_usd=100');
      console.log(`USD endpoint status: ${usdResponse.status}`);
      
      if (usdResponse.ok) {
        const usdData = await usdResponse.json();
        console.log(`✅ USD API response:`, JSON.stringify(usdData, null, 2));
        
        if (usdData.bankrollUsd) {
          console.log('🎉 SUCCESS! USD conversion is working!');
        } else if (usdData.bankrollGbp) {
          console.log('❌ FAILURE! Still returning GBP');
        }
      } else {
        console.log('❌ USD endpoint failed');
      }
      
    } else {
      const errorText = await healthResponse.text();
      console.log(`❌ Backend failed: ${errorText}`);
    }
    
    // Test frontend
    console.log('\nTesting frontend...');
    const frontendResponse = await fetch('https://p01--frontend--h769bkzvfdpf.code.run/');
    console.log(`Frontend status: ${frontendResponse.status}`);
    
    if (frontendResponse.ok) {
      const html = await frontendResponse.text();
      const hasUSD = html.includes('Bankroll (USD)') || html.includes('$');
      const hasGBP = html.includes('Bankroll (GBP)');
      
      console.log(`Frontend has USD: ${hasUSD}`);
      console.log(`Frontend has GBP: ${hasGBP}`);
      
      if (hasUSD && !hasGBP) {
        console.log('✅ Frontend USD conversion working!');
      } else {
        console.log('❌ Frontend still has GBP references');
      }
    }
    
  } catch (error) {
    console.log(`💥 Error: ${error.message}`);
  }
}

quickTest();