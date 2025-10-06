class OrderBookAnalyzer {
    constructor() {
        this.config = {
            depthLevels: 20,
            volumeThreshold: 0.2,
            imbalanceThreshold: 1.5,  // 🎯 REDUCED from 1.8 to 1.5
            clusterThreshold: 0.001,
            spikeThreshold: 2.5,      // 🎯 REDUCED from 3.0 to 2.5
            priceChangeThreshold: 0.0001,
            wallDetectionMultiplier: 3
        };
        this.DEBUG = process.env.DEBUG === 'true'; // Enable debug logs via environment variable
    }

    analyze(orderBook, previousOrderBook = null, candles = []) {
        //console.log(orderBook)
        const { bids, asks } = orderBook;
        const depth = this.config.depthLevels;
        const topBids = bids.slice(0, depth);
        const topAsks = asks.slice(0, depth);
        
        // DEBUG: Basic order book info
        if (this.DEBUG) {
            console.log(`\n📊 ORDER BOOK ANALYZER DEBUG`);
            console.log(`   Top Bid: ${topBids[0]?.[0]?.toFixed(4)} (Vol: ${topBids[0]?.[1]?.toFixed(2)})`);
            console.log(`   Top Ask: ${topAsks[0]?.[0]?.toFixed(4)} (Vol: ${topAsks[0]?.[1]?.toFixed(2)})`);
            console.log(`   Spread: ${(topAsks[0]?.[0] - topBids[0]?.[0])?.toFixed(4)}`);
        }
        
        const metrics = {
            spread: this.calculateSpread(topBids, topAsks),
            midPrice: this.calculateMidPrice(topBids, topAsks),
            totalBidVolume: this.calculateTotalVolume(topBids),
            totalAskVolume: this.calculateTotalVolume(topAsks),
            bidAskImbalance: this.calculateImbalance(topBids, topAsks),
            supportLevels: this.findSupportLevels(topBids),
            resistanceLevels: this.findResistanceLevels(topAsks)
        };

        if (previousOrderBook) {
            metrics.priceChanges = this.calculatePriceChanges(orderBook, previousOrderBook, depth);
            metrics.volumeChanges = this.calculateVolumeChanges(orderBook, previousOrderBook, depth);
        }

        const signals = this.generateSignals(metrics, topBids, topAsks, candles);
        
        // DEBUG: Metrics and signals
        if (this.DEBUG) {
            console.log(`   METRICS:`);
            console.log(`   ├── Bid Volume: ${metrics.totalBidVolume.toFixed(2)}`);
            console.log(`   ├── Ask Volume: ${metrics.totalAskVolume.toFixed(2)}`);
            console.log(`   ├── Imbalance: ${metrics.bidAskImbalance.toFixed(2)}`);
            console.log(`   ├── Support Levels: ${metrics.supportLevels.length}`);
            console.log(`   └── Resistance Levels: ${metrics.resistanceLevels.length}`);
            
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
            console.log(`   ├── In Uptrend: ${signals.inUptrend}`);
            console.log(`   ├── In Downtrend: ${signals.inDowntrend}`);
            console.log(`   └── Composite: ${signals.compositeSignal}`);
        }
        
        return {
            metrics,
            signals,
            timestamp: Date.now()
        };
    }

    calculateSpread([bestBid], [bestAsk]) {
        return bestBid && bestAsk ? bestAsk[0] - bestBid[0] : 0;
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
        return askVol > 0 ? bidVol / askVol : bidVol > 0 ? Infinity : 0;
    }

    findVolumeClusters(levels) {
        if (!levels.length) return [];
        const clusters = [];
        let currentCluster = {
            priceStart: levels[0][0],
            priceEnd: levels[0][0],
            totalVolume: levels[0][1],
            levels: [levels[0]]
        };
        
        for (let i = 1; i < levels.length; i++) {
            const [price, vol] = levels[i];
            const priceDiff = Math.abs(price - currentCluster.priceEnd) / currentCluster.priceEnd;
            if (priceDiff <= this.config.clusterThreshold) {
                currentCluster.priceEnd = price;
                currentCluster.totalVolume += vol;
                currentCluster.levels.push(levels[i]);
            } else {
                if (currentCluster.totalVolume >= this.config.volumeThreshold) {
                    clusters.push(currentCluster);
                }
                currentCluster = {
                    priceStart: price,
                    priceEnd: price,
                    totalVolume: vol,
                    levels: [levels[i]]
                };
            }
        }
        if (currentCluster.totalVolume >= this.config.volumeThreshold) {
            clusters.push(currentCluster);
        }
        
        // DEBUG: Cluster detection
        if (this.DEBUG && clusters.length > 0) {
            console.log(`   🔍 Volume Clusters: ${clusters.length} found`);
            clusters.forEach((cluster, index) => {
                console.log(`      Cluster ${index + 1}: ${cluster.totalVolume.toFixed(2)} vol at ${cluster.priceStart.toFixed(4)}-${cluster.priceEnd.toFixed(4)}`);
            });
        }
        
        return clusters;
    }

    findSupportLevels(bids) {
        const supports = this.findVolumeClusters(bids)
            .filter(c => c.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);
            
        // DEBUG: Support levels
        if (this.DEBUG && supports.length > 0) {
            console.log(`   🛡️ Support Levels: ${supports.length} significant`);
            supports.forEach((support, index) => {
                console.log(`      Support ${index + 1}: ${support.totalVolume.toFixed(2)} vol at ${support.priceStart.toFixed(4)}`);
            });
        }
        
        return supports;
    }

    findResistanceLevels(asks) {
        const resistances = this.findVolumeClusters(asks)
            .filter(c => c.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);
            
        // DEBUG: Resistance levels
        if (this.DEBUG && resistances.length > 0) {
            console.log(`   🚧 Resistance Levels: ${resistances.length} significant`);
            resistances.forEach((resistance, index) => {
                console.log(`      Resistance ${index + 1}: ${resistance.totalVolume.toFixed(2)} vol at ${resistance.priceStart.toFixed(4)}`);
            });
        }
        
        return resistances;
    }

    calculatePriceChanges(current, previous, depth) {
        const getWeightedPrice = (levels) => {
            if (!levels?.length) return 0;
            const topLevels = levels.slice(0, depth);
            const totalVolume = topLevels.reduce((sum, [_, vol]) => sum + vol, 0);
            return totalVolume > 0 
                ? topLevels.reduce((sum, [price, vol]) => sum + (price * vol), 0) / totalVolume
                : topLevels[0][0];
        };

        const currentBid = getWeightedPrice(current.bids);
        const currentAsk = getWeightedPrice(current.asks);
        const prevBid = getWeightedPrice(previous.bids);
        const prevAsk = getWeightedPrice(previous.asks);

        const significantChange = (current, prev) => 
            Math.abs(current - prev) > this.config.priceChangeThreshold ? current - prev : 0;

        const changes = {
            bidPriceChange: significantChange(currentBid, prevBid),
            askPriceChange: significantChange(currentAsk, prevAsk),
            spreadChange: (currentAsk - currentBid) - (prevAsk - prevBid)
        };
        
        // DEBUG: Price changes
        if (this.DEBUG && (changes.bidPriceChange !== 0 || changes.askPriceChange !== 0)) {
            console.log(`   🔄 Price Changes: Bid=${changes.bidPriceChange.toFixed(6)}, Ask=${changes.askPriceChange.toFixed(6)}`);
        }
        
        return changes;
    }

    calculateVolumeChanges(current, previous, depth) {
        const priceMatches = (p1, p2) => Math.abs(p1 - p2) / Math.min(p1, p2) < 0.0001; // 0.01% tolerance
        
        const compareLevels = (currentLevels, previousLevels) => {
            return currentLevels.slice(0, depth).map(([currPrice, currVol]) => {
                const prevLevel = previousLevels.find(([prevPrice]) => 
                    priceMatches(currPrice, prevPrice)
                );
                return {
                    price: currPrice,
                    currentVolume: currVol,
                    previousVolume: prevLevel ? prevLevel[1] : 0,
                    volumeChange: currVol - (prevLevel ? prevLevel[1] : 0)
                };
            });
        };

        const bidChanges = compareLevels(current.bids, previous.bids);
        const askChanges = compareLevels(current.asks, previous.asks);

        const bidVolChange = bidChanges.reduce((sum, {volumeChange}) => sum + volumeChange, 0);
        const askVolChange = askChanges.reduce((sum, {volumeChange}) => sum + volumeChange, 0);

        const changes = {
            bidVolumeChange: bidVolChange,
            askVolumeChange: askVolChange,
            netVolumeChange: bidVolChange - askVolChange,
            bidLevelsChanged: bidChanges.filter(l => l.volumeChange !== 0).length,
            askLevelsChanged: askChanges.filter(l => l.volumeChange !== 0).length
        };
        
        // DEBUG: Volume changes
        if (this.DEBUG && (changes.bidVolumeChange !== 0 || changes.askVolumeChange !== 0)) {
            console.log(`   🔄 Volume Changes: Bid=${changes.bidVolumeChange.toFixed(2)}, Ask=${changes.askVolumeChange.toFixed(2)}, Net=${changes.netVolumeChange.toFixed(2)}`);
            console.log(`      Levels Changed: Bid=${changes.bidLevelsChanged}, Ask=${changes.askLevelsChanged}`);
        }
        
        return changes;
    }

    generateSignals(metrics, topBids, topAsks, candles) {
        const signals = {
            strongBidImbalance: metrics.bidAskImbalance >= this.config.imbalanceThreshold,
            strongAskImbalance: metrics.bidAskImbalance <= (1 / this.config.imbalanceThreshold),
            supportDetected: metrics.supportLevels.length > 0,
            resistanceDetected: metrics.resistanceLevels.length > 0,
            bidWalls: this.detectWalls(topBids, 'bid'),
            askWalls: this.detectWalls(topAsks, 'ask'),
            pricePressure: 'neutral',
            // 🎯 NEW: Add trend context
            inUptrend: this.isUptrend(candles),
            inDowntrend: this.isDowntrend(candles)
        };
        
        if (metrics.volumeChanges) {
            const avgChange = (Math.abs(metrics.volumeChanges.bidVolumeChange) + 
                             Math.abs(metrics.volumeChanges.askVolumeChange)) / 2;
            const netChange = metrics.volumeChanges.netVolumeChange;
            
            // 🎯 ENHANCED: More sensitive spike detection
            const totalVolume = metrics.totalBidVolume + metrics.totalAskVolume;
            const volumeChangeRatio = Math.abs(netChange) / (totalVolume > 0 ? totalVolume : 1);
            
            signals.volumeSpike = Math.abs(netChange) > avgChange * this.config.spikeThreshold 
                                 || volumeChangeRatio > 0.1; // 10% of total volume
            
            if (netChange > avgChange * 2) signals.pricePressure = 'strong_up';
            else if (netChange > avgChange) signals.pricePressure = 'up';
            else if (netChange < -avgChange * 2) signals.pricePressure = 'strong_down';
            else if (netChange < -avgChange) signals.pricePressure = 'down';
            
            // DEBUG: Volume spike analysis
            if (this.DEBUG) {
                console.log(`   🔊 Volume Analysis: AvgChange=${avgChange.toFixed(2)}, NetChange=${netChange.toFixed(2)}, Spike=${signals.volumeSpike}`);
                console.log(`   📈 Volume Change Ratio: ${(volumeChangeRatio * 100).toFixed(2)}%`);
            }
        }
        
        signals.compositeSignal = this.generateCompositeSignal(signals, metrics, candles);
        
        return signals;
    }

    // 🎯 NEW: Trend detection helpers
    isUptrend(candles) {
        if (!candles || candles.length < 3) return false;
        const recentPrices = candles.slice(-3).map(c => c[4]); // closing prices
        return recentPrices[2] > recentPrices[1] && recentPrices[1] > recentPrices[0];
    }

    isDowntrend(candles) {
        if (!candles || candles.length < 3) return false;
        const recentPrices = candles.slice(-3).map(c => c[4]); // closing prices
        return recentPrices[2] < recentPrices[1] && recentPrices[1] < recentPrices[0];
    }

    detectWalls(levels, type) {
        if (!levels?.length) return [];
        const avgVolume = this.calculateAverageVolume(levels);
        const threshold = avgVolume * this.config.wallDetectionMultiplier;
        const walls = levels
            .filter(([_, vol]) => vol >= threshold)
            .map(([price, vol]) => ({
                price,
                volume: vol,
                type,
                strength: vol / avgVolume
            }));
            
        // DEBUG: Wall detection
        if (this.DEBUG && walls.length > 0) {
            console.log(`   🧱 ${type.toUpperCase()} Walls: ${walls.length} detected`);
            walls.forEach((wall, index) => {
                console.log(`      Wall ${index + 1}: ${wall.volume.toFixed(2)} vol at ${wall.price.toFixed(4)} (${wall.strength.toFixed(1)}x avg)`);
            });
        }
        
        return walls;
    }

    calculateAverageVolume(levels) {
        return levels?.length ? levels.reduce((sum, [_, vol]) => sum + vol, 0) / levels.length : 0;
    }

    generateCompositeSignal(signals, metrics, candles) {
        // 🎯 ENHANCED: More comprehensive signal detection
        
        // Strong buy signals
        if (signals.strongBidImbalance && signals.supportDetected) {
            if (this.DEBUG) console.log(`   🎯 Composite: STRONG_BUY (Bid Imbalance + Support)`);
            return 'strong_buy';
        }
        
        // Strong sell signals
        if (signals.strongAskImbalance && signals.resistanceDetected) {
            if (this.DEBUG) console.log(`   🎯 Composite: STRONG_SELL (Ask Imbalance + Resistance)`);
            return 'strong_sell';
        }
        
        // 🎯 NEW: Volume pressure with support/resistance
        if (signals.pricePressure === 'strong_up' && signals.supportDetected) {
            if (this.DEBUG) console.log(`   🎯 Composite: BUY (Strong Volume Up + Support)`);
            return 'buy';
        }
        if (signals.pricePressure === 'strong_down' && signals.resistanceDetected) {
            if (this.DEBUG) console.log(`   🎯 Composite: SELL (Strong Volume Down + Resistance)`);
            return 'sell';
        }
        
        // 🎯 NEW: Significant imbalance alone
        if (signals.strongBidImbalance && metrics.bidAskImbalance > 2.0) {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_BUY (Strong Bid Imbalance)`);
            return 'weak_buy';
        }
        if (signals.strongAskImbalance && metrics.bidAskImbalance < 0.5) {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_SELL (Strong Ask Imbalance)`);
            return 'weak_sell';
        }
        
        // Volume-based signals
        if (signals.volumeSpike) {
            if (signals.pricePressure === 'strong_up') {
                if (this.DEBUG) console.log(`   🎯 Composite: BUY (Strong Volume Up)`);
                return 'buy';
            }
            if (signals.pricePressure === 'strong_down') {
                if (this.DEBUG) console.log(`   🎯 Composite: SELL (Strong Volume Down)`);
                return 'sell';
            }
            if (signals.pricePressure === 'up') {
                if (this.DEBUG) console.log(`   🎯 Composite: WEAK_BUY (Volume Up)`);
                return 'weak_buy';
            }
            if (signals.pricePressure === 'down') {
                if (this.DEBUG) console.log(`   🎯 Composite: WEAK_SELL (Volume Down)`);
                return 'weak_sell';
            }
        }
        
        // 🎯 NEW: Wall dominance
        if (signals.bidWalls.length > signals.askWalls.length * 2) {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_BUY (Bid Wall Dominance)`);
            return 'weak_buy';
        }
        if (signals.askWalls.length > signals.bidWalls.length * 2) {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_SELL (Ask Wall Dominance)`);
            return 'weak_sell';
        }
        
        // Wall-based signals
        if (signals.bidWalls.length > 0 && !signals.askWalls.length) {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_BUY (Bid Walls)`);
            return 'weak_buy';
        }
        if (signals.askWalls.length > 0 && !signals.bidWalls.length) {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_SELL (Ask Walls)`);
            return 'weak_sell';
        }
        
        // 🎯 NEW: Moderate imbalance with volume
        if (metrics.bidAskImbalance > 1.3 && signals.pricePressure === 'up') {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_BUY (Moderate Imbalance + Up Pressure)`);
            return 'weak_buy';
        }
        if (metrics.bidAskImbalance < 0.7 && signals.pricePressure === 'down') {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_SELL (Moderate Imbalance + Down Pressure)`);
            return 'weak_sell';
        }
        
        // 🎯 NEW: Trend alignment with order book
        if (signals.inUptrend && signals.supportDetected && signals.pricePressure === 'up') {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_BUY (Uptrend + Support + Up Pressure)`);
            return 'weak_buy';
        }
        if (signals.inDowntrend && signals.resistanceDetected && signals.pricePressure === 'down') {
            if (this.DEBUG) console.log(`   🎯 Composite: WEAK_SELL (Downtrend + Resistance + Down Pressure)`);
            return 'weak_sell';
        }
        
        if (this.DEBUG) console.log(`   🎯 Composite: NEUTRAL`);
        return 'neutral';
    }
}

export default OrderBookAnalyzer;