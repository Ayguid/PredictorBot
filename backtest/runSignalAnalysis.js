import BinancePredictiveBot from '../BinancePredictiveBot.js';
import SignalLogger from './SignalLogger.js';
import { existsSync } from 'fs';
import path from 'path';

async function runSignalAnalysis() {
    const bot = new BinancePredictiveBot();
    
    try {
        console.log('📊 Starting Signal Analysis...');
        
        // Initialize the bot
        await bot.bootManager.executeBootSequence({
            startAnalysis: false,
            isRestart: false
        });

        const signalLogger = new SignalLogger(bot);

        // FIXED: Use proper path resolution
        const csvFilePath = path.join(process.cwd(), 'backtest/data', 'FETUSDT-1h-2025-08.csv');
        
        console.log(`🔍 Looking for CSV file at: ${csvFilePath}`);
        
        // Check if file exists first
        if (!existsSync(csvFilePath)) {
            throw new Error(`CSV file not found: ${csvFilePath}\nPlease make sure the file exists in the data/ folder`);
        }

        console.log('✅ CSV file found, starting analysis...');
        
        const signals = await signalLogger.logSignalsFromCSV({
            symbol: 'FETUSDT',
            csvFilePath: csvFilePath,
            analysisInterval: 1,
            minSignalScore: 7,
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

console.log('🚀 Starting signal analysis script...');
runSignalAnalysis().then(signals => {
    console.log(`📈 Total signals found: ${signals.length}`);
    process.exit(0);
}).catch(error => {
    console.error('💥 Failed:', error);
    process.exit(1);
});

export default runSignalAnalysis;