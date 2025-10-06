const TechnicalIndicators = require('technicalindicators');

class CandleAnalyzer {
    constructor(timeframe = '1h', riskManagementConfig = null) {
        this.timeframe = timeframe;
        this.config = this.buildConfig(riskManagementConfig);
        this.DEBUG = process.env.DEBUG === 'true'; // Enable debug logs via environment variable

        this.CANDLE_INDEX = {
            TIMESTAMP: 0,
            OPEN: 1,
            HIGH: 2,
            LOW: 3,
            CLOSE: 4,
            VOLUME: 5
        };
    }

    buildConfig(riskManagementConfig) {
        // Use main bot config if provided - this should always be the case
        if (riskManagementConfig) {
            return {
                emaPeriods: {
                    fast: riskManagementConfig.emaShortPeriod,
                    medium: riskManagementConfig.emaMediumPeriod,
                    slow: riskManagementConfig.emaLongPeriod
                },
                rsiPeriod: riskManagementConfig.rsiPeriod,
                bbands: {
                    period: riskManagementConfig.bbandsPeriod,
                    stdDev: riskManagementConfig.bbandsStdDev
                },
                volumeEmaPeriod: riskManagementConfig.volumeEmaPeriod,
                volumeSpikeMultiplier: riskManagementConfig.volumeSpikeMultiplier,
                volumeAverageMultiplier: riskManagementConfig.volumeAverageMultiplier,
                volumeLookbackPeriod: riskManagementConfig.volumeLookbackPeriod,
                buyingPressureLookback: riskManagementConfig.buyingPressureLookback,
                buyingPressureThreshold: riskManagementConfig.buyingPressureThreshold,
                minCandlesForAnalysis: riskManagementConfig.minCandlesForAnalysis
            };
        }

        // If no config provided, throw error instead of using inconsistent defaults
        throw new Error('CandleAnalyzer requires riskManagementConfig from main bot');
    }

    _getCandleProp(candle, prop) {
        return candle[this.CANDLE_INDEX[prop.toUpperCase()]];
    }

    _prepareInput(candles, key = 'close') {
        return candles.map(c => this._getCandleProp(c, key));
    }

    calculateEMA(candles, period, key = 'close') {
        if (!candles || candles.length < period) return [];
        return TechnicalIndicators.EMA.calculate({
            period,
            values: this._prepareInput(candles, key)
        });
    }

    calculateRSI(candles) {
        if (!candles || candles.length < this.config.rsiPeriod) return [];
        return TechnicalIndicators.RSI.calculate({
            period: this.config.rsiPeriod,
            values: this._prepareInput(candles)
        });
    }

    calculateBBands(candles) {
        if (!candles || candles.length < this.config.bbands.period) return [];
        return TechnicalIndicators.BollingerBands.calculate({
            period: this.config.bbands.period,
            stdDev: this.config.bbands.stdDev,
            values: this._prepareInput(candles)
        });
    }

    calculateVolumeEMA(candles) {
        return this.calculateEMA(candles, this.config.volumeEmaPeriod, 'volume');
    }

    // UPDATED: More strict buying pressure detection with debug logs
    hasBuyingPressure(candles, lookback = this.config.buyingPressureLookback) {
        if (!candles || candles.length < lookback) {
            if (this.DEBUG) {
                console.log(`   🔍 BuyingPressure: Insufficient data (need ${lookback}, got ${candles?.length})`);
            }
            return false;
        }

        const recent = candles.slice(-lookback);

        // Count STRONG bullish candles (close > open by at least 0.1%)
        const strongBullishCount = recent.filter(c => {
            const open = this._getCandleProp(c, 'open');
            const close = this._getCandleProp(c, 'close');
            return close > open && ((close - open) / open) > 0.001;
        }).length;

        // Calculate bullish volume ratio with higher threshold
        const totalVolume = recent.reduce((sum, c) => sum + this._getCandleProp(c, 'volume'), 0);
        const bullishVolume = recent.reduce((sum, c) => {
            const isBullish = this._getCandleProp(c, 'close') > this._getCandleProp(c, 'open');
            return sum + (isBullish ? this._getCandleProp(c, 'volume') : 0);
        }, 0);

        const bullishVolumeRatio = totalVolume > 0 ? bullishVolume / totalVolume : 0;

        // MORE STRICT conditions
        const minBullishCandles = Math.ceil(lookback * 0.8); // 80% must be bullish
        const hasEnoughBullishCandles = strongBullishCount >= minBullishCandles;
        const hasStrongVolumeSupport = bullishVolumeRatio > 0.7; // 70% volume must be bullish

        // DEBUG: Buying pressure details
        if (this.DEBUG) {
            console.log(`   🔍 BuyingPressure: StrongBullish=${strongBullishCount}/${lookback}, ` +
                        `BullishVolumeRatio=${(bullishVolumeRatio * 100).toFixed(1)}%, ` +
                        `Result=${hasEnoughBullishCandles && hasStrongVolumeSupport}`);
        }

        return hasEnoughBullishCandles && hasStrongVolumeSupport;
    }

    // UPDATED: More strict selling pressure detection with debug logs
    hasSellingPressure(candles, lookback = this.config.buyingPressureLookback) {
        if (!candles || candles.length < lookback) {
            if (this.DEBUG) {
                console.log(`   🔍 SellingPressure: Insufficient data (need ${lookback}, got ${candles?.length})`);
            }
            return false;
        }

        const recent = candles.slice(-lookback);

        // Count STRONG bearish candles (close < open by at least 0.1%)
        const strongBearishCount = recent.filter(c => {
            const open = this._getCandleProp(c, 'open');
            const close = this._getCandleProp(c, 'close');
            return close < open && ((open - close) / open) > 0.001;
        }).length;

        // Calculate bearish volume ratio with higher threshold
        const totalVolume = recent.reduce((sum, c) => sum + this._getCandleProp(c, 'volume'), 0);
        const bearishVolume = recent.reduce((sum, c) => {
            const isBearish = this._getCandleProp(c, 'close') < this._getCandleProp(c, 'open');
            return sum + (isBearish ? this._getCandleProp(c, 'volume') : 0);
        }, 0);

        const bearishVolumeRatio = totalVolume > 0 ? bearishVolume / totalVolume : 0;

        // MORE STRICT conditions
        const minBearishCandles = Math.ceil(lookback * 0.8); // 80% must be bearish
        const hasEnoughBearishCandles = strongBearishCount >= minBearishCandles;
        const hasStrongVolumeSupport = bearishVolumeRatio > 0.7; // 70% volume must be bearish

        // DEBUG: Selling pressure details
        if (this.DEBUG) {
            console.log(`   🔍 SellingPressure: StrongBearish=${strongBearishCount}/${lookback}, ` +
                        `BearishVolumeRatio=${(bearishVolumeRatio * 100).toFixed(1)}%, ` +
                        `Result=${hasEnoughBearishCandles && hasStrongVolumeSupport}`);
        }

        return hasEnoughBearishCandles && hasStrongVolumeSupport;
    }

    _hasEMABullishCross(fastEMA, mediumEMA) {
        return fastEMA.length >= 3 && mediumEMA.length >= 3 &&
            fastEMA[fastEMA.length - 1] > mediumEMA[mediumEMA.length - 1] &&
            fastEMA[fastEMA.length - 2] <= mediumEMA[mediumEMA.length - 2] &&
            fastEMA[fastEMA.length - 3] <= mediumEMA[mediumEMA.length - 3];
    }

    _hasEMABearishCross(fastEMA, mediumEMA) {
        return fastEMA.length >= 3 && mediumEMA.length >= 3 &&
            fastEMA[fastEMA.length - 1] < mediumEMA[mediumEMA.length - 1] &&
            fastEMA[fastEMA.length - 2] >= mediumEMA[mediumEMA.length - 2] &&
            fastEMA[fastEMA.length - 3] >= mediumEMA[mediumEMA.length - 3];
    }

    _hasVolumeSpike(candles, volumeEMA) {
        if (!candles.length || !volumeEMA.length) return false;
        
        const currentVolume = this._getCandleProp(candles.slice(-1)[0], 'volume');
        const currentVolumeEMA = volumeEMA.slice(-1)[0];
        const averageVolume = this.calculateAverageVolume(
            candles.slice(-this.config.volumeLookbackPeriod)
        );

        const spikeVsEMA = currentVolume > currentVolumeEMA * this.config.volumeSpikeMultiplier;
        const spikeVsAvg = currentVolume > averageVolume * this.config.volumeAverageMultiplier;
        const result = spikeVsEMA && spikeVsAvg;

        // DEBUG: Volume spike details
        if (this.DEBUG) {
            console.log(`   🔍 VolumeSpike: Current=${currentVolume.toFixed(0)}, ` +
                        `EMA=${currentVolumeEMA.toFixed(0)}, ` +
                        `Avg=${averageVolume.toFixed(0)}, ` +
                        `SpikeVsEMA=${spikeVsEMA}, SpikeVsAvg=${spikeVsAvg}, Result=${result}`);
        }

        return result;
    }

    calculateAverageVolume(candles) {
        if (!candles.length) return 0;
        return candles.reduce((sum, c) => sum + this._getCandleProp(c, 'volume'), 0) / candles.length;
    }

    _isTrendConfirmed(candles, slowEMA) {
        if (!candles.length || !slowEMA.length) return false;

        const recentCandles = candles.slice(-5);
        const aboveCount = recentCandles.filter(c =>
            this._getCandleProp(c, 'close') > slowEMA[slowEMA.length - 1]
        ).length;

        return aboveCount >= 4;
    }

    _isDowntrendConfirmed(candles, slowEMA) {
        if (!candles.length || !slowEMA.length) return false;

        const recentCandles = candles.slice(-5);
        const belowCount = recentCandles.filter(c =>
            this._getCandleProp(c, 'close') < slowEMA[slowEMA.length - 1]
        ).length;

        return belowCount >= 4;
    }

    isOverbought(candles) {
        const rsi = this.calculateRSI(candles);
        return rsi.length > 0 && rsi.slice(-1)[0] > 72;
    }

    isOversold(candles) {
        const rsi = this.calculateRSI(candles);
        return rsi.length > 0 && rsi.slice(-1)[0] < 28;
    }

    isNearBollingerBand(candles, type = 'upper') {
        const bbands = this.calculateBBands(candles);
        if (!bbands.length) return false;

        const lastCandle = candles.slice(-1)[0];
        const lastClose = this._getCandleProp(lastCandle, 'close');
        const lastBand = type === 'upper'
            ? bbands[bbands.length - 1].upper
            : bbands[bbands.length - 1].lower;

        return Math.abs(lastClose - lastBand) / lastBand < 0.008;
    }

    getAllSignals(candles) {
        try {
            if (!candles || candles.length < this.config.minCandlesForAnalysis) {
                throw new Error(`Insufficient candle data (need at least ${this.config.minCandlesForAnalysis} candles)`);
            }

            // DEBUG: Log basic candle info
            if (this.DEBUG) {
                console.log(`\n🕯️ CANDLE ANALYZER DEBUG - ${this.timeframe}`);
                console.log(`   Total candles: ${candles.length}`);
                console.log(`   Date range: ${new Date(candles[0][0]).toISOString()} to ${new Date(candles[candles.length-1][0]).toISOString()}`);
                
                // DEBUG: Recent price action
                const last5 = candles.slice(-5);
                console.log(`   Recent closes: ${last5.map(c => this._getCandleProp(c, 'close').toFixed(4)).join(' → ')}`);
                console.log(`   Recent volumes: ${last5.map(c => this._getCandleProp(c, 'volume').toFixed(0)).join(', ')}`);
            }

            // Calculate all indicators once for performance
            const fastEMA = this.calculateEMA(candles, this.config.emaPeriods.fast);
            const mediumEMA = this.calculateEMA(candles, this.config.emaPeriods.medium);
            const slowEMA = this.calculateEMA(candles, this.config.emaPeriods.slow);
            const volumeEMA = this.calculateVolumeEMA(candles);
            const rsi = this.calculateRSI(candles);
            const bbands = this.calculateBBands(candles);

            // DEBUG: Indicator values
            if (this.DEBUG) {
                console.log(`   EMA Values: Fast=${fastEMA.slice(-1)[0]?.toFixed(4)}, Medium=${mediumEMA.slice(-1)[0]?.toFixed(4)}, Slow=${slowEMA.slice(-1)[0]?.toFixed(4)}`);
                console.log(`   RSI: ${rsi.slice(-1)[0]?.toFixed(2)}`);
                if (bbands.length > 0) {
                    const lastBB = bbands.slice(-1)[0];
                    console.log(`   Bollinger Bands: Upper=${lastBB.upper.toFixed(4)}, Middle=${lastBB.middle.toFixed(4)}, Lower=${lastBB.lower.toFixed(4)}`);
                }
            }

            const emaBullishCross = this._hasEMABullishCross(fastEMA, mediumEMA);
            const emaBearishCross = this._hasEMABearishCross(fastEMA, mediumEMA);
            const buyingPressure = this.hasBuyingPressure(candles);
            const sellingPressure = this.hasSellingPressure(candles);
            const volumeSpike = this._hasVolumeSpike(candles, volumeEMA);
            const trendConfirmed = this._isTrendConfirmed(candles, slowEMA);
            const downtrendConfirmed = this._isDowntrendConfirmed(candles, slowEMA);
            const isOverbought = this.isOverbought(candles);
            const isOversold = this.isOversold(candles);

            // DEBUG: Signal breakdown
            if (this.DEBUG) {
                console.log(`   SIGNAL ANALYSIS:`);
                console.log(`   ├── EMA Cross: Bullish=${emaBullishCross}, Bearish=${emaBearishCross}`);
                console.log(`   ├── Pressure: Buying=${buyingPressure}, Selling=${sellingPressure}`);
                console.log(`   ├── Volume: Spike=${volumeSpike}, EMA=${volumeEMA.slice(-1)[0]?.toFixed(0)}`);
                console.log(`   ├── Trend: Up=${trendConfirmed}, Down=${downtrendConfirmed}`);
                console.log(`   ├── RSI: Overbought=${isOverbought}, Oversold=${isOversold}`);
                console.log(`   └── BBands: NearUpper=${this.isNearBollingerBand(candles, 'upper')}, NearLower=${this.isNearBollingerBand(candles, 'lower')}`);
            }

            return {
                // Individual indicators
                emaFast: fastEMA.slice(-1)[0],
                emaMedium: mediumEMA.slice(-1)[0],
                emaSlow: slowEMA.slice(-1)[0],
                rsi: rsi.slice(-1)[0],
                bollingerBands: bbands.slice(-1)[0],
                volumeEMA: volumeEMA.slice(-1)[0],

                // Bullish signals
                emaBullishCross: emaBullishCross,
                buyingPressure: buyingPressure,
                volumeSpike: volumeSpike,
                trendConfirmed: trendConfirmed,
                isBullish: emaBullishCross && trendConfirmed && !isOverbought,

                // Bearish signals
                emaBearishCross: emaBearishCross,
                sellingPressure: sellingPressure,
                downtrendConfirmed: downtrendConfirmed,
                isBearish: emaBearishCross && downtrendConfirmed && !isOversold,

                // RSI conditions
                isOverbought: isOverbought,
                isOversold: isOversold,

                // Bollinger Band conditions
                nearUpperBand: this.isNearBollingerBand(candles, 'upper'),
                nearLowerBand: this.isNearBollingerBand(candles, 'lower'),

                // Additional metadata
                timeframe: this.timeframe,
                lastCandle: candles.slice(-1)[0],
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('❌ Signal generation error:', error);
            return {
                error: error.message,
                isBullish: false,
                isBearish: false,
                timestamp: Date.now()
            };
        }
    }
}

module.exports = CandleAnalyzer;