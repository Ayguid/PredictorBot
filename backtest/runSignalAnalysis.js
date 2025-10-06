const BinancePredictiveBot = require('../predictor'); // Adjust path as needed
const SignalLogger = require('./SignalLogger');

async function runSignalAnalysis() {
    const bot = new BinancePredictiveBot();
    
    try {
        console.log('📊 Starting Signal Analysis...');
        
        // Initialize the bot (this will set up all analyzers and config)
        await bot.bootManager.executeBootSequence({
            startAnalysis: false, // Don't start live analysis
            isRestart: false
        });

        // Create signal logger
        const signalLogger = new SignalLogger(bot);

        // Update this path to your actual CSV file
        const csvFilePath = './data/FETUSDT-1h-2025-08.csv'; // CHANGE THIS TO YOUR ACTUAL PATH
        
        console.log(`🔍 Analyzing signals from: ${csvFilePath}`);
        
        const signals = await signalLogger.logSignalsFromCSV({
            symbol: 'FETUSDT',
            csvFilePath: csvFilePath,
            analysisInterval: 1, // Analyze EVERY candle
            minSignalScore: 7, // Lower threshold temporarily
            //startDate: '2024-01-01', // Optional
            //endDate: '2024-06-01'    // Optional
        });

        console.log(`\n🎉 Analysis complete! Found ${signals.length} signals total`);
        
        return signals;

    } catch (error) {
        console.error('❌ Signal analysis failed:', error);
        throw error;
    } finally {
        await bot.shutdown();
    }
}

// Run if this file is executed directly
if (require.main === module) {
    runSignalAnalysis().then(signals => {
        console.log(`📈 Total signals found: ${signals.length}`);
        process.exit(0);
    }).catch(error => {
        console.error('💥 Failed:', error);
        process.exit(1);
    });
}

module.exports = runSignalAnalysis;