class LogFormatter {
    constructor() {
        this.color = {
            green: (text) => `\x1b[32m${text}\x1b[0m`,
            red: (text) => `\x1b[31m${text}\x1b[0m`,
            yellow: (text) => `\x1b[33m${text}\x1b[0m`,
            cyan: (text) => `\x1b[36m${text}\x1b[0m`,
            magenta: (text) => `\x1b[35m${text}\x1b[0m`,
            blue: (text) => `\x1b[34m${text}\x1b[0m`
        };
    }

    getPrecisionDigits(price) {
        if (price >= 1000) return 2;
        if (price >= 100) return 3;
        if (price >= 10) return 4;
        if (price >= 1) return 5;
        if (price >= 0.1) return 6;
        if (price >= 0.01) return 7;
        return 8;
    }

    logAnalysisResults(results) {
        if (results.length === 0) return;
        
        const now = new Date();
        console.log(`\n=== MARKET ANALYSIS (${now.toLocaleTimeString()}) ===\n`);

        results.forEach(result => {
            this._logSingleResult(result);
            console.log('-'.repeat(80));
        });
        console.log('='.repeat(80) + '\n');
    }

    _logSingleResult(result) {
        const { symbol, currentPrice, signals, suggestedPrices, indicators } = result;

        // Display signal header with current price
        let signalDisplay = signals.compositeSignal.toUpperCase();
        if (signals.compositeSignal.includes('long')) signalDisplay = this.color.green(signalDisplay);
        else if (signals.compositeSignal.includes('short')) signalDisplay = this.color.red(signalDisplay);
        else if (signals.compositeSignal.includes('over')) signalDisplay = this.color.yellow(signalDisplay);
        else signalDisplay = this.color.blue(signalDisplay);

        // Add signal score to display
        const scoreInfo = signals.signalScore ?
            ` (L:${signals.signalScore.long}/10 S:${signals.signalScore.short}/10)` : '';

        console.log(`${this.color.cyan(symbol.padEnd(8))} $ ${currentPrice.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))} | ${signalDisplay}${scoreInfo}`);

        // Display indicators
        let indicatorsLine = [];
        if (indicators.emaFast && indicators.emaMedium) {
            indicatorsLine.push(`EMA: ${indicators.emaFast.toFixed(4)}/${indicators.emaMedium.toFixed(4)}`);
        }
        if (indicators.rsi) {
            indicatorsLine.push(`RSI: ${indicators.rsi.toFixed(2)}`);
        }
        if (indicators.bollingerBands) {
            const bbWidth = ((indicators.bollingerBands.upper - indicators.bollingerBands.lower) / indicators.bollingerBands.middle * 100).toFixed(2);
            indicatorsLine.push(`BB: ${bbWidth}%`);
        }
        if (indicators.volumeSpike) {
            indicatorsLine.push('VOL↑');
        }
        if (indicators.buyingPressure) {
            indicatorsLine.push('BP↑');
        }
        console.log(`  ${indicatorsLine.join(' | ')}`);

        // Display trading details for long/short signals
        if (signals.compositeSignal === 'long' || signals.compositeSignal === 'short') {
            this._logTradingDetails(symbol, currentPrice, signals, suggestedPrices);
        }
    }

    _logTradingDetails(symbol, currentPrice, signals, suggestedPrices) {
        console.log(`  Current: $ ${currentPrice.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`);

        // Color the entry price based on signal type
        const entryPriceDisplay = signals.compositeSignal === 'long'
            ? this.color.green(`$ ${suggestedPrices.entry.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`)
            : this.color.red(`$ ${suggestedPrices.entry.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`);
        console.log(`  Entry: ${entryPriceDisplay}`);

        // Display optimal price for long signals
        if (signals.compositeSignal === 'long') {
            this._logOptimalPrice(symbol, currentPrice, suggestedPrices);
        }

        this._logRiskReward(symbol, currentPrice, suggestedPrices);
    }

    _logOptimalPrice(symbol, currentPrice, suggestedPrices) {
        if (suggestedPrices.optimalBuy === null) {
            console.log(`  Optimal: ${this.color.yellow('N/A (no valid level)')}`);
        } else {
            const discount = ((currentPrice - suggestedPrices.optimalBuy) / currentPrice * 100).toFixed(2);
            if (Math.abs(discount) > 0.1 && suggestedPrices.optimalBuy < currentPrice) {
                const optimalDisplay = this.color.blue(`$ ${suggestedPrices.optimalBuy.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`);
                console.log(`  Optimal: ${optimalDisplay} (${discount}% below current)`);
            } else {
                console.log(`  Optimal: ${this.color.yellow('N/A (too close to current)')}`);
            }
        }
    }

    _logRiskReward(symbol, currentPrice, suggestedPrices) {
        const riskPct = Math.abs((suggestedPrices.entry - suggestedPrices.stopLoss) / suggestedPrices.entry * 100);
        const rewardPct = Math.abs((suggestedPrices.takeProfit - suggestedPrices.entry) / suggestedPrices.entry * 100);
        const rrRatio = (rewardPct / riskPct).toFixed(2);

        console.log(`  SL: ${this.color.yellow(`$ ${suggestedPrices.stopLoss.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`)} (${riskPct.toFixed(2)}%)`);
        console.log(`  TP: ${this.color.green(`$ ${suggestedPrices.takeProfit.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`)} (${rewardPct.toFixed(2)}%)`);
        console.log(`  R/R: ${this.color.magenta(rrRatio + ':1')}`);
    }
}

export default LogFormatter;