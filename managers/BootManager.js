const { wait } = require('../utils/helpers');

class BootManager {
    constructor(bot) {
        this.bot = bot;
    }

    async executeBootSequence(options = {}) {
        const { 
            clearData = false, 
            startAnalysis = false,
            isRestart = false 
        } = options;

        console.log(isRestart ? '🔄 Restarting bot...' : '🚀 Starting bot...');

        // 🎯 CRITICAL FIX: Reset shutdown state BEFORE starting
        this.bot.exchangeManager.resetShutdownState();
        
        if (isRestart) {
            await this.executeShutdownSequence();
            await wait(2000); // Wait for connections to fully close
            
            // 🎯 RESET SHUTDOWN STATE again after shutdown
            this.bot.exchangeManager.resetShutdownState();
        }

        // Clear data if restarting
        if (clearData) {
            this.bot.marketData = this.bot.initializeMarketData();
            this.bot.lastSignalTimes.clear();
        }

        // ADDED: Log configuration details
        this.logConfiguration();

        // PROPER BOOT SEQUENCE:
        // 1. First get exchange information
        console.log('📊 Fetching exchange information...');
        await this.bot.exchangeManager.init(); // This also resets shutdown state
        console.log('✅ Exchange information loaded');

        // 2. Then fetch initial candles
        await this.bot.fetchInitialCandles();

        // 3. Then setup websocket connections
        await this.bot.setupWebsocketSubscriptions();

        // 4. Then initialize Telegram bot (only on first start)
        if (!isRestart) {
            await this.bot.telegramBotHandler.initialize();
            console.log('✅ Telegram bot initialized and polling started');
        }

        // 5. Start analysis if requested
        if (startAnalysis) {
            this.bot.isRunning = true;
            this.bot.runAnalysis().catch(console.error);
        }

        console.log(`✅ Bot ${isRestart ? 'restarted' : 'started'} successfully`);
    }

    // ADDED: Log configuration details
    logConfiguration() {
        console.log(`\n📈 Configuration for ${this.bot.timeframe} timeframe:`);
        console.log(`- Analysis interval: ${this.bot.config.analysisInterval}ms`);
        console.log(`- Max candles: ${this.bot.config.maxCandles}`);
        console.log(`- Trading pairs: ${this.bot.config.tradingPairs.length}`);
        console.log(`- Bollinger Bands: ${this.bot.config.riskManagement.useBollingerBands ? 'ENABLED' : 'DISABLED'}`);
        if (this.bot.config.riskManagement.useBollingerBands) {
            console.log(`- BB Adjustment: ${(this.bot.config.riskManagement.bollingerBandAdjustment * 100).toFixed(3)}%`);
        }
        console.log(`- Optimal entry lookback: ${this.bot.config.riskManagement.optimalEntryLookback} periods`);
        console.log(`- Price trend lookback: ${this.bot.config.riskManagement.priceTrendLookback} periods`);
        console.log(`- EMA periods: ${this.bot.config.riskManagement.emaShortPeriod}/${this.bot.config.riskManagement.emaMediumPeriod}/${this.bot.config.riskManagement.emaLongPeriod}`);
        console.log(`- Min candles required: ${this.bot.config.riskManagement.minCandlesRequired}`);
        console.log(`- Signal threshold: 8/10 score`);
    }

    async executeShutdownSequence() {
        console.log('🛑 Stopping bot and closing connections...');
        this.bot.isRunning = false;
        await wait(1000);
        await this.bot.exchangeManager.closeAllConnections();
        console.log('✅ Bot stopped successfully');
    }
}

module.exports = BootManager;