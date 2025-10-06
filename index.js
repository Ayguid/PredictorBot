import BinancePredictiveBot from './BinancePredictiveBot.js';

async function main() {
    const bot = new BinancePredictiveBot();

    // Enhanced signal handlers
    process.on('SIGINT', async () => {
        console.log('🛑 Received SIGINT, shutting down gracefully...');
        await bot.shutdown();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('🛑 Received SIGTERM, shutting down gracefully...');
        await bot.shutdown();
        process.exit(0);
    });

    // Handle any cleanup on exit
    process.on('exit', async () => {
        console.log('🔴 Process exiting, cleaning up...');
        await bot.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', async (error) => {
        console.error('Uncaught Exception:', error);
        await bot.shutdown();
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