import BinancePredictiveBot from '../BinancePredictiveBot.js';

async function quickTest() {
    // Test that the class can be imported and instantiated
    console.log('🧪 Testing BinancePredictiveBot class...');
    
    const bot = new BinancePredictiveBot();
    console.log('✅ Class instantiated successfully!');
    
    console.log('🤖 Bot configuration:');
    console.log(`- Timeframe: ${bot.timeframe}`);
    console.log(`- Trading pairs: ${bot.config.tradingPairs.join(', ')}`);
    console.log(`- Analysis interval: ${bot.config.analysisInterval}ms`);
    
    await bot.shutdown();
    console.log('✅ Test completed successfully!');
}

// SIMPLE FIX: Just run the function directly
console.log('🚀 Starting quick test...');
quickTest().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});