import { wait } from '../utils/helpers.js';

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

        // ✅ SKIP: If in test mode, don't initialize exchange connections
        if (this.bot.testMode) {
            console.log('🧪 TEST MODE: Skipping exchange initialization');
            
            // Just initialize market data for analysis
            if (clearData) {
                this.bot.marketData = this.bot.initializeMarketData();
                this.bot.lastSignalTimes.clear();
            }
            
            this.logConfiguration();
            
            if (startAnalysis) {
                this.bot.isRunning = true;
                this.bot.runAnalysis().catch(console.error);
            }
            
            console.log('✅ Test bot started successfully (offline mode)');
            return;
        }

        // 🎯 CRITICAL FIX: Reset shutdown state BEFORE starting (live mode only)
        this.bot.exchangeManager.resetShutdownState();
        
        if (isRestart) {
            await this.executeShutdownSequence();
            await wait(2000);
            this.bot.exchangeManager.resetShutdownState();
        }

        // Clear data if restarting
        if (clearData) {
            this.bot.marketData = this.bot.initializeMarketData();
            this.bot.lastSignalTimes.clear();
        }

        this.logConfiguration();

        // PROPER BOOT SEQUENCE (live mode only):
        console.log('📊 Fetching exchange information...');
        await this.bot.exchangeManager.init();
        console.log('✅ Exchange information loaded');

        await this.bot.fetchInitialCandles();
        await this.bot.setupWebsocketSubscriptions();

        if (!isRestart) {
            await this.bot.telegramBotHandler.initialize();
            console.log('✅ Telegram bot initialized and polling started');
        }

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
        console.log(`- Trading pairs: ${Object.keys(this.bot.config.tradingPairs).length}`);
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

export default BootManager;