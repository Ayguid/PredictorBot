import 'dotenv/config';
import CandleAnalyzer from './analyzers/CandleAnalyzer.js';
import OrderBookAnalyzer from './analyzers/OrderBookAnalyzer.js';
import TelegramBotHandler from './handlers/TelegramBotHandler.js';
import CommandHandler from './handlers/CommandHandler.js';
import BootManager from './managers/BootManager.js';
import LogFormatter from './utils/LogFormatter.js';
import { wait } from './utils/helpers.js';
import ExchangeManager from './managers/ExchangeManager.js';
import SignalLogger from './backtest/SignalLogger.js';
import PriceCalculator from './analyzers/PriceCalculator.js';

class BinancePredictiveBot {
    constructor(testMode = false) {
        this.testMode = testMode;
        this.initBaseProperties();
        this.initConfig();
        this.initComponents();
        this.initConditionalComponents();
        this.initCooldownAndTracking();
    }

    initBaseProperties() {
        this.DEBUG = process.env.DEBUG === 'true';
        this.timeframe = process.env.TIMEFRAME || '1h';
        this.REQUIRED_SCORE = 9;
        this.isRunning = false;
        this.startTime = Date.now();
    }

    initConfig() {
        this.config = this.buildConfig();
        this.marketData = this.initializeMarketData();
    }

    initComponents() {
        this.logFormatter = new LogFormatter();
        this.bootManager = new BootManager(this);
        
        // Core analyzers
        this.analyzers = {
            candle: new CandleAnalyzer(this.config),
            orderBook: new OrderBookAnalyzer(this.config)
        };
        
        this.commandHandler = new CommandHandler(this);
        this.priceCalculator = new PriceCalculator(this.config);
        this.signalLogger = new SignalLogger(this);
    }

    initConditionalComponents() {
        // Exchange manager only for live trading
        if (!this.testMode) {
            this.exchangeManager = new ExchangeManager();
        } else {
            this.exchangeManager = null;
            console.log('🧪 TEST MODE: Running offline without exchange connections');
        }

        // Telegram only for live trading
        if (!this.testMode) {
            this.telegramBotHandler = new TelegramBotHandler(
                this.config,
                (command, args) => this.commandHandler.executeCommand(command, args)
            );
        } else {
            this.telegramBotHandler = null;
        }
    }

    initCooldownAndTracking() {
        this.lastSignalTimes = new Map();
    }

    buildConfig() {
        const timeframeConfig = this.getTimeframeConfig();
        const baseRiskManagement = this.getBaseRiskManagement();
        const adaptiveRiskManagement = this.calculateAdaptiveRiskManagement(baseRiskManagement, timeframeConfig);

        return {
            tradingPairs: this.getTradingPairs(),
            timeframe: this.timeframe,
            analysisInterval: timeframeConfig.analysisInterval,
            maxCandles: timeframeConfig.maxCandles,
            telegramBotEnabled: true,
            alertSignals: ['long', 'short'],
            riskManagement: adaptiveRiskManagement,
            reconnectInterval: 5000,
        };
    }

    getTimeframeConfig() {
        const timeframeConfigs = {
            '1m': {
                analysisInterval: 10000,
                maxCandles: 240,
                lookbackMultiplier: 1,
                emaMultiplier: 0.8
            },
            '5m': {
                analysisInterval: 15000,
                maxCandles: 288,
                lookbackMultiplier: 5,
                emaMultiplier: 0.9
            },
            '15m': {
                analysisInterval: 20000,
                maxCandles: 192,
                lookbackMultiplier: 15,
                emaMultiplier: 1.0
            },
            '1h': {
                analysisInterval: 2000,
                maxCandles: 168,
                lookbackMultiplier: 60,
                emaMultiplier: 1.0
            },
            '4h': {
                analysisInterval: 5000,
                maxCandles: 126,
                lookbackMultiplier: 240,
                emaMultiplier: 1.2
            },
            '1d': {
                analysisInterval: 10000,
                maxCandles: 90,
                lookbackMultiplier: 1440,
                emaMultiplier: 1.5
            }
        };

        return timeframeConfigs[this.timeframe] || timeframeConfigs['1h'];
    }

    getBaseRiskManagement() {
        return {
            stopLossPercent: 0.02,
            riskRewardRatio: 2,
            useBollingerBands: true,
            supportResistanceWeight: 0.4,
            volumeWeight: 0.3,
            orderBookWeight: 0.2,
            maxOptimalDiscount: 0.08,
            minOptimalDiscount: 0.01,
            longEntryDiscount: 0.002,
            shortEntryPremium: 0.001,
            minCandlesRequired: 20,
            volumeSpikeMultiplier: 1.5,
            volumeAverageMultiplier: 1.8,
            volumeLookbackPeriod: 20,
            significantBidsCount: 3,
            minOptimalDiscountPercent: 0.005,
            optimalBuyThreshold: 0.01,
            bollingerBandAdjustment: 0.002,
            baseEmaShortPeriod: 8,
            baseEmaMediumPeriod: 21,
            baseEmaLongPeriod: 50,
            baseOptimalEntryLookback: 10,
            basePriceTrendLookback: 8,
            baseVolumeLookback: 20,
            buyingPressureLookback: 4,
            buyingPressureThreshold: 0.7,
            rsiPeriod: 14,
            bbandsPeriod: 20,
            bbandsStdDev: 2,
            volumeEmaPeriod: 20,
            minCandlesForAnalysis: 50
        };
    }

    getTradingPairs() {
        return {
                'BTCUSDT': { cooldown: 10, minVolume: 10, volatilityMultiplier: 1.0 },
                //'ETHUSDT': { cooldown: 10, minVolume: 25, volatilityMultiplier: 1.2 },
                //'XRPUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 1.5 },
                //'ADAUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 1.5 },
                //'DOGEUSDT': { cooldown: 10, minVolume: 2000000, volatilityMultiplier: 1.8 },
                //'FETUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 2.0 }
        };
    }

    calculateAdaptiveRiskManagement(baseRiskManagement, timeframeConfig) {
        const multiplier = timeframeConfig.lookbackMultiplier;
        const emaMultiplier = timeframeConfig.emaMultiplier;

        return {
            ...baseRiskManagement,
            optimalEntryLookback: Math.max(5, Math.round(baseRiskManagement.baseOptimalEntryLookback * (60 / multiplier))),
            priceTrendLookback: Math.max(3, Math.round(baseRiskManagement.basePriceTrendLookback * (60 / multiplier))),
            volumeLookback: Math.max(10, Math.round(baseRiskManagement.baseVolumeLookback * (60 / multiplier))),
            emaShortPeriod: Math.max(5, Math.round(baseRiskManagement.baseEmaShortPeriod * emaMultiplier)),
            emaMediumPeriod: Math.max(10, Math.round(baseRiskManagement.baseEmaMediumPeriod * emaMultiplier)),
            emaLongPeriod: Math.max(20, Math.round(baseRiskManagement.baseEmaLongPeriod * emaMultiplier)),
            minCandlesRequired: Math.max(20, Math.round(20 * (60 / multiplier))),
            volumeSpikeMultiplier: this.getAdaptiveVolumeThreshold(multiplier),
            volumeAverageMultiplier: this.getAdaptiveVolumeAverageThreshold(multiplier)
        };
    }

    getAdaptiveVolumeThreshold(multiplier) {
        const baseThreshold = 1.5;
        if (multiplier <= 1) return baseThreshold;
        if (multiplier <= 5) return 1.8;
        if (multiplier <= 15) return 2.0;
        if (multiplier <= 60) return 2.2;
        if (multiplier <= 240) return 2.5;
        return 3.0;
    }

    getAdaptiveVolumeAverageThreshold(multiplier) {
        const baseThreshold = 1.8;
        if (multiplier <= 1) return baseThreshold;
        if (multiplier <= 5) return 2.0;
        if (multiplier <= 15) return 2.2;
        if (multiplier <= 60) return 2.0;
        if (multiplier <= 240) return 2.2;
        return 2.8;
    }

    initializeMarketData() {
        return Object.fromEntries(
            Object.keys(this.config.tradingPairs).map(symbol => [
                symbol, {
                    candles: [],
                    orderBook: {
                        bids: [],
                        asks: [],
                        lastUpdateId: null,
                        timestamp: Date.now()
                    },
                    previousOrderBook: { bids: [], asks: [] },
                    lastAnalysis: null,
                    needsReinitialization: false,
                    bufferingUpdates: true,
                    _reinitTimeout: null
                }
            ])
        );
    }

    // WebSocket and data processing methods
    async setupWebsocketSubscriptions() {
        console.log('🔌 Setting up websocket subscriptions...');

        await this.connectWebSocketStreams();
        await this.waitForWebSocketData();
        await this.synchronizeOrderBookSnapshots();
        await this.validateCandleStreaming();
    }

    async connectWebSocketStreams() {
        console.log('📡 Connecting WebSocket streams first...');
        await Promise.all(Object.keys(this.config.tradingPairs).map(async symbol => {
            await Promise.all([
                this.exchangeManager.subscribeToKline(symbol, this.config.timeframe,
                    data => this.processKlineData(symbol, data)),
                this.exchangeManager.subscribeToDepth(symbol,
                    data => this.processDepthData(symbol, data))
            ]);
            console.log(`  ✅ ${symbol}: Kline & Depth connected`);
        }));
    }

    async waitForWebSocketData() {
        console.log('⏳ Waiting for WebSocket data flow to start...');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    async synchronizeOrderBookSnapshots() {
        console.log('📊 Getting synchronized order book snapshots...');
        await Promise.all(Object.keys(this.config.tradingPairs).map(async symbol => {
            console.log(`📊 Initializing order book for ${symbol}...`);
            
            let retries = 3;
            while (retries > 0) {
                try {
                    const snapshot = await this.exchangeManager.getOrderBookSnapshot(symbol);
                    if (snapshot) {
                        this.marketData[symbol].orderBook = snapshot;
                        console.log(`  ✅ ${symbol}: Order book synchronized (${snapshot.bids.length} bids, ${snapshot.asks.length} asks) with lastUpdateId=${snapshot.lastUpdateId}`);
                        this.marketData[symbol].bufferingUpdates = false;
                        break;
                    }
                } catch (error) {
                    retries--;
                    console.warn(`  ⚠️ ${symbol}: Failed to get snapshot, ${retries} retries left`);
                    if (retries === 0) {
                        this.marketData[symbol].needsReinitialization = true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }));
    }

    async validateCandleStreaming() {
        console.log('🔍 Validating candle streaming...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        Object.keys(this.config.tradingPairs).forEach(symbol => {
            const candles = this.marketData[symbol].candles;
            if (candles.length > 0) {
                const latest = candles[candles.length - 1];
                console.log(`   ${symbol}: ${candles.length} candles, latest: ${latest[4]} (${new Date(latest[0]).toISOString()})`);
            }
        });
    }

    async fetchInitialCandles() {
        console.log('📊 Fetching initial candles...');
        await Promise.all(Object.keys(this.config.tradingPairs).map(async symbol => {
            const klines = await this.exchangeManager.fetchKlines(
                symbol,
                this.config.timeframe,
                this.config.maxCandles
            );

            if (klines && klines.length > 0) {
                this.marketData[symbol].candles = klines.map(k => [
                    k[0], parseFloat(k[1]), parseFloat(k[2]),
                    parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
                ]);
                console.log(`  ✅ ${symbol}: ${this.marketData[symbol].candles.length} candles loaded`);
            } else {
                console.warn(`  ⚠️ ${symbol}: No candles received`);
                this.marketData[symbol].candles = [];
            }
        }));
        console.log('✅ Initial candles fetched successfully');
    }

    processKlineData(symbol, data) {
        if (!data?.k) return;
        const kline = data.k;
        const candle = [
            kline.t, parseFloat(kline.o), parseFloat(kline.h),
            parseFloat(kline.l), parseFloat(kline.c), parseFloat(kline.v)
        ];
        
        const symbolData = this.marketData[symbol];
        const previousClose = symbolData.candles.length > 0 ? symbolData.candles[symbolData.candles.length - 1][4] : null;
        
        if (kline.x) {
            symbolData.candles.push(candle);
            if (symbolData.candles.length > this.config.maxCandles) {
                symbolData.candles.shift();
            }
            console.log(`🕯️ ${symbol}: New candle closed at ${kline.c} (volume: ${kline.v})`);
        } else {
            if (symbolData.candles.length > 0) {
                symbolData.candles[symbolData.candles.length - 1] = candle;
            }
        }
    }

    processDepthData(symbol, data) {
        const symbolData = this.marketData[symbol];
        
        if (symbolData.bufferingUpdates) {
            const updatedOrderBook = this.applyDepthUpdate(data, symbolData.orderBook);
            if (updatedOrderBook) {
                symbolData.orderBook = updatedOrderBook;
            }
            return;
        }

        if (this.DEBUG) {
            // console.log('prcs depth; ', symbol, `U=${data.U} u=${data.u}`);
        }
        
        symbolData.previousOrderBook = this.exchangeManager.deepCopyOrderBook(symbolData.orderBook);
        
        const updatedOrderBook = this.exchangeManager.processIncrementalDepthUpdate(
            data,
            symbolData.orderBook
        );
        
        if (updatedOrderBook === null) {
            if (!symbolData.needsReinitialization) {
                symbolData.needsReinitialization = true;
                console.warn(`⚠️ ${symbol}: Order book out of sync, will reinitialize`);
                
                clearTimeout(symbolData._reinitTimeout);
                symbolData._reinitTimeout = setTimeout(() => {
                    this.reinitializeOrderBook(symbol);
                }, 2000);
            }
        } else {
            symbolData.orderBook = updatedOrderBook;
            symbolData.needsReinitialization = false;
        }
    }

    applyDepthUpdate(data, currentOrderBook) {
        if (!currentOrderBook || !currentOrderBook.bids || !currentOrderBook.asks) {
            return {
                bids: data.b ? data.b.map(b => [parseFloat(b[0]), parseFloat(b[1])]) : [],
                asks: data.a ? data.a.map(a => [parseFloat(a[0]), parseFloat(a[1])]) : [],
                lastUpdateId: data.u,
                timestamp: Date.now()
            };
        }

        const orderBookCopy = this.exchangeManager.deepCopyOrderBook(currentOrderBook);

        if (data.b && Array.isArray(data.b)) {
            data.b.forEach(([price, quantity]) => {
                const numPrice = parseFloat(price);
                const numQty = parseFloat(quantity);
                orderBookCopy.bids = orderBookCopy.bids.filter(bid => bid[0] !== numPrice);
                if (numQty > 0) orderBookCopy.bids.push([numPrice, numQty]);
            });
        }

        if (data.a && Array.isArray(data.a)) {
            data.a.forEach(([price, quantity]) => {
                const numPrice = parseFloat(price);
                const numQty = parseFloat(quantity);
                orderBookCopy.asks = orderBookCopy.asks.filter(ask => ask[0] !== numPrice);
                if (numQty > 0) orderBookCopy.asks.push([numPrice, numQty]);
            });
        }

        this.exchangeManager.cleanupOrderBook(orderBookCopy);
        orderBookCopy.bids.sort((a, b) => b[0] - a[0]);
        orderBookCopy.asks.sort((a, b) => a[0] - b[0]);
        orderBookCopy.lastUpdateId = data.u;
        orderBookCopy.timestamp = Date.now();

        return orderBookCopy;
    }

    async reinitializeOrderBook(symbol) {
        if (!this.marketData[symbol]?.needsReinitialization) return;
        
        console.log(`🔄 Reinitializing order book for ${symbol}...`);
        try {
            const snapshot = await this.exchangeManager.getOrderBookSnapshot(symbol);
            if (snapshot) {
                this.marketData[symbol].orderBook = snapshot;
                this.marketData[symbol].needsReinitialization = false;
                console.log(`✅ ${symbol}: Order book reinitialized (${snapshot.bids.length} bids, ${snapshot.asks.length} asks) with lastUpdateId=${snapshot.lastUpdateId}`);
            }
        } catch (error) {
            console.error(`❌ Failed to reinitialize order book for ${symbol}:`, error);
            setTimeout(() => this.reinitializeOrderBook(symbol), 5000);
        }
    }

    // Scoring and analysis methods
    async analyzeMarket(symbol) {
        const symbolData = this.marketData[symbol];

        if (!this.testMode && (symbolData.needsReinitialization || symbolData.orderBook.bids.length === 0)) {
            await this.reinitializeOrderBookForAnalysis(symbol);
        }

        const { candles, orderBook, previousOrderBook } = symbolData;

        if (candles.length < this.config.riskManagement.minCandlesRequired) return null;

        try {
            return await this.performMarketAnalysis(symbol, candles, orderBook, previousOrderBook);
        } catch (error) {
            console.error(`Error analyzing ${symbol}:`, error);
            return null;
        }
    }

    async reinitializeOrderBookForAnalysis(symbol) {
        console.log(`🔄 Reinitializing order book for ${symbol} before analysis...`);
        const snapshot = await this.exchangeManager.getOrderBookSnapshot(symbol);
        if (snapshot) {
            this.marketData[symbol].orderBook = snapshot;
            this.marketData[symbol].needsReinitialization = false;
            console.log(`✅ ${symbol}: Order book reinitialized (${snapshot.bids.length} bids, ${snapshot.asks.length} asks)`);
        } else {
            console.warn(`❌ ${symbol}: Skipping analysis - failed to reinitialize order book`);
        }
    }

    async performMarketAnalysis(symbol, candles, orderBook, previousOrderBook) {
        const currentPrice = candles[candles.length - 1][4];
        const [obAnalysis, candleAnalysis] = await Promise.all([
            this.analyzers.orderBook.analyze(orderBook, previousOrderBook, candles, symbol),
            this.analyzers.candle.getAllSignals(candles)
        ]);

        if (this.DEBUG) {
            console.log(`📊 ${symbol} Order Book Stats: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`);
                    const lastCandle = candles[candles.length - 1];
        const candleVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');
        console.log(`   🔍 VOLUME DEBUG: Candle=${candleVolume}, OB Bid=${obAnalysis.metrics.totalBidVolume.toFixed(1)}, OB Ask=${obAnalysis.metrics.totalAskVolume.toFixed(1)}`);
        }

        const signalScore = this.calculateSignalScore(candleAnalysis, obAnalysis.signals, candles, symbol);
        const compositeSignal = this.determineCompositeSignal(candleAnalysis, obAnalysis.signals, candles, symbol, signalScore);
        const suggestedPrices = this.priceCalculator.calculateSuggestedPrices(
            orderBook,
            candles,
            compositeSignal,
            candleAnalysis,
            symbol
        );

        this.handleSignalAlert(symbol, compositeSignal, currentPrice, suggestedPrices, signalScore);

        return {
            symbol,
            currentPrice,
            timestamp: Date.now(),
            signals: {
                candle: candleAnalysis,
                orderBook: obAnalysis.signals,
                compositeSignal,
                signalScore
            },
            suggestedPrices,
            indicators: {
                emaFast: candleAnalysis.emaFast,
                emaMedium: candleAnalysis.emaMedium,
                emaSlow: candleAnalysis.emaSlow,
                rsi: candleAnalysis.rsi,
                bollingerBands: candleAnalysis.bollingerBands,
                volumeEMA: candleAnalysis.volumeEMA,
                volumeSpike: candleAnalysis.volumeSpike,
                buyingPressure: candleAnalysis.buyingPressure
            }
        };
    }

    handleSignalAlert(symbol, compositeSignal, currentPrice, suggestedPrices, signalScore) {
        if (!this.testMode && (compositeSignal === 'long' || compositeSignal === 'short') && !this.isInCooldown(symbol)) {
            this.telegramBotHandler.sendAlert({
                pair: symbol,
                signal: compositeSignal,
                currentPrice: currentPrice,
                entryPrice: suggestedPrices.entry,
                stopLoss: suggestedPrices.stopLoss,
                takeProfit: suggestedPrices.takeProfit,
                optimalEntry: suggestedPrices.optimalEntry,
                signalScore: signalScore[compositeSignal]
            });

            this.updateCooldown(symbol);

            if (this.DEBUG) {
                const cooldownMins = this.config.tradingPairs[symbol]?.cooldown || 120;
                console.log(`⏰ Cooldown activated for ${symbol}: ${cooldownMins} minutes`);
            }
        } else if (!this.testMode && compositeSignal !== 'neutral' && this.isInCooldown(symbol)) {
            if (this.DEBUG) {
                console.log(`⏰ Signal suppressed for ${symbol} (in cooldown)`);
            }
        }
    }

    determineCompositeSignal(candleSignals, obSignals, candles, symbol, signalScore) {
        if (candleSignals.error) return 'neutral';

        const divergence = this.detectDivergence(candleSignals, obSignals);
        const score = signalScore || this.calculateSignalScore(candleSignals, obSignals, candles, symbol);

        const longSignal = this.validateLongSignal(symbol, score, divergence, candleSignals, obSignals, candles);
        if (longSignal) return longSignal;

        const shortSignal = this.validateShortSignal(symbol, score, divergence, candleSignals, obSignals, candles);
        if (shortSignal) return shortSignal;

        return 'neutral';
    }

    validateLongSignal(symbol, score, divergence, candleSignals, obSignals, candles) {
        if (score.long >= this.REQUIRED_SCORE) {
            if (divergence.bearishDivergence) {
                console.log(`🚫 REJECTED LONG for ${symbol}: Bearish divergence (OB bullish but price weak/bearish)`);
                return 'neutral';
            }

            if (obSignals.inDowntrend && !candleSignals.buyingPressure && !candleSignals.volumeSpike) {
                console.log(`🚫 REJECTED LONG for ${symbol}: Order book in downtrend, no buying pressure`);
                return 'neutral';
            }

            const hasStrongCandleSignal = candleSignals.emaBullishCross || candleSignals.buyingPressure || candleSignals.volumeSpike;
            if (!hasStrongCandleSignal && score.long < 10) {
                console.log(`🚫 REJECTED LONG for ${symbol}: No strong candle confirmation (Score: ${score.long}/10)`);
                return 'neutral';
            }

            const lastCandle = candles[candles.length - 1];
            const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');
            const isLowVolume = lastVolume < candleSignals.volumeEMA * 0.5;

            if (isLowVolume && !candleSignals.buyingPressure) {
                console.log(`🚫 REJECTED LONG for ${symbol}: Low volume with no buying pressure`);
                return 'neutral';
            }

            console.log(`🎯 STRONG LONG (Score: ${score.long}/10) for ${symbol}`);
            return 'long';
        }
        return null;
    }

    validateShortSignal(symbol, score, divergence, candleSignals, obSignals, candles) {
        if (score.short >= this.REQUIRED_SCORE) {
            if (divergence.bullishDivergence) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: Bullish divergence (OB bearish but price strong/bullish)`);
                return 'neutral';
            }

            if (obSignals.inUptrend && !candleSignals.sellingPressure && !candleSignals.volumeSpike) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: Order book in uptrend, no selling pressure`);
                return 'neutral';
            }

            const hasStrongCandleSignal = candleSignals.emaBearishCross || candleSignals.sellingPressure || candleSignals.volumeSpike;
            if (!hasStrongCandleSignal && score.short < 10) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: No strong candle confirmation (Score: ${score.short}/10)`);
                return 'neutral';
            }

            const lastCandle = candles[candles.length - 1];
            const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');
            const isLowVolume = lastVolume < candleSignals.volumeEMA * 0.5;

            if (isLowVolume && !candleSignals.sellingPressure) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: Low volume with no selling pressure`);
                return 'neutral';
            }

            console.log(`🎯 STRONG SHORT (Score: ${score.short}/10) for ${symbol}`);
            return 'short';
        }
        return null;
    }

calculateSignalScore(candleSignals, obSignals, candles, symbol) {
    let longScore = 0;
    let shortScore = 0;

    const isUptrend = candleSignals.emaFast > candleSignals.emaMedium &&
        candleSignals.emaMedium > candleSignals.emaSlow;

    const isDowntrend = candleSignals.emaFast < candleSignals.emaMedium &&
        candleSignals.emaMedium < candleSignals.emaSlow;

    const lastCandle = candles[candles.length - 1];
    const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');

    // FIX: Use more reasonable volume check
    const recentVolumes = candles.slice(-10).map(c => this.analyzers.candle._getCandleProp(c, 'volume'));
    const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    
    // Check if current volume is reasonable compared to recent average
    const volumeRatio = lastVolume / (avgRecentVolume || 1);
    const isReasonableVolume = volumeRatio > 0.1; //0.3 At least 30% of recent average volume
    
    // Also accept volume spikes
    const isHighVolume = candleSignals.volumeSpike || isReasonableVolume;

    if (!isHighVolume) {
        if (this.DEBUG) {
            console.log(`   🚫 LOW VOLUME: Rejecting signals for ${symbol}`);
            console.log(`      Current: ${lastVolume.toFixed(0)}, Recent Avg: ${avgRecentVolume.toFixed(0)}`);
            console.log(`      Ratio: ${volumeRatio.toFixed(2)} (required: >0.3)`);
        }
        return { long: 0, short: 0 };
    }

    if (this.DEBUG) {
        console.log(`   ✅ VOLUME OK: ${symbol} ratio=${volumeRatio.toFixed(2)}`);
    }

    const { useBollingerBands } = this.config.riskManagement;
    const hasStrongLongBase = candleSignals.emaBullishCross || candleSignals.buyingPressure;
    const hasStrongShortBase = candleSignals.emaBearishCross || candleSignals.sellingPressure;

    // === LONG SIGNAL SCORING ===
    if (hasStrongLongBase) {
        // Core trend signals (REDUCED WEIGHT)
        if (candleSignals.emaBullishCross) longScore += 2;
        if (candleSignals.buyingPressure) longScore += 2;
        if (isUptrend) longScore += 1;

        // Bollinger Band signals (REDUCED WEIGHT)
        if (useBollingerBands) {
            if (candleSignals.nearLowerBand) longScore += 1;
            if (candleSignals.bbandsSqueeze) longScore += 0;
        }

        // RSI confirmation (STRICTER)
        if (!candleSignals.isOverbought) longScore += 1;

        // ✅ VOLUME BONUS (since it's mandatory, give it good weight)
        longScore += 2;

        // Order book signals (STRICTER - REQUIRE ALIGNMENT)
        if (!obSignals.inDowntrend) {
            if (obSignals.strongBidImbalance) longScore += 1;
            if (obSignals.supportDetected) longScore += 1;
            if (obSignals.pricePressure === 'up' || obSignals.pricePressure === 'strong_up') longScore += 1;

            if (obSignals.compositeSignal.includes('buy')) longScore += 1;
        } else {
            longScore -= 3;
        }
    }

    // === SHORT SIGNAL SCORING ===
    if (hasStrongShortBase) {
        // Core trend signals (REDUCED WEIGHT)
        if (candleSignals.emaBearishCross) shortScore += 2;
        if (candleSignals.sellingPressure) shortScore += 2;
        if (isDowntrend) shortScore += 1;

        // Bollinger Band signals (REDUCED WEIGHT)
        if (useBollingerBands) {
            if (candleSignals.nearUpperBand) shortScore += 1;
            if (candleSignals.bbandsSqueeze) shortScore += 0;
        }

        // RSI confirmation (STRICTER)
        if (candleSignals.isOverbought) shortScore += 1;

        // ✅ VOLUME BONUS (since it's mandatory, give it good weight)
        shortScore += 2;

        // Order book signals (STRICTER - REQUIRE ALIGNMENT)
        if (!obSignals.inUptrend) {
            if (obSignals.strongAskImbalance) shortScore += 1;
            if (obSignals.resistanceDetected) shortScore += 1;
            if (obSignals.pricePressure === 'down' || obSignals.pricePressure === 'strong_down') shortScore += 1;

            if (obSignals.compositeSignal.includes('sell')) shortScore += 1;
        } else {
            shortScore -= 3;
        }
    }

    // === ALIGNMENT BONUS (STRICTER - BOTH MUST AGREE) ===
    if (isUptrend && obSignals.inUptrend && hasStrongLongBase) longScore += 2;
    if (isDowntrend && obSignals.inDowntrend && hasStrongShortBase) shortScore += 2;

    // ✅ ADD: MAXIMUM SCORE CAP for weaker setups
    const maxLongScore = hasStrongLongBase ? 10 : 5;
    const maxShortScore = hasStrongShortBase ? 10 : 5;

    if (this.DEBUG) {
        console.log(`   📊 SCORING BREAKDOWN (MANDATORY VOLUME):`);
        console.log(`      Long: ${longScore}/${maxLongScore} | Short: ${shortScore}/${maxShortScore}`);
        console.log(`      Volume: ${isHighVolume} (Current: ${lastVolume.toFixed(0)}, Ratio: ${volumeRatio.toFixed(2)})`);
        console.log(`      Strong Base: Long=${hasStrongLongBase}, Short=${hasStrongShortBase}`);
    }

    return {
        long: Math.min(longScore, maxLongScore),
        short: Math.min(shortScore, maxShortScore)
    };
}

    calculateLongScore(candleSignals, obSignals, isUptrend, useBollingerBands, isHighVolume, hasStrongLongBase) {
        if (!hasStrongLongBase) return 0;

        let score = 0;

        if (candleSignals.emaBullishCross) score += 2;
        if (candleSignals.buyingPressure) score += 2;
        if (isUptrend) score += 1;

        if (useBollingerBands) {
            if (candleSignals.nearLowerBand) score += 1;
        }

        if (!candleSignals.isOverbought) score += 1;
        if (isHighVolume) score += 2;

        if (!obSignals.inDowntrend) {
            if (obSignals.strongBidImbalance) score += 1;
            if (obSignals.supportDetected) score += 1;
            if (obSignals.pricePressure === 'up' || obSignals.pricePressure === 'strong_up') score += 1;
            if (obSignals.compositeSignal.includes('buy')) score += 1;
        } else {
            score -= 3;
        }

        return score;
    }

    calculateShortScore(candleSignals, obSignals, isDowntrend, useBollingerBands, isHighVolume, hasStrongShortBase) {
        if (!hasStrongShortBase) return 0;

        let score = 0;

        if (candleSignals.emaBearishCross) score += 2;
        if (candleSignals.sellingPressure) score += 2;
        if (isDowntrend) score += 1;

        if (useBollingerBands) {
            if (candleSignals.nearUpperBand) score += 1;
        }

        if (candleSignals.isOverbought) score += 1;
        if (isHighVolume) score += 2;

        if (!obSignals.inUptrend) {
            if (obSignals.strongAskImbalance) score += 1;
            if (obSignals.resistanceDetected) score += 1;
            if (obSignals.pricePressure === 'down' || obSignals.pricePressure === 'strong_down') score += 1;
            if (obSignals.compositeSignal.includes('sell')) score += 1;
        } else {
            score -= 3;
        }

        return score;
    }

    calculateAlignmentBonus(isUptrend, isDowntrend, obSignals, hasStrongLongBase, hasStrongShortBase) {
        const bonus = { long: 0, short: 0 };
        
        if (isUptrend && obSignals.inUptrend && hasStrongLongBase) bonus.long += 2;
        if (isDowntrend && obSignals.inDowntrend && hasStrongShortBase) bonus.short += 2;
        
        return bonus;
    }

    detectDivergence(candleSignals, obSignals) {
        const bearishDivergence =
            (obSignals.strongBidImbalance ||
                obSignals.compositeSignal === 'strong_buy' ||
                obSignals.compositeSignal === 'buy') &&
            (obSignals.inDowntrend ||
                candleSignals.sellingPressure ||
                candleSignals.emaBearishCross ||
                (!candleSignals.buyingPressure && !candleSignals.volumeSpike));

        const bullishDivergence =
            (obSignals.strongAskImbalance ||
                obSignals.compositeSignal === 'strong_sell' ||
                obSignals.compositeSignal === 'sell') &&
            (obSignals.inUptrend ||
                candleSignals.buyingPressure ||
                candleSignals.emaBullishCross ||
                (!candleSignals.sellingPressure && !candleSignals.volumeSpike));

        if (this.DEBUG && (bearishDivergence || bullishDivergence)) {
            console.log(`   ⚠️ DIVERGENCE DETECTED:`);
            if (bearishDivergence) {
                console.log(`      Bearish Divergence: OB bullish but price bearish/weak`);
            }
            if (bullishDivergence) {
                console.log(`      Bullish Divergence: OB bearish but price bullish/weak`);
            }
        }

        return { bearishDivergence, bullishDivergence };
    }

    // Cooldown management
    isInCooldown(symbol) {
        const cooldown = this.config.tradingPairs[symbol]?.cooldown || 120;
        const lastSignal = this.lastSignalTimes.get(symbol);
        if (!lastSignal) return false;

        const timeSinceLastSignal = Date.now() - lastSignal;
        const cooldownMs = cooldown * 60 * 1000;
        const remainingMs = cooldownMs - timeSinceLastSignal;

        if (remainingMs > 0 && this.DEBUG) {
            const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
            console.log(`⏰ ${symbol} cooldown: ${remainingMinutes}m remaining`);
        }

        return remainingMs > 0;
    }

    updateCooldown(symbol) {
        this.lastSignalTimes.set(symbol, Date.now());
        this.cleanupOldCooldowns();
    }

    cleanupOldCooldowns() {
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const now = Date.now();
        for (let [key, value] of this.lastSignalTimes.entries()) {
            if (now - value > twentyFourHours) {
                this.lastSignalTimes.delete(key);
                if (this.DEBUG) {
                    console.log(`🧹 Cleaned up old cooldown for ${key}`);
                }
            }
        }
    }

    // Main execution methods
    async runAnalysis() {
        this.isRunning = true;
        while (this.isRunning) {
            const startTime = Date.now();
            try {
                await this.executeAnalysisCycle();
                const processingTime = Date.now() - startTime;
                const delay = Math.max(0, this.config.analysisInterval - processingTime);
                await wait(delay);
            } catch (error) {
                console.error('Analysis cycle error:', error);
                await wait(this.config.reconnectInterval);
            }
        }
    }

    async executeAnalysisCycle() {
        const analysisResults = await Promise.all(
            Object.keys(this.config.tradingPairs).map(symbol => this.analyzeMarket(symbol))
        );
        this.logAnalysisResults(analysisResults.filter(Boolean));
    }

    logAnalysisResults(results) {
        this.logFormatter.logAnalysisResults(results);
    }

    async shutdown() {
        this.isRunning = false;

        if (this.exchangeManager) {
            await this.exchangeManager.closeAllConnections();
        } else {
            console.log('🧪 TEST MODE: No exchange connections to close');
        }
    }

    async analyzeSignalsFromCSV(csvFilePath, symbol = 'BTCUSDT', options = {}) {
        if (this.isRunning) {
            throw new Error('Cannot analyze signals while live trading is active');
        }

        try {
            console.log('📊 Analyzing signals from CSV...');

            const results = await this.signalLogger.logSignalsFromCSV({
                symbol: symbol,
                csvFilePath: csvFilePath,
                analysisInterval: options.analysisInterval || 4,
                minSignalScore: options.minSignalScore || 7,
                startDate: options.startDate,
                endDate: options.endDate,
                outputFile: options.outputFile
            });

            return results;
        } catch (error) {
            console.error('Signal analysis failed:', error);
            throw error;
        }
    }
}

export default BinancePredictiveBot;