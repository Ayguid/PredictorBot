
//strict version with mandatory volume 24signals
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



//permisive 102 signals
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

    // Core trend signals (HIGH WEIGHT)
    if (candleSignals.emaBullishCross) longScore += 3;
    if (candleSignals.buyingPressure) longScore += 2;
    if (isUptrend) longScore += 2;

    // Bollinger Band signals (MEDIUM WEIGHT)
    if (useBollingerBands) {
        if (candleSignals.nearLowerBand) longScore += 2; // Oversold bounce potential
        if (candleSignals.bbandsSqueeze) longScore += 1; // Impending breakout
    }

    // Confirmation signals (MEDIUM WEIGHT)
    if (!candleSignals.isOverbought) longScore += 1;
    if (isHighVolume) longScore += 1;
    if (candleSignals.rsi > 40 && candleSignals.rsi < 60) longScore += 1;

    // Additional bullish conditions (LOW WEIGHT)
    if (obSignals.strongBidImbalance) longScore += 1;
    if (obSignals.supportDetected) longScore += 1;
    if (obSignals.pricePressure === 'up' || obSignals.pricePressure === 'strong_up') longScore += 1;

    // === SHORT SIGNAL SCORING ===

    // Core trend signals (HIGH WEIGHT)
    if (candleSignals.emaBearishCross) shortScore += 3;
    if (candleSignals.sellingPressure) shortScore += 2;
    if (isDowntrend) shortScore += 2;

    // Bollinger Band signals (MEDIUM WEIGHT)
    if (useBollingerBands) {
        if (candleSignals.nearUpperBand) shortScore += 2; // Overbought rejection potential
        if (candleSignals.bbandsSqueeze) shortScore += 1; // Impending breakdown
    }

    // Confirmation signals (MEDIUM WEIGHT)
    if (candleSignals.isOverbought) shortScore += 1;
    if (isHighVolume) shortScore += 1;
    if (candleSignals.rsi > 60 && candleSignals.rsi < 80) shortScore += 1;

    // Additional bearish conditions (LOW WEIGHT)
    if (obSignals.strongAskImbalance) shortScore += 1;
    if (obSignals.resistanceDetected) shortScore += 1;
    if (obSignals.pricePressure === 'down' || obSignals.pricePressure === 'strong_down') shortScore += 1;

    // === VOLUME BOOST (applies to both) ===
    if (isHighVolume) {
        longScore += 1;
        shortScore += 1;
    }

    // === TREND ALIGNMENT BONUS ===
    if (isUptrend) longScore += 1;
    if (isDowntrend) shortScore += 1;

    return { long: Math.min(longScore, 10), short: Math.min(shortScore, 10) };
}


//middle ground version 99signals
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

    // ✅ MIDDLE GROUND: Reasonable base requirement
    // Must have at least ONE strong signal to proceed
    const hasReasonableBase = 
        candleSignals.emaBullishCross || candleSignals.buyingPressure ||
        candleSignals.emaBearishCross || candleSignals.sellingPressure;

    if (!hasReasonableBase) {
        if (this.DEBUG) {
            console.log(`   🚫 NO BASE SIGNAL: Rejecting weak signals for ${symbol}`);
        }
        return { long: 0, short: 0 };
    }

    // ✅ MIDDLE GROUND: Use your preferred scoring weights
    // === LONG SIGNAL SCORING ===

    // Core trend signals (YOUR PREFERRED WEIGHTS)
    if (candleSignals.emaBullishCross) longScore += 3;
    if (candleSignals.buyingPressure) longScore += 2;
    if (isUptrend) longScore += 2;

    // Bollinger Band signals (YOUR PREFERRED WEIGHTS)
    if (useBollingerBands) {
        if (candleSignals.nearLowerBand) longScore += 2;
        if (candleSignals.bbandsSqueeze) longScore += 1;
    }

    // Confirmation signals (YOUR PREFERRED WEIGHTS)
    if (!candleSignals.isOverbought) longScore += 1;
    if (isHighVolume) longScore += 1;
    if (candleSignals.rsi > 40 && candleSignals.rsi < 60) longScore += 1;

    // Additional bullish conditions (YOUR PREFERRED WEIGHTS)
    if (obSignals.strongBidImbalance) longScore += 1;
    if (obSignals.supportDetected) longScore += 1;
    if (obSignals.pricePressure === 'up' || obSignals.pricePressure === 'strong_up') longScore += 1;

    // === SHORT SIGNAL SCORING ===

    // Core trend signals (YOUR PREFERRED WEIGHTS)
    if (candleSignals.emaBearishCross) shortScore += 3;
    if (candleSignals.sellingPressure) shortScore += 2;
    if (isDowntrend) shortScore += 2;

    // Bollinger Band signals (YOUR PREFERRED WEIGHTS)
    if (useBollingerBands) {
        if (candleSignals.nearUpperBand) shortScore += 2;
        if (candleSignals.bbandsSqueeze) shortScore += 1;
    }

    // Confirmation signals (YOUR PREFERRED WEIGHTS)
    if (candleSignals.isOverbought) shortScore += 1;
    if (isHighVolume) shortScore += 1;
    if (candleSignals.rsi > 60 && candleSignals.rsi < 80) shortScore += 1;

    // Additional bearish conditions (YOUR PREFERRED WEIGHTS)
    if (obSignals.strongAskImbalance) shortScore += 1;
    if (obSignals.resistanceDetected) shortScore += 1;
    if (obSignals.pricePressure === 'down' || obSignals.pricePressure === 'strong_down') shortScore += 1;

    // ✅ MIDDLE GROUND: Volume as STRONG bonus (not mandatory)
    if (isHighVolume) {
        longScore += 2;  // Strong bonus for volume
        shortScore += 2; // Strong bonus for volume
        if (this.DEBUG) {
            console.log(`   🔊 VOLUME BONUS: +2 points for high volume`);
        }
    } else {
        if (this.DEBUG) {
            console.log(`   ⚠️ NO VOLUME BONUS: Trading without volume confirmation`);
        }
    }

    // ✅ MIDDLE GROUND: Reasonable trend alignment bonus
    if (isUptrend) longScore += 1;
    if (isDowntrend) shortScore += 1;

    // ✅ MIDDLE GROUND: Gentle penalty for major misalignment
    if (obSignals.inDowntrend && longScore > 5) {
        longScore -= 1; // Small penalty, not game-over
        if (this.DEBUG) {
            console.log(`   ⚠️ TREND MISALIGNMENT: -1 point for long in OB downtrend`);
        }
    }

    if (obSignals.inUptrend && shortScore > 5) {
        shortScore -= 1; // Small penalty, not game-over
        if (this.DEBUG) {
            console.log(`   ⚠️ TREND MISALIGNMENT: -1 point for short in OB uptrend`);
        }
    }

    // ✅ MIDDLE GROUND: No artificial score caps
    const finalLongScore = Math.min(longScore, 10);
    const finalShortScore = Math.min(shortScore, 10);

    if (this.DEBUG) {
        console.log(`   📊 SCORING BREAKDOWN (MIDDLE GROUND):`);
        console.log(`      Long: ${finalLongScore}/10 | Short: ${finalShortScore}/10`);
        console.log(`      Volume: ${isHighVolume} (Bonus: +2)`);
        console.log(`      Base Signal: ${hasReasonableBase}`);
        console.log(`      Trends - Up: ${isUptrend}, Down: ${isDowntrend}`);
    }

    return {
        long: finalLongScore,
        short: finalShortScore
    };
}

//mid
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

    // ✅ REASONABLE BASE REQUIREMENT
    const hasReasonableBase = 
        candleSignals.emaBullishCross || candleSignals.buyingPressure ||
        candleSignals.emaBearishCross || candleSignals.sellingPressure;

    if (!hasReasonableBase) {
        if (this.DEBUG) {
            console.log(`   🚫 NO BASE SIGNAL: Rejecting weak signals for ${symbol}`);
        }
        return { long: 0, short: 0 };
    }

    // === LONG SIGNAL SCORING ===
    if (candleSignals.emaBullishCross) longScore += 3;
    if (candleSignals.buyingPressure) longScore += 2;
    if (isUptrend) longScore += 2;

    if (useBollingerBands) {
        if (candleSignals.nearLowerBand) longScore += 2;
        if (candleSignals.bbandsSqueeze) longScore += 1;
    }

    if (!candleSignals.isOverbought) longScore += 1;
    if (isHighVolume) longScore += 1;
    if (candleSignals.rsi > 40 && candleSignals.rsi < 60) longScore += 1;

    if (obSignals.strongBidImbalance) longScore += 1;
    if (obSignals.supportDetected) longScore += 1;
    if (obSignals.pricePressure === 'up' || obSignals.pricePressure === 'strong_up') longScore += 1;

    // === SHORT SIGNAL SCORING ===
    if (candleSignals.emaBearishCross) shortScore += 3;
    if (candleSignals.sellingPressure) shortScore += 2;
    if (isDowntrend) shortScore += 2;

    if (useBollingerBands) {
        if (candleSignals.nearUpperBand) shortScore += 2;
        if (candleSignals.bbandsSqueeze) shortScore += 1;
    }

    if (candleSignals.isOverbought) shortScore += 1;
    if (isHighVolume) shortScore += 1;
    if (candleSignals.rsi > 60 && candleSignals.rsi < 80) shortScore += 1;

    if (obSignals.strongAskImbalance) shortScore += 1;
    if (obSignals.resistanceDetected) shortScore += 1;
    if (obSignals.pricePressure === 'down' || obSignals.pricePressure === 'strong_down') shortScore += 1;

    // ✅ VOLUME AS STRONG BONUS (not mandatory)
    if (isHighVolume) {
        longScore += 2;
        shortScore += 2;
        if (this.DEBUG) {
            console.log(`   🔊 VOLUME BONUS: +2 points for high volume`);
        }
    }

    // ✅ TREND ALIGNMENT
    if (isUptrend) longScore += 1;
    if (isDowntrend) shortScore += 1;

    // ✅ GENTLE PENALTY FOR MISALIGNMENT
    if (obSignals.inDowntrend && longScore > 5) {
        longScore -= 1;
    }

    if (obSignals.inUptrend && shortScore > 5) {
        shortScore -= 1;
    }

    const finalLongScore = Math.min(longScore, 10);
    const finalShortScore = Math.min(shortScore, 10);

    if (this.DEBUG) {
        console.log(`   📊 SCORING BREAKDOWN (MIDDLE GROUND):`);
        console.log(`      Long: ${finalLongScore}/10 | Short: ${finalShortScore}/10`);
        console.log(`      Volume: ${isHighVolume} (Bonus: +2)`);
    }

    return {
        long: finalLongScore,
        short: finalShortScore
    };
}

