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
        this.DEBUG = process.env.DEBUG === 'true';
        this.timeframe = process.env.TIMEFRAME || '1h';
        this.REQUIRED_SCORE = 9;
        this.isRunning = false;
        this.config = this.buildConfig();
        this.marketData = this.initializeMarketData();
        this.logFormatter = new LogFormatter();
        // ALWAYS initialize BootManager (but it will handle test mode internally)
        this.bootManager = new BootManager(this);
        // CONDITIONAL: Only initialize exchange manager for live trading
        if (!testMode) {
            this.exchangeManager = new ExchangeManager();
        } else {
            this.exchangeManager = null;
            console.log('🧪 TEST MODE: Running offline without exchange connections');
        }
        //
        this.analyzers = {
            candle: new CandleAnalyzer(this.config),
            orderBook: new OrderBookAnalyzer(this.config)
        };
        //
        this.commandHandler = new CommandHandler(this);
        // CONDITIONAL: Only initialize Telegram for live trading
        if (!testMode) {
            this.telegramBotHandler = new TelegramBotHandler(
                this.config,
                (command, args) => this.commandHandler.executeCommand(command, args)
            );
        } else {
            this.telegramBotHandler = null;
        }
        // Signal cooldown and pair-specific configs
        this.lastSignalTimes = new Map();
        // PRICE CALCULATOR
        this.priceCalculator = new PriceCalculator(this.config);
        //
        this.startTime = Date.now();
        this.signalLogger = new SignalLogger(this);
    }

    buildConfig() {
        // Timeframe configuration with adaptive lookback periods
        const timeframeConfigs = {
            '1m': {
                analysisInterval: 10000, // 10 seconds
                maxCandles: 240,
                lookbackMultiplier: 1,
                emaMultiplier: 0.8
            },
            '5m': {
                analysisInterval: 15000, // 15 seconds
                maxCandles: 288,
                lookbackMultiplier: 5,
                emaMultiplier: 0.9
            },
            '15m': {
                analysisInterval: 20000, // 20 seconds
                maxCandles: 192,
                lookbackMultiplier: 15,
                emaMultiplier: 1.0
            },
            '1h': {
                analysisInterval: 2000,//60000, 1 minute but now every 2 secs to debug
                maxCandles: 168,
                lookbackMultiplier: 60,
                emaMultiplier: 1.0
            },
            '4h': {
                analysisInterval: 5000, // 5 seconds
                maxCandles: 126,
                lookbackMultiplier: 240,
                emaMultiplier: 1.2
            },
            '1d': {
                analysisInterval: 10000, // 10 seconds
                maxCandles: 90,
                lookbackMultiplier: 1440,
                emaMultiplier: 1.5
            }
        };

        const timeframeConfig = timeframeConfigs[this.timeframe] || timeframeConfigs['1h'];

        const baseRiskManagement = {
            stopLossPercent: 0.02, // 2% stop loss
            riskRewardRatio: 2,    // 2:1 risk-reward ratio
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
            // Base EMA periods (will be adjusted by timeframe)
            baseEmaShortPeriod: 8,
            baseEmaMediumPeriod: 21,
            baseEmaLongPeriod: 50,
            // Base lookback periods (will be adjusted by timeframe)
            baseOptimalEntryLookback: 10,
            basePriceTrendLookback: 8,
            baseVolumeLookback: 20,
            // Candle analyzer specific settings
            buyingPressureLookback: 4,
            buyingPressureThreshold: 0.7,
            rsiPeriod: 14,
            bbandsPeriod: 20,
            bbandsStdDev: 2,
            volumeEmaPeriod: 20,
            minCandlesForAnalysis: 50
        };

        const adaptiveRiskManagement = this.calculateAdaptiveRiskManagement(baseRiskManagement, timeframeConfig);

        return {
            tradingPairs: {
                'BTCUSDT': { cooldown: 10, minVolume: 10, volatilityMultiplier: 1.0 },
                'ETHUSDT': { cooldown: 10, minVolume: 25, volatilityMultiplier: 1.2 },
                'XRPUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 1.5 },
                'ADAUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 1.5 },
                'DOGEUSDT': { cooldown: 10, minVolume: 2000000, volatilityMultiplier: 1.8 },
                'FETUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 2.0 }
            },
            timeframe: this.timeframe,
            analysisInterval: timeframeConfig.analysisInterval,
            maxCandles: timeframeConfig.maxCandles,
            telegramBotEnabled: true,
            alertSignals: ['long', 'short'],
            riskManagement: adaptiveRiskManagement,
            reconnectInterval: 5000,
        };
    }

    calculateAdaptiveRiskManagement(baseRiskManagement, timeframeConfig) {
        const multiplier = timeframeConfig.lookbackMultiplier;
        const emaMultiplier = timeframeConfig.emaMultiplier;

        return {
            ...baseRiskManagement,
            // Scale lookback periods based on timeframe
            optimalEntryLookback: Math.max(5, Math.round(baseRiskManagement.baseOptimalEntryLookback * (60 / multiplier))),
            priceTrendLookback: Math.max(3, Math.round(baseRiskManagement.basePriceTrendLookback * (60 / multiplier))),
            volumeLookback: Math.max(10, Math.round(baseRiskManagement.baseVolumeLookback * (60 / multiplier))),
            // Adjust EMA periods for different timeframes
            emaShortPeriod: Math.max(5, Math.round(baseRiskManagement.baseEmaShortPeriod * emaMultiplier)),
            emaMediumPeriod: Math.max(10, Math.round(baseRiskManagement.baseEmaMediumPeriod * emaMultiplier)),
            emaLongPeriod: Math.max(20, Math.round(baseRiskManagement.baseEmaLongPeriod * emaMultiplier)),
            // Adjust analysis intervals and thresholds
            minCandlesRequired: Math.max(20, Math.round(20 * (60 / multiplier))),
            volumeSpikeMultiplier: this.getAdaptiveVolumeThreshold(multiplier),
            volumeAverageMultiplier: this.getAdaptiveVolumeAverageThreshold(multiplier)
        };
    }

    getAdaptiveVolumeThreshold(multiplier) {
        // Higher timeframes need higher volume thresholds
        const baseThreshold = 1.5;
        if (multiplier <= 1) return baseThreshold; // 1m
        if (multiplier <= 5) return 1.8; // 5m
        if (multiplier <= 15) return 2.0; // 15m
        if (multiplier <= 60) return 2.2; // 1h
        if (multiplier <= 240) return 2.5; // 4h
        return 3.0; // 1d and above
    }

    getAdaptiveVolumeAverageThreshold(multiplier) {
        // Slightly lower thresholds for average comparison
        const baseThreshold = 1.8;
        if (multiplier <= 1) return baseThreshold; // 1m
        if (multiplier <= 5) return 2.0; // 5m
        if (multiplier <= 15) return 2.2; // 15m
        if (multiplier <= 60) return 2.0; // 1h
        if (multiplier <= 240) return 2.2; // 4h
        return 2.8; // 1d and above
    }

    initializeMarketData() {
        return Object.fromEntries(
            Object.keys(this.config.tradingPairs).map(symbol => [  // Use Object.keys()
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
                    needsReinitialization: false
                }
            ])
        );
    }

    async setupWebsocketSubscriptions() {
        console.log('🔌 Setting up websocket subscriptions...');

        // Initialize full order books FIRST
        await Promise.all(Object.keys(this.config.tradingPairs).map(async symbol => {  // Use Object.keys()
            console.log(`📊 Initializing order book for ${symbol}...`);
            const snapshot = await this.exchangeManager.getOrderBookSnapshot(symbol);
            if (snapshot) {
                this.marketData[symbol].orderBook = snapshot;
                console.log(`  ✅ ${symbol}: Order book initialized (${snapshot.bids.length} bids, ${snapshot.asks.length} asks)`);
            } else {
                console.warn(`  ⚠️ ${symbol}: Failed to initialize order book`);
                this.marketData[symbol].needsReinitialization = true;
            }
        }));

        // THEN connect WebSocket streams
        await Promise.all(Object.keys(this.config.tradingPairs).map(async symbol => {  // Use Object.keys()
            await Promise.all([
                this.exchangeManager.subscribeToKline(symbol, this.config.timeframe,
                    data => this.processKlineData(symbol, data)),
                this.exchangeManager.subscribeToDepth(symbol,
                    data => this.processDepthData(symbol, data))
            ]);
            console.log(`  ✅ ${symbol}: Kline & Depth connected`);
        }));

        console.log('✅ All websocket connections established');
    }

    async fetchInitialCandles() {
        console.log('📊 Fetching initial candles...');
        await Promise.all(Object.keys(this.config.tradingPairs).map(async symbol => {  // Use Object.keys()

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
        //console.log('prcs klin', symbol,data)
        if (!data?.k) return;
        const kline = data.k;
        const candle = [
            kline.t, parseFloat(kline.o), parseFloat(kline.h),
            parseFloat(kline.l), parseFloat(kline.c), parseFloat(kline.v)
        ];
        const symbolData = this.marketData[symbol];
        if (kline.x) {
            symbolData.candles.push(candle);
            if (symbolData.candles.length > this.config.maxCandles) {
                symbolData.candles.shift();
            }
        } else {
            if (symbolData.candles.length > 0) {
                symbolData.candles[symbolData.candles.length - 1] = candle;
            }
        }
    }

    processDepthData(symbol, data) {
        const symbolData = this.marketData[symbol];
        // Store previous state
        symbolData.previousOrderBook = { ...symbolData.orderBook };
        // Process incremental update
        const updatedOrderBook = this.exchangeManager.processIncrementalDepthUpdate(
            data,
            symbolData.orderBook
        );
        if (updatedOrderBook) {
            symbolData.orderBook = updatedOrderBook;
        } else {
            // Mark for reinitialization on sequence error
            symbolData.needsReinitialization = true;
            console.warn(`⚠️ ${symbol}: Order book out of sync, will reinitialize`);
        }
    }

    async analyzeMarket(symbol) {
        const symbolData = this.marketData[symbol];

        // SKIP: Order book reinitialization in test mode
        if (!this.testMode && (symbolData.needsReinitialization || symbolData.orderBook.bids.length === 0)) {
            console.log(`🔄 Reinitializing order book for ${symbol} before analysis...`);
            const snapshot = await this.exchangeManager.getOrderBookSnapshot(symbol);
            if (snapshot) {
                symbolData.orderBook = snapshot;
                symbolData.needsReinitialization = false;
                console.log(`✅ ${symbol}: Order book reinitialized (${snapshot.bids.length} bids, ${snapshot.asks.length} asks)`);
            } else {
                console.warn(`❌ ${symbol}: Skipping analysis - failed to reinitialize order book`);
                return null;
            }
        }

        const { candles, orderBook, previousOrderBook } = symbolData;

        if (candles.length < this.config.riskManagement.minCandlesRequired) return null;

        try {
            const currentPrice = candles[candles.length - 1][4];
            const [obAnalysis, candleAnalysis] = await Promise.all([
                this.analyzers.orderBook.analyze(orderBook, previousOrderBook, candles, symbol),
                this.analyzers.candle.getAllSignals(candles)
            ]);

            if (this.DEBUG) {
                console.log(`📊 ${symbol} Order Book Stats: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`);
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

            // CONDITIONAL: Only send Telegram alerts in live mode
            if (!this.testMode && (compositeSignal === 'long' || compositeSignal === 'short') && !this.isInCooldown(symbol)) {
                this.telegramBotHandler.sendAlert({
                    pair: symbol,
                    signal: compositeSignal,
                    currentPrice: currentPrice,
                    entryPrice: suggestedPrices.entry,
                    stopLoss: suggestedPrices.stopLoss,
                    takeProfit: suggestedPrices.takeProfit,
                    optimalEntry: suggestedPrices.optimalEntry,  // ✅ FIXED: Changed from optimalBuy to optimalEntry
                    signalScore: signalScore[compositeSignal]
                });

                this.updateCooldown(symbol);

                if (this.DEBUG) {
                    const cooldownMins = this.config.tradingPairs[symbol]?.cooldown || 120;  // ✅ FIXED
                    console.log(`⏰ Cooldown activated for ${symbol}: ${cooldownMins} minutes`);
                }
            } else if (!this.testMode && compositeSignal !== 'neutral' && this.isInCooldown(symbol)) {
                if (this.DEBUG) {
                    console.log(`⏰ Signal suppressed for ${symbol} (in cooldown)`);
                }
            }

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
        } catch (error) {
            console.error(`Error analyzing ${symbol}:`, error);
            return null;
        }
    }

    // More strict signal determination with divergence checks
    determineCompositeSignal(candleSignals, obSignals, candles, symbol, signalScore) {
        if (candleSignals.error) return 'neutral';

        // Detect divergence first
        const divergence = this.detectDivergence(candleSignals, obSignals);
        // Use scoring system
        const score = signalScore || this.calculateSignalScore(candleSignals, obSignals, candles, symbol);

        // LONG SIGNAL VALIDATION
        if (score.long >= this.REQUIRED_SCORE) {
            // CRITICAL: Reject if bearish divergence detected
            if (divergence.bearishDivergence) {
                console.log(`🚫 REJECTED LONG for ${symbol}: Bearish divergence (OB bullish but price weak/bearish)`);
                return 'neutral';
            }

            // CRITICAL: Reject if order book shows downtrend without strong candle confirmation
            if (obSignals.inDowntrend && !candleSignals.buyingPressure && !candleSignals.volumeSpike) {
                console.log(`🚫 REJECTED LONG for ${symbol}: Order book in downtrend, no buying pressure`);
                return 'neutral';
            }

            // CRITICAL: Require at least ONE strong candle signal for high scores
            const hasStrongCandleSignal =
                candleSignals.emaBullishCross ||
                candleSignals.buyingPressure ||
                candleSignals.volumeSpike;

            if (!hasStrongCandleSignal && score.long < 10) {
                console.log(`🚫 REJECTED LONG for ${symbol}: No strong candle confirmation (Score: ${score.long}/10)`);
                return 'neutral';
            }

            // ADDITIONAL: Check volume alignment
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

        // SHORT SIGNAL VALIDATION
        if (score.short >= this.REQUIRED_SCORE) {
            // CRITICAL: Reject if bullish divergence detected
            if (divergence.bullishDivergence) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: Bullish divergence (OB bearish but price strong/bullish)`);
                return 'neutral';
            }

            // CRITICAL: Reject if order book shows uptrend without strong candle confirmation
            if (obSignals.inUptrend && !candleSignals.sellingPressure && !candleSignals.volumeSpike) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: Order book in uptrend, no selling pressure`);
                return 'neutral';
            }

            // CRITICAL: Require at least ONE strong candle signal for high scores
            const hasStrongCandleSignal =
                candleSignals.emaBearishCross ||
                candleSignals.sellingPressure ||
                candleSignals.volumeSpike;

            if (!hasStrongCandleSignal && score.short < 10) {
                console.log(`🚫 REJECTED SHORT for ${symbol}: No strong candle confirmation (Score: ${score.short}/10)`);
                return 'neutral';
            }

            // ADDITIONAL: Check volume alignment
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

        return 'neutral';
    }

    // More conservative scoring that requires candle + OB alignment
    calculateSignalScore(candleSignals, obSignals, candles, symbol) {
        let longScore = 0;
        let shortScore = 0;

        const isUptrend = candleSignals.emaFast > candleSignals.emaMedium &&
            candleSignals.emaMedium > candleSignals.emaSlow;

        const isDowntrend = candleSignals.emaFast < candleSignals.emaMedium &&
            candleSignals.emaMedium < candleSignals.emaSlow;

        const lastCandle = candles[candles.length - 1];
        const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');

        // ✅ MANDATORY VOLUME: Must have volume spike to proceed
        const isHighVolume = candleSignals.volumeSpike ||
            lastVolume > candleSignals.volumeEMA * this.config.riskManagement.volumeAverageMultiplier;

        // ✅ VOLUME CHECK - REJECT if no volume
        if (!isHighVolume) {
            if (this.DEBUG) {
                console.log(`   🚫 NO VOLUME: Rejecting all signals for ${symbol}`);
            }
            return { long: 0, short: 0 };
        }

        const { useBollingerBands } = this.config.riskManagement;

        // ✅ STRICTER: Require multiple strong signals to start scoring
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
            console.log(`      Volume: ${isHighVolume} (MANDATORY)`);
            console.log(`      Strong Base: Long=${hasStrongLongBase}, Short=${hasStrongShortBase}`);
        }

        return {
            long: Math.min(longScore, maxLongScore),
            short: Math.min(shortScore, maxShortScore)
        };
    }


    // Detect divergence between order book and candle signals
    detectDivergence(candleSignals, obSignals) {
        // Bearish divergence: Order book bullish but price action bearish/weak
        const bearishDivergence =
            (obSignals.strongBidImbalance ||
                obSignals.compositeSignal === 'strong_buy' ||
                obSignals.compositeSignal === 'buy') &&
            (obSignals.inDowntrend ||
                candleSignals.sellingPressure ||
                candleSignals.emaBearishCross ||
                (!candleSignals.buyingPressure && !candleSignals.volumeSpike));

        // Bullish divergence: Order book bearish but price action bullish/weak
        const bullishDivergence =
            (obSignals.strongAskImbalance ||
                obSignals.compositeSignal === 'strong_sell' ||
                obSignals.compositeSignal === 'sell') &&
            (obSignals.inUptrend ||
                candleSignals.buyingPressure ||
                candleSignals.emaBullishCross ||
                (!candleSignals.sellingPressure && !candleSignals.volumeSpike));

        // Log divergence detection
        if (this.DEBUG && (bearishDivergence || bullishDivergence)) {
            console.log(`   ⚠️ DIVERGENCE DETECTED:`);
            if (bearishDivergence) {
                console.log(`      Bearish Divergence: OB bullish but price bearish/weak`);
                console.log(`      - OB: BidImb=${obSignals.strongBidImbalance}, Composite=${obSignals.compositeSignal}`);
                console.log(`      - Price: Downtrend=${obSignals.inDowntrend}, SellingPress=${candleSignals.sellingPressure}`);
            }
            if (bullishDivergence) {
                console.log(`      Bullish Divergence: OB bearish but price bullish/weak`);
                console.log(`      - OB: AskImb=${obSignals.strongAskImbalance}, Composite=${obSignals.compositeSignal}`);
                console.log(`      - Price: Uptrend=${obSignals.inUptrend}, BuyingPress=${candleSignals.buyingPressure}`);
            }
        }

        return { bearishDivergence, bullishDivergence };
    }

    isInCooldown(symbol) {
        const cooldown = this.config.tradingPairs[symbol]?.cooldown || 120; // minutes
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

        // Optional: Clean up old entries to prevent memory leaks
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

    async runAnalysis() {
        this.isRunning = true;
        while (this.isRunning) {
            const startTime = Date.now();
            try {
                const analysisResults = await Promise.all(
                    Object.keys(this.config.tradingPairs).map(symbol => this.analyzeMarket(symbol))
                );
                this.logAnalysisResults(analysisResults.filter(Boolean));
                const processingTime = Date.now() - startTime;
                const delay = Math.max(0, this.config.analysisInterval - processingTime);
                await wait(delay);
            } catch (error) {
                console.error('Analysis cycle error:', error);
                await wait(this.config.reconnectInterval);
            }
        }
    }

    logAnalysisResults(results) {
        this.logFormatter.logAnalysisResults(results);
    }

    async shutdown() {
        this.isRunning = false;

        // SAFE: Only close connections if exchangeManager exists
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