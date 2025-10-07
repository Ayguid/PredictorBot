class PriceCalculator {
    constructor(config, pairConfigs) {
        this.config = config;
        this.pairConfigs = pairConfigs;
    }

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

        // Calculate optimal prices for both long and short
        const optimalBuy = signal === 'long' ? 
            this.calculateOptimalBuyPrice(candles, orderBook, signal) : null;
        
        const optimalSell = signal === 'short' ? 
            this.calculateOptimalSellPrice(candles, orderBook, signal) : null;

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
                optimalEntry: optimalBuy,
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
                optimalEntry: optimalSell,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice
            };
        }

        return {
            entry: null,
            optimalEntry: null,
            stopLoss: null,
            takeProfit: null
        };
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

    calculateOptimalSellPrice(candles, orderBook, signal) {
        if (signal !== 'short') return null;

        const currentPrice = candles[candles.length - 1][4];
        const lookback = this.config.riskManagement.optimalEntryLookback;
        const recentCandles = candles.slice(-lookback);

        if (recentCandles.length < 5) return null;
        
        // Get recent highs (resistance levels)
        const recentHighs = recentCandles.map(candle => candle[2]);
        const sortedHighs = [...recentHighs].sort((a, b) => b - a);

        // Use median of recent highs as strong resistance
        const medianResistance = sortedHighs[Math.floor(sortedHighs.length / 2)];

        // Calculate VWAP for the lookback period
        let totalVolume = 0;
        let volumeWeightedSum = 0;

        recentCandles.forEach(candle => {
            const typicalPrice = (candle[2] + candle[3] + candle[4]) / 3;
            totalVolume += candle[5];
            volumeWeightedSum += typicalPrice * candle[5];
        });

        const vwap = totalVolume > 0 ? volumeWeightedSum / totalVolume : currentPrice;

        // Get order book resistance from significant asks
        let orderBookResistance = currentPrice;
        if (orderBook.asks && orderBook.asks.length > 0) {
            const significantAsks = orderBook.asks
                .filter(ask => ask[1] > 0)
                .slice(0, this.config.riskManagement.significantBidsCount);

            if (significantAsks.length > 0) {
                const totalAskVolume = significantAsks.reduce((sum, ask) => sum + ask[1], 0);
                orderBookResistance = significantAsks.reduce((sum, ask) => sum + (ask[0] * ask[1]), 0) / totalAskVolume;
            }
        }

        // Calculate weighted optimal price (for short, we want higher prices)
        const weights = this.config.riskManagement;
        let optimalPrice = (
            weights.supportResistanceWeight * medianResistance +
            weights.volumeWeight * vwap +
            weights.orderBookWeight * orderBookResistance
        );

        // Apply constraints - for shorts, optimal should be ABOVE current price
        const maxPremium = currentPrice * (1 + this.config.riskManagement.maxOptimalDiscount);
        const minPremium = currentPrice * (1 + this.config.riskManagement.minOptimalDiscount);

        optimalPrice = Math.min(
            Math.max(optimalPrice, minPremium),
            maxPremium,
            medianResistance
        );

        // Final sanity check - ensure optimal is above current for shorts
        optimalPrice = Math.max(optimalPrice, currentPrice * (1 + this.config.riskManagement.minOptimalDiscountPercent));

        // Round to appropriate precision
        const precision = this.getPrecision(currentPrice);
        optimalPrice = Math.round(optimalPrice / precision) * precision;

        // If optimal price is still below or equal to current, return null
        if (optimalPrice <= currentPrice) {
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

    // ATR calculation method
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
}

export default PriceCalculator;