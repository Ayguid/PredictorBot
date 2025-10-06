import 'dotenv/config';
import CandleAnalyzer from './analyzers/CandleAnalyzer.js';
import OrderBookAnalyzer from './analyzers/OrderBookAnalyzer.js';
import TelegramBotHandler from './handlers/TelegramBotHandler.js';
import CommandHandler from './handlers/CommandHandler.js';
import BootManager from './managers/BootManager.js';
import LogFormatter from './LogFormatter.js';
import { wait } from './utils/helpers.js';
import ExchangeManager from './managers/ExchangeManager.js';
import SignalLogger from './backtest/SignalLogger.js';

class BinancePredictiveBot {
    constructor() {
        this.DEBUG = process.env.DEBUG === 'true'; // Enable debug logs via environment variable
        this.timeframe = process.env.TIMEFRAME || '1h';
        this.config = this.buildConfig();
        this.logFormatter = new LogFormatter();
        this.exchangeManager = new ExchangeManager();
        this.analyzers = {
            candle: new CandleAnalyzer(this.timeframe, this.config.riskManagement),
            orderBook: new OrderBookAnalyzer()
        };
        this.marketData = this.initializeMarketData();
        this.isRunning = false;
        // Command handling
        this.commandHandler = new CommandHandler(this);
        // Pass CommandHandler's executeCommand directly
        this.telegramBotHandler = new TelegramBotHandler(
            this.config,
            (command, args) => this.commandHandler.executeCommand(command, args)
        );
        // ADDED: Signal cooldown and pair-specific configs
        //this.signalCooldowns = new Map();
        this.lastSignalTimes = new Map();
        this.pairConfigs = this.buildPairSpecificConfigs();

        // ADDED: Uptime tracking
        this.startTime = Date.now();
        this.bootManager = new BootManager(this);
        //
        this.signalLogger = new SignalLogger(this);
    }

    buildPairSpecificConfigs() {
        return {
            'BTCUSDT': { cooldown: 10, minVolume: 1000000, volatilityMultiplier: 1.0 }, // 10 minutes
            'ETHUSDT': { cooldown: 10, minVolume: 500000, volatilityMultiplier: 1.2 },
            'XRPUSDT': { cooldown: 10, minVolume: 1000000, volatilityMultiplier: 1.5 },
            'ADAUSDT': { cooldown: 10, minVolume: 500000, volatilityMultiplier: 1.5 },
            'DOGEUSDT': { cooldown: 10, minVolume: 2000000, volatilityMultiplier: 1.8 },
            'FETUSDT': { cooldown: 10, minVolume: 500000, volatilityMultiplier: 2.0 }
        };
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
                analysisInterval: 1000,//60000, // 1 minute
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
            tradingPairs: ['BTCUSDT', 'ETHUSDT', 'FETUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
            timeframe: this.timeframe,
            analysisInterval: timeframeConfig.analysisInterval,
            maxCandles: timeframeConfig.maxCandles,
            telegramBotEnabled: true,
            alertCooldown: 900000, //15min
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
            this.config.tradingPairs.map(symbol => [
                symbol, {
                    candles: [],
                    orderBook: { bids: [], asks: [] },
                    previousOrderBook: { bids: [], asks: [] },
                    lastAnalysis: null
                }
            ])
        );
    }

    async setupWebsocketSubscriptions() {
        console.log('🔌 Setting up websocket subscriptions...');

        // ✅ FAST: Connect all pairs in parallel
        await Promise.all(this.config.tradingPairs.map(async symbol => {
            // Connect kline and depth for each symbol in parallel
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
        await Promise.all(this.config.tradingPairs.map(async symbol => {

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
        //console.log('prcs dep', symbol,data)
        const symbolData = this.marketData[symbol];
        symbolData.previousOrderBook = { ...symbolData.orderBook };
        symbolData.orderBook = {
            bids: data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now()
        };
    }

    async analyzeMarket(symbol) {
        const { candles, orderBook, previousOrderBook } = this.marketData[symbol];
        //console.log(12, orderBook)
        if (candles.length < this.config.riskManagement.minCandlesRequired) return null;

        try {
            const currentPrice = candles[candles.length - 1][4];
            const [obAnalysis, candleAnalysis] = await Promise.all([
                this.analyzers.orderBook.analyze(orderBook, previousOrderBook, candles),
                this.analyzers.candle.getAllSignals(candles)
            ]);
            //console.log(obAnalysis)
            // Calculate signal score first
            const signalScore = this.calculateSignalScore(candleAnalysis, obAnalysis.signals, candles, symbol);

            const compositeSignal = this.determineCompositeSignal(candleAnalysis, obAnalysis.signals, candles, symbol, signalScore);
            const suggestedPrices = this.calculateSuggestedPrices(orderBook, candles, compositeSignal, candleAnalysis, symbol);

            if (compositeSignal === 'long' || compositeSignal === 'short') {
                this.telegramBotHandler.sendAlert({
                    pair: symbol,
                    signal: compositeSignal,
                    currentPrice: currentPrice,
                    entryPrice: suggestedPrices.entry,
                    stopLoss: suggestedPrices.stopLoss,
                    takeProfit: suggestedPrices.takeProfit,
                    optimalBuy: suggestedPrices.optimalBuy,
                    signalScore: signalScore[compositeSignal] // Add score to alert
                });
            }

            return {
                symbol,
                currentPrice,
                timestamp: Date.now(),
                signals: {
                    candle: candleAnalysis,
                    orderBook: obAnalysis.signals,
                    compositeSignal,
                    signalScore // Include score in results
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

    // UPDATED: More strict signal determination with divergence checks
    determineCompositeSignal(candleSignals, obSignals, candles, symbol, signalScore) {
        if (candleSignals.error) return 'neutral';

        // Detect divergence first
        const divergence = this.detectDivergence(candleSignals, obSignals);

        // Use scoring system
        const score = signalScore || this.calculateSignalScore(candleSignals, obSignals, candles, symbol);

        // LONG SIGNAL VALIDATION
        if (score.long >= 8) {
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
            this.updateCooldown(symbol);
            return 'long';
        }

        // SHORT SIGNAL VALIDATION
        if (score.short >= 8) {
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
            this.updateCooldown(symbol);
            return 'short';
        }

        return 'neutral';
    }

    // UPDATED: More conservative scoring that requires candle + OB alignment
    calculateSignalScore(candleSignals, obSignals, candles, symbol) {
        let longScore = 0;
        let shortScore = 0;

        const isUptrend = candleSignals.emaFast > candleSignals.emaMedium &&
            candleSignals.emaMedium > candleSignals.emaSlow;

        const isDowntrend = candleSignals.emaFast < candleSignals.emaMedium &&
            candleSignals.emaMedium < candleSignals.emaSlow;

        const lastCandle = candles[candles.length - 1];
        const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');
        const isHighVolume = candleSignals.volumeSpike ||
            lastVolume > candleSignals.volumeEMA * this.config.riskManagement.volumeAverageMultiplier;

        const { useBollingerBands } = this.config.riskManagement;

        // === LONG SIGNAL SCORING ===

        // Core trend signals (HIGHEST WEIGHT - REQUIRED)
        if (candleSignals.emaBullishCross) longScore += 3;
        if (candleSignals.buyingPressure) longScore += 3; // INCREASED from 2
        if (isUptrend) longScore += 1;

        // Bollinger Band signals (MEDIUM WEIGHT)
        if (useBollingerBands) {
            if (candleSignals.nearLowerBand) longScore += 2;
            if (candleSignals.bbandsSqueeze) longScore += 1;
        }

        // RSI confirmation (MEDIUM WEIGHT)
        if (!candleSignals.isOverbought) longScore += 1;
        if (candleSignals.rsi > 40 && candleSignals.rsi < 60) longScore += 1;

        // Volume confirmation (CRITICAL)
        if (isHighVolume) longScore += 2; // INCREASED from 1

        // Order book signals (LOW WEIGHT - only if not in downtrend)
        if (!obSignals.inDowntrend) {
            if (obSignals.strongBidImbalance) longScore += 1;
            if (obSignals.supportDetected) longScore += 1;
            if (obSignals.pricePressure === 'up' || obSignals.pricePressure === 'strong_up') longScore += 1;
        } else {
            // PENALTY: Reduce score if OB shows downtrend
            longScore -= 2;
        }

        // === SHORT SIGNAL SCORING ===

        // Core trend signals (HIGHEST WEIGHT - REQUIRED)
        if (candleSignals.emaBearishCross) shortScore += 3;
        if (candleSignals.sellingPressure) shortScore += 3; // INCREASED from 2
        if (isDowntrend) shortScore += 1;

        // Bollinger Band signals (MEDIUM WEIGHT)
        if (useBollingerBands) {
            if (candleSignals.nearUpperBand) shortScore += 2;
            if (candleSignals.bbandsSqueeze) shortScore += 1;
        }

        // RSI confirmation (MEDIUM WEIGHT)
        if (candleSignals.isOverbought) shortScore += 1;
        if (candleSignals.rsi > 60 && candleSignals.rsi < 80) shortScore += 1;

        // Volume confirmation (CRITICAL)
        if (isHighVolume) shortScore += 2; // INCREASED from 1

        // Order book signals (LOW WEIGHT - only if not in uptrend)
        if (!obSignals.inUptrend) {
            if (obSignals.strongAskImbalance) shortScore += 1;
            if (obSignals.resistanceDetected) shortScore += 1;
            if (obSignals.pricePressure === 'down' || obSignals.pricePressure === 'strong_down') shortScore += 1;
        } else {
            // PENALTY: Reduce score if OB shows uptrend
            shortScore -= 2;
        }

        // === ALIGNMENT BONUS (both candles AND order book agree) ===
        if (isUptrend && obSignals.inUptrend) longScore += 2;
        if (isDowntrend && obSignals.inDowntrend) shortScore += 2;

        if (this.DEBUG) {
            console.log(`   📊 SCORING BREAKDOWN:`);
            console.log(`      Long: ${longScore}/10 | Short: ${shortScore}/10`);
            console.log(`      Candle Trend: Up=${isUptrend}, Down=${isDowntrend}`);
            console.log(`      OB Trend: Up=${obSignals.inUptrend}, Down=${obSignals.inDowntrend}`);
            console.log(`      High Volume: ${isHighVolume}`);
        }

        return { long: Math.min(longScore, 10), short: Math.min(shortScore, 10) };
    }

    // ADDED: Detect divergence between order book and candle signals
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
        const cooldown = this.pairConfigs[symbol]?.cooldown || 120; // minutes
        const lastSignal = this.lastSignalTimes.get(symbol);
        if (!lastSignal) return false;

        return (Date.now() - lastSignal) < (cooldown * 60 * 1000);
    }

    updateCooldown(symbol) {
        this.lastSignalTimes.set(symbol, Date.now());
    }

    calculateOptimalBuyPrice(candles, orderBook, signal) {
        if (signal !== 'long') return null;

        const currentPrice = candles[candles.length - 1][4];
        const lookback = this.config.riskManagement.optimalEntryLookback;
        const recentCandles = candles.slice(-lookback);

        if (recentCandles.length < 5) return null;
        // Get recent lows (support levels)
        const recentLows = recentCandles.map(candle => candle[3]);
        const sortedLows = [...recentLows].sort((a, b) => a - b);

        // Use median of recent lows as strong support (more robust than average)
        const medianSupport = sortedLows[Math.floor(sortedLows.length / 2)];

        // Calculate VWAP for the lookback period
        let totalVolume = 0;
        let volumeWeightedSum = 0;

        recentCandles.forEach(candle => {
            const typicalPrice = (candle[2] + candle[3] + candle[4]) / 3;
            totalVolume += candle[5];
            volumeWeightedSum += typicalPrice * candle[5];
        });

        const vwap = totalVolume > 0 ? volumeWeightedSum / totalVolume : currentPrice;

        // Get order book support from significant bids
        let orderBookSupport = currentPrice;
        if (orderBook.bids && orderBook.bids.length > 0) {
            const significantBids = orderBook.bids
                .filter(bid => bid[1] > 0)
                .slice(0, this.config.riskManagement.significantBidsCount);

            if (significantBids.length > 0) {
                const totalBidVolume = significantBids.reduce((sum, bid) => sum + bid[1], 0);
                orderBookSupport = significantBids.reduce((sum, bid) => sum + (bid[0] * bid[1]), 0) / totalBidVolume;
            }
        }

        // Calculate weighted optimal price
        const weights = this.config.riskManagement;
        let optimalPrice = (
            weights.supportResistanceWeight * medianSupport +
            weights.volumeWeight * vwap +
            weights.orderBookWeight * orderBookSupport
        );

        // Apply constraints using config values
        const maxDiscount = currentPrice * (1 - this.config.riskManagement.minOptimalDiscount);
        const minDiscount = currentPrice * (1 - this.config.riskManagement.maxOptimalDiscount);

        optimalPrice = Math.max(
            Math.min(optimalPrice, maxDiscount),
            minDiscount,
            medianSupport
        );

        // Final sanity check - ensure optimal is below current
        optimalPrice = Math.min(optimalPrice, currentPrice * (1 - this.config.riskManagement.minOptimalDiscountPercent));

        // Round to appropriate precision
        const precision = this.getPrecision(currentPrice);
        optimalPrice = Math.round(optimalPrice / precision) * precision;

        // If optimal price is still above or equal to current, return null
        if (optimalPrice >= currentPrice) {
            return null;
        }

        return optimalPrice;

    }

    getPrecision(price) {
        if (price >= 1000) return 1;
        if (price >= 100) return 0.1;
        if (price >= 10) return 0.01;
        if (price >= 1) return 0.001;
        if (price >= 0.1) return 0.0001;
        if (price >= 0.01) return 0.00001;
        if (price >= 0.001) return 0.000001;
        return 0.0000001;
    }

    // UPDATED: Dynamic stop loss calculation with ATR
    calculateSuggestedPrices(orderBook, candles, signal, candleAnalysis, symbol) {
        const currentPrice = candles[candles.length - 1][4];
        const bestBid = orderBook.bids[0]?.[0] || currentPrice;
        const bestAsk = orderBook.asks[0]?.[0] || currentPrice;
        const bb = candleAnalysis.bollingerBands;

        const pairConfig = this.pairConfigs[symbol];
        const atr = this.calculateATR(candles, 14);
        const volatility = atr / currentPrice;

        // Dynamic stop loss based on volatility
        const baseStopPercent = 0.02; // 2%
        const volatilityAdjustedStop = baseStopPercent * pairConfig.volatilityMultiplier * (1 + volatility * 10);
        const dynamicStopPercent = Math.min(Math.max(volatilityAdjustedStop, 0.015), 0.05); // 1.5% to 5%

        const {
            riskRewardRatio,
            useBollingerBands,
            longEntryDiscount,
            shortEntryPremium,
            bollingerBandAdjustment
        } = this.config.riskManagement;

        const optimalBuy = signal === 'long' ?
            this.calculateOptimalBuyPrice(candles, orderBook, signal) :
            null;

        if (signal === 'long') {
            let entryPrice = bestAsk * (1 - longEntryDiscount);

            // Apply Bollinger Band adjustment if enabled
            if (useBollingerBands && bb && candleAnalysis.nearLowerBand) {
                entryPrice *= (1 - bollingerBandAdjustment);
                console.log(`📊 ${symbol}: Applied Bollinger Band adjustment for long entry`);
            }

            // Use ATR-based stop loss instead of fixed percentage
            const atrStopPrice = currentPrice - (atr * 1.5);
            const percentageStopPrice = entryPrice * (1 - dynamicStopPercent);

            // Use Bollinger Band lower as stop if it provides better protection
            let stopLossPrice = Math.max(atrStopPrice, percentageStopPrice);
            if (useBollingerBands && bb && bb.lower) {
                stopLossPrice = Math.max(stopLossPrice, bb.lower * (1 - 0.001)); // Slightly below lower band
            }

            const riskAmount = entryPrice - stopLossPrice;
            const takeProfitPrice = entryPrice + (riskAmount * riskRewardRatio);

            return {
                entry: entryPrice,
                optimalBuy: optimalBuy,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice
            };
        }

        if (signal === 'short') {
            let entryPrice = bestBid * (1 + shortEntryPremium);

            // Apply Bollinger Band adjustment if enabled
            if (useBollingerBands && bb && candleAnalysis.nearUpperBand) {
                entryPrice *= (1 + bollingerBandAdjustment);
                console.log(`📊 ${symbol}: Applied Bollinger Band adjustment for short entry`);
            }

            const atrStopPrice = currentPrice + (atr * 1.5);
            const percentageStopPrice = entryPrice * (1 + dynamicStopPercent);

            // Use Bollinger Band upper as stop if it provides better protection
            let stopLossPrice = Math.min(atrStopPrice, percentageStopPrice);
            if (useBollingerBands && bb && bb.upper) {
                stopLossPrice = Math.min(stopLossPrice, bb.upper * (1 + 0.001)); // Slightly above upper band
            }

            const riskAmount = stopLossPrice - entryPrice;
            const takeProfitPrice = entryPrice - (riskAmount * riskRewardRatio);

            return {
                entry: entryPrice,
                optimalBuy: null,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice
            };
        }

        return {
            entry: null,
            optimalBuy: null,
            stopLoss: null,
            takeProfit: null
        };
    }

    // ADDED: ATR calculation method
    calculateATR(candles, period = 14) {
        if (candles.length < period + 1) return 0;

        let trueRanges = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i][2];
            const low = candles[i][3];
            const prevClose = candles[i - 1][4];

            const tr1 = high - low;
            const tr2 = Math.abs(high - prevClose);
            const tr3 = Math.abs(low - prevClose);

            trueRanges.push(Math.max(tr1, tr2, tr3));
        }

        // Simple moving average of true ranges
        const atr = trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
        return atr;
    }

    async runAnalysis() {
        this.isRunning = true;
        while (this.isRunning) {
            const startTime = Date.now();
            try {
                const analysisResults = await Promise.all(
                    this.config.tradingPairs.map(symbol => this.analyzeMarket(symbol))
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
        await this.exchangeManager.closeAllConnections();
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

export default BinancePredictiveBot;