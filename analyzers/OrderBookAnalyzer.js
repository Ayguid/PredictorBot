class OrderBookAnalyzer {
    
    constructor(config) {
        this.config = {
            depthLevels: 100, // ✅ INCREASED: Can analyze more levels now
            volumeThreshold: 0.5, // ✅ ADJUSTED: More conservative with full depth
            imbalanceThreshold: 1.8,//2.5, // ✅ INCREASED: Higher threshold for full depth
            clusterThreshold: 0.001,
            spikeThreshold: 2.0,
            priceChangeThreshold: 0.0001,
            wallDetectionMultiplier: 5, // ✅ INCREASED: Higher for full depth
            minSamplesRequired: 2,
            stabilityThreshold: 0.3
        };
        this.DEBUG = process.env.DEBUG === 'true';

        this.orderBookBuffer = new Map();
        this.pairConfigs = config.tradingPairs;
    }


    // ✅ ADD: Method to check if we have good depth data
    hasGoodDepth(metrics, symbol) {
        const minLevels = {
            'BTCUSDT': 20,  // ✅ REDUCED requirements
            'DOGEUSDT': 15,
            'default': 10
        };

        const requiredLevels = minLevels[symbol] || minLevels.default;
        const actualLevels = Math.min(metrics.bids?.length || 0, metrics.asks?.length || 0);
        const hasEnoughLevels = metrics.totalBidVolume > 0 && metrics.totalAskVolume > 0 &&
            actualLevels >= requiredLevels;

        if (this.DEBUG) {
            console.log(`   📊 Depth Analysis for ${symbol}:`);
            console.log(`   ├── Levels: ${actualLevels} (required: ${requiredLevels})`);
            console.log(`   ├── Bid Levels: ${metrics.bids?.length || 0}`);
            console.log(`   ├── Ask Levels: ${metrics.asks?.length || 0}`);
            console.log(`   ├── Has Enough Levels: ${hasEnoughLevels}`);
        }

        return hasEnoughLevels;
    }

    analyze(orderBook, previousOrderBook = null, candles = [], symbol) {
        //console.log(`\nAnalyzing order book for ${symbol}...`);
        if (!this.orderBookBuffer.has(symbol)) {
            this.orderBookBuffer.set(symbol, []);
        }

        const buffer = this.orderBookBuffer.get(symbol);
        buffer.push({
            bids: orderBook.bids,
            asks: orderBook.asks,
            timestamp: Date.now()
        });

        if (buffer.length > 3) buffer.shift();

        const stability = this.calculateStability(buffer);
        const samplesUsed = buffer.length;

        const { bids, asks } = orderBook;
        const depth = this.config.depthLevels;
        const topBids = bids.slice(0, depth);
        const topAsks = asks.slice(0, depth);

        if (this.DEBUG) {
            console.log(`\n📊 ORDER BOOK DEBUG | Samples: ${samplesUsed} | Stability: ${stability.toFixed(2)}`);
            console.log(`   Bid: ${topBids[0]?.[0]?.toFixed(4)} (Vol: ${topBids[0]?.[1]?.toFixed(2)})`);
            console.log(`   Ask: ${topAsks[0]?.[0]?.toFixed(4)} (Vol: ${topAsks[0]?.[1]?.toFixed(2)})`);
            console.log(`   Spread: ${(topAsks[0]?.[0] - topBids[0]?.[0])?.toFixed(4)}`);
            console.log(`   Total Levels: ${bids.length} bids, ${asks.length} asks`);
        }

        const metrics = {
            spread: this.calculateSpread(topBids, topAsks),
            midPrice: this.calculateMidPrice(topBids, topAsks),
            totalBidVolume: this.calculateTotalVolume(topBids),
            totalAskVolume: this.calculateTotalVolume(topAsks),
            bidAskImbalance: this.calculateImbalance(topBids, topAsks),
            supportLevels: this.findSupportLevels(topBids),
            resistanceLevels: this.findResistanceLevels(topAsks),
            stability: stability,
            samplesUsed: samplesUsed,
            bids: bids, // Full bid levels for depth checking
            asks: asks  // Full ask levels for depth checking
        };

        const pairConfig = this.pairConfigs?.[symbol];
        const minVolume = pairConfig?.minVolume || 1000;
        const hasMeaningfulVol = metrics.totalBidVolume > minVolume && metrics.totalAskVolume > minVolume;
        const hasGoodDepth = this.hasGoodDepth(metrics, symbol); // Depth quality check

        if (this.DEBUG) {
            console.log(`   📈 Volume Check: ${hasMeaningfulVol} (Required: ${minVolume}, Bid: ${metrics.totalBidVolume.toFixed(0)}, Ask: ${metrics.totalAskVolume.toFixed(0)})`);
            console.log(`   📊 Depth Check: ${hasGoodDepth} (${Math.min(bids.length, asks.length)} total levels)`);
        }

        if (previousOrderBook && previousOrderBook.bids && previousOrderBook.asks) {
            metrics.volumeChanges = this.calculateVolumeChanges(orderBook, previousOrderBook, depth);
        }

        const signals = this.generateSignals(metrics, topBids, topAsks, candles, symbol, hasMeaningfulVol, hasGoodDepth);

        if (this.DEBUG) {
            console.log(`   METRICS:`);
            console.log(`   ├── Bid Volume: ${metrics.totalBidVolume.toFixed(2)}`);
            console.log(`   ├── Ask Volume: ${metrics.totalAskVolume.toFixed(2)}`);
            console.log(`   ├── Imbalance: ${metrics.bidAskImbalance.toFixed(2)}`);
            console.log(`   ├── Support Levels: ${metrics.supportLevels.length}`);
            console.log(`   ├── Resistance Levels: ${metrics.resistanceLevels.length}`);
            console.log(`   ├── Stability: ${metrics.stability.toFixed(2)}`);
            console.log(`   └── Depth Quality: ${hasGoodDepth}`);

            if (metrics.volumeChanges) {
                console.log(`   VOLUME CHANGES:`);
                console.log(`   ├── Bid Change: ${metrics.volumeChanges.bidVolumeChange.toFixed(2)}`);
                console.log(`   ├── Ask Change: ${metrics.volumeChanges.askVolumeChange.toFixed(2)}`);
                console.log(`   └── Net Change: ${metrics.volumeChanges.netVolumeChange.toFixed(2)}`);
            }

            console.log(`   SIGNALS:`);
            console.log(`   ├── Bid Imbalance: ${signals.strongBidImbalance}`);
            console.log(`   ├── Ask Imbalance: ${signals.strongAskImbalance}`);
            console.log(`   ├── Support: ${signals.supportDetected}`);
            console.log(`   ├── Resistance: ${signals.resistanceDetected}`);
            console.log(`   ├── Price Pressure: ${signals.pricePressure}`);
            console.log(`   ├── Volume Spike: ${signals.volumeSpike}`);
            console.log(`   ├── Bid Walls: ${signals.bidWalls.length}`);
            console.log(`   ├── Ask Walls: ${signals.askWalls.length}`);
            console.log(`   ├── Meaningful Volume: ${signals.hasMeaningfulVolume}`);
            console.log(`   ├── Good Depth: ${signals.hasGoodDepth}`);
            console.log(`   ├── Signal Confidence: ${signals.signalConfidence}`);
            console.log(`   └── Composite: ${signals.compositeSignal}`);
        }

        return { metrics, signals, timestamp: Date.now() };
    }

    // Update generateSignals to include depth quality
generateSignals(metrics, topBids, topAsks, candles, symbol, hasMeaningfulVol, hasGoodDepth) {
    const hasValidOrderBook = topBids.length > 0 && topAsks.length > 0;
    const isStable = metrics.stability >= this.config.stabilityThreshold;

    // Proper volume unit handling
    const pairConfig = this.pairConfigs?.[symbol];
    const minVolume = pairConfig?.minVolume || 1000;

    // Config already has the right units and thresholds
    const actualHasMeaningfulVol = metrics.totalBidVolume > minVolume && metrics.totalAskVolume > minVolume;

    if (this.DEBUG) {
        console.log(`   📈 Volume Analysis for ${symbol}:`);
        console.log(`   ├── Bid Volume: ${metrics.totalBidVolume.toFixed(2)}`);
        console.log(`   ├── Ask Volume: ${metrics.totalAskVolume.toFixed(2)}`);
        console.log(`   ├── Required: ${minVolume}`);
        console.log(`   ├── Has Meaningful Volume: ${actualHasMeaningfulVol}`);
        console.log(`   ├── Has Good Depth: ${hasGoodDepth}`);
        console.log(`   ├── Is Stable: ${isStable} (${metrics.stability.toFixed(2)})`);
    }

    const signals = {
        strongBidImbalance: hasValidOrderBook && actualHasMeaningfulVol && hasGoodDepth && isStable &&
            metrics.bidAskImbalance >= this.config.imbalanceThreshold,
        strongAskImbalance: hasValidOrderBook && actualHasMeaningfulVol && hasGoodDepth && isStable &&
            metrics.bidAskImbalance <= (1 / this.config.imbalanceThreshold),
        supportDetected: metrics.supportLevels.length > 0,
        resistanceDetected: metrics.resistanceLevels.length > 0,
        bidWalls: this.detectWalls(topBids, 'bid', symbol),
        askWalls: this.detectWalls(topAsks, 'ask', symbol),
        pricePressure: 'neutral',
        inUptrend: this.isUptrend(candles),
        inDowntrend: this.isDowntrend(candles),
        volumeSpike: false,
        signalConfidence: metrics.stability,
        hasMeaningfulVolume: actualHasMeaningfulVol, // USE corrected volume check
        hasGoodDepth: hasGoodDepth,
        isStable: isStable
    };

    // Only process volume changes if order book is stable and has meaningful volume
    if (metrics.volumeChanges && actualHasMeaningfulVol && isStable) {
        const netChange = metrics.volumeChanges.netVolumeChange;
        const totalVolume = metrics.totalBidVolume + metrics.totalAskVolume;

        if (totalVolume > 0) {
            const changeRatio = Math.abs(netChange) / totalVolume;
            signals.volumeSpike = changeRatio > 0.2; // Increased from 0.1 to 0.2 (20%)
            
            if (this.DEBUG && signals.volumeSpike) {
                console.log(`   🔊 Volume Spike Detected: ${(changeRatio * 100).toFixed(1)}% change`);
            }
        }

        // Enhanced price pressure logic
        if (netChange > 0 && metrics.bidAskImbalance > 1.2) {
            signals.pricePressure = 'up';
        } else if (netChange < 0 && metrics.bidAskImbalance < 0.8) {
            signals.pricePressure = 'down';
        } else {
            // Fallback to pure imbalance-based pressure
            if (metrics.bidAskImbalance > 1.5) {
                signals.pricePressure = 'up';
            } else if (metrics.bidAskImbalance < 0.5) {
                signals.pricePressure = 'down';
            }
        }

        if (this.DEBUG && signals.pricePressure !== 'neutral') {
            console.log(`   🎯 Price Pressure: ${signals.pricePressure}`);
            console.log(`   ├── Net Change: ${netChange.toFixed(2)}`);
            console.log(`   ├── Imbalance: ${metrics.bidAskImbalance.toFixed(2)}`);
        }
    }

    signals.compositeSignal = this.generateCompositeSignal(signals, metrics, symbol);
    
    if (this.DEBUG) {
        console.log(`   🎲 FINAL SIGNALS for ${symbol}:`);
        console.log(`   ├── Strong Bid Imbalance: ${signals.strongBidImbalance}`);
        console.log(`   ├── Strong Ask Imbalance: ${signals.strongAskImbalance}`);
        console.log(`   ├── Support Detected: ${signals.supportDetected}`);
        console.log(`   ├── Resistance Detected: ${signals.resistanceDetected}`);
        console.log(`   ├── Bid Walls: ${signals.bidWalls.length}`);
        console.log(`   ├── Ask Walls: ${signals.askWalls.length}`);
        console.log(`   ├── Price Pressure: ${signals.pricePressure}`);
        console.log(`   ├── Volume Spike: ${signals.volumeSpike}`);
        console.log(`   ├── Uptrend: ${signals.inUptrend}`);
        console.log(`   ├── Downtrend: ${signals.inDowntrend}`);
        console.log(`   └── Composite Signal: ${signals.compositeSignal}`);
    }
    
    return signals;
}

    // Update composite signal to require good depth for strong signals
    generateCompositeSignal(signals, metrics, symbol) {
        const hasValidData = metrics.totalBidVolume > 0 && metrics.totalAskVolume > 0;

        if (!hasValidData || !signals.hasMeaningfulVolume || !signals.isStable) {
            if (this.DEBUG && !signals.hasMeaningfulVolume) {
                const pairConfig = this.pairConfigs?.[symbol];
                const minVolume = pairConfig?.minVolume || 1000;
                console.log(`   ⚠️  Insufficient volume: ${metrics.totalBidVolume.toFixed(0)}/${metrics.totalAskVolume.toFixed(0)} vs required ${minVolume}`);
            }
            if (this.DEBUG && !signals.isStable) {
                console.log(`   ⚠️ Unstable order book: ${metrics.stability.toFixed(2)} stability`);
            }
            return 'neutral';
        }

        // Require good depth for strong signals
        if (signals.strongBidImbalance && signals.supportDetected && signals.bidWalls.length > 0) {
            if (signals.hasGoodDepth) {
                return 'strong_buy';
            } else {
                return 'buy'; // Downgrade if poor depth
            }
        }

        if (signals.strongAskImbalance && signals.resistanceDetected && signals.askWalls.length > 0) {
            if (signals.hasGoodDepth) {
                return 'strong_sell';
            } else {
                return 'sell'; // Downgrade if poor depth
            }
        }

        if (signals.strongBidImbalance && signals.supportDetected) {
            return 'buy';
        }

        if (signals.strongAskImbalance && signals.resistanceDetected) {
            return 'sell';
        }

        if (signals.strongBidImbalance) return 'weak_buy';
        if (signals.strongAskImbalance) return 'weak_sell';

        if (signals.bidWalls.length > signals.askWalls.length * 2) return 'weak_buy';
        if (signals.askWalls.length > signals.bidWalls.length * 2) return 'weak_sell';

        return 'neutral';
    }

    // ... keep all your existing helper methods unchanged (calculateStability, calculateSpread, etc.)
calculateStability(buffer) {
    if (buffer.length < 2) return 0.8; // HIGHER default
    
    try {
        const [prev, curr] = buffer.slice(-2);
        
        if (!prev.bids?.[0] || !curr.bids?.[0] || !prev.asks?.[0] || !curr.asks?.[0]) {
            return 0.7; // HIGHER fallback
        }
        
        const prevMid = (prev.bids[0][0] + prev.asks[0][0]) / 2;
        const currMid = (curr.bids[0][0] + curr.asks[0][0]) / 2;
        
        if (prevMid === 0) return 0.7;
        
        const priceChange = Math.abs(currMid - prevMid) / prevMid;
        
        // LESS SENSITIVE: Use 1% threshold instead of 0.5%
        let stability = 1 - (priceChange / 0.01); 
        
        // SMOOTHER RANGE: 0.5 to 1.0 instead of 0.3 to 1.0
        return Math.max(0.5, Math.min(1.0, stability));
        
    } catch (error) {
        return 0.7; // HIGHER error fallback
    }
}

calculateSpread([bestBid], [bestAsk]) {
    if (!bestBid || !bestAsk) return 0;
    
    const bidPrice = bestBid[0];
    const askPrice = bestAsk[0];
    
    // Handle price inversion by using absolute value
    if (bidPrice >= askPrice) {
        if (this.DEBUG) {
            console.log(`   ⚠️ Price inversion: Bid ${bidPrice} >= Ask ${askPrice}, using absolute spread`);
        }
        // Use the absolute difference and flag as problematic
        return Math.abs(askPrice - bidPrice);
    }
    
    return askPrice - bidPrice;
}

    calculateMidPrice([bestBid], [bestAsk]) {
        return bestBid && bestAsk ? (bestBid[0] + bestAsk[0]) / 2 : 0;
    }

    calculateTotalVolume(levels) {
        return levels.reduce((sum, [_, vol]) => sum + vol, 0);
    }

    calculateImbalance(bids, asks) {
        const bidVol = this.calculateTotalVolume(bids);
        const askVol = this.calculateTotalVolume(asks);
        return askVol > 0 ? bidVol / askVol : bidVol > 0 ? Infinity : 1;
    }

    findVolumeClusters(levels) {
        if (!levels.length) return [];
        const clusters = [];
        let currentCluster = { priceStart: levels[0][0], totalVolume: levels[0][1], count: 1 };

        for (let i = 1; i < levels.length; i++) {
            const [price, vol] = levels[i];
            const priceDiff = Math.abs(price - currentCluster.priceStart) / currentCluster.priceStart;

            if (priceDiff <= this.config.clusterThreshold) {
                currentCluster.totalVolume += vol;
                currentCluster.count++;
            } else {
                if (currentCluster.totalVolume >= this.config.volumeThreshold) {
                    clusters.push(currentCluster);
                }
                currentCluster = { priceStart: price, totalVolume: vol, count: 1 };
            }
        }

        if (currentCluster.totalVolume >= this.config.volumeThreshold) {
            clusters.push(currentCluster);
        }

        return clusters;
    }

    findSupportLevels(bids) {
        const supports = this.findVolumeClusters(bids)
            .filter(c => c.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);

        if (this.DEBUG && supports.length > 0) {
            console.log(`   🛡️ Support Levels: ${supports.length}`);
        }

        return supports;
    }

    findResistanceLevels(asks) {
        const resistances = this.findVolumeClusters(asks)
            .filter(c => c.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);

        if (this.DEBUG && resistances.length > 0) {
            console.log(`   🚧 Resistance Levels: ${resistances.length}`);
        }

        return resistances;
    }

    calculateVolumeChanges(current, previous, depth) {
        const priceMatches = (p1, p2) => Math.abs(p1 - p2) / ((p1 + p2) / 2) < 0.001;

        const compareLevels = (currentLevels, previousLevels) => {
            let totalChange = 0;
            currentLevels.slice(0, depth).forEach(([currPrice, currVol]) => {
                const prevLevel = previousLevels.find(([prevPrice]) => priceMatches(currPrice, prevPrice));
                totalChange += currVol - (prevLevel ? prevLevel[1] : 0);
            });
            return totalChange;
        };

        const bidVolChange = compareLevels(current.bids, previous.bids);
        const askVolChange = compareLevels(current.asks, previous.asks);

        return {
            bidVolumeChange: bidVolChange,
            askVolumeChange: askVolChange,
            netVolumeChange: bidVolChange - askVolChange
        };
    }

    isUptrend(candles) {
        if (!candles || candles.length < 3) return false;
        const recent = candles.slice(-3).map(c => c[4]);
        return recent[2] > recent[1] && recent[1] > recent[0];
    }

    isDowntrend(candles) {
        if (!candles || candles.length < 3) return false;
        const recent = candles.slice(-3).map(c => c[4]);
        return recent[2] < recent[1] && recent[1] < recent[0];
    }

    detectWalls(levels, type, symbol) {
        if (!levels?.length || levels.length < 3) return [];
        const avgVolume = levels.reduce((sum, [_, vol]) => sum + vol, 0) / levels.length;
        if (avgVolume === 0) return [];

        const threshold = avgVolume * this.config.wallDetectionMultiplier;

        const pairConfig = this.pairConfigs?.[symbol];
        const minWallVolume = (pairConfig?.minVolume || 1000) * 0.1;

        const walls = levels
            .filter(([_, vol]) => vol >= threshold && vol >= minWallVolume)
            .map(([price, vol]) => ({ price, volume: vol, type, strength: vol / avgVolume }));

        if (this.DEBUG && walls.length > 0) {
            console.log(`   🧱 ${type} Walls: ${walls.length} (min: ${minWallVolume.toFixed(0)}, threshold: ${threshold.toFixed(2)})`);
        }

        return walls;
    }
}

export default OrderBookAnalyzer;