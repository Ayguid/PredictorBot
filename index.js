import BinancePredictiveBot from './BinancePredictiveBot.js';
import VisualizationServer from './VisualizationServer.js';

async function main() {
    const bot = new BinancePredictiveBot();
    const visualizationServer = new VisualizationServer(bot, process.env.VISUALIZATION_PORT || 3000);

    // Store original shutdown
    const originalShutdown = bot.shutdown.bind(bot);
    
    // Override bot shutdown to include visualization server
    bot.shutdown = async () => {
        console.log('🛑 Custom shutdown: Stopping visualization server...');
        await visualizationServer.stop();
        await originalShutdown();
    };

    // Start visualization server
    await visualizationServer.start();
    
    // Hook into analysis results
    const originalLogAnalysisResults = bot.logAnalysisResults.bind(bot);
    bot.logAnalysisResults = (results) => {
        originalLogAnalysisResults(results);
        visualizationServer.onAnalysisComplete(results);
    };

    // YOUR EXISTING CODE BELOW - DON'T MODIFY ANYTHING ELSE
    process.on('SIGINT', async () => {
        console.log('🛑 Received SIGINT, shutting down gracefully...');
        await bot.shutdown(); // This now stops both
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('🛑 Received SIGTERM, shutting down gracefully...');
        await bot.shutdown(); // This now stops both
        process.exit(0);
    });

    process.on('exit', async () => {
        console.log('🔴 Process exiting, cleaning up...');
        await bot.shutdown(); // This now stops both
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', async (error) => {
        console.error('Uncaught Exception:', error);
        await bot.shutdown(); // This now stops both
        process.exit(1);
    });

    try {
        await bot.bootManager.executeBootSequence({
            startAnalysis: true, // Start analysis after init
            isRestart: false
        });
    } catch (error) {
        console.error('Bot startup error:', error);
        await bot.shutdown();
        process.exit(1);
    }
}
// Only run main() if this file is executed directly
main().catch(console.error);