import { promises as fs } from 'fs';
import path from 'path';
import csv from 'csv-parser';
import fsSync from 'fs';

class SignalLogger {
    constructor(bot) {
        this.bot = bot;
        this.signals = [];
    }

    async loadCSVData(symbol, csvFilePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            
            csvFilePath = path.resolve(process.cwd(), csvFilePath);
            
            if (!fsSync.existsSync(csvFilePath)) {
                reject(new Error(`CSV file not found: ${csvFilePath}`));
                return;
            }

            console.log(`📁 Loading CSV data from: ${csvFilePath}`);
            
            fsSync.createReadStream(csvFilePath)
                .pipe(csv({
                    headers: false, // No headers - pure data
                    separator: ',', // Comma separated
                    skipEmptyLines: true
                }))
                .on('data', (data) => {
                    try {
                        const candle = this.parseCSVRow(data, symbol);
                        if (candle) {
                            results.push(candle);
                        }
                    } catch (error) {
                        console.warn('Skipping invalid row:', error.message);
                    }
                })
                .on('end', () => {
                    console.log(`✅ Loaded ${results.length} candles from CSV for ${symbol}`);
                    resolve(results.sort((a, b) => a.timestamp - b.timestamp));
                })
                .on('error', (error) => {
                    reject(new Error(`CSV parsing failed: ${error.message}`));
                });
        });
    }

    parseCSVRow(data, symbol) {
        // Get all values from the row - Binance CSV has 12 columns
        const values = Object.values(data);
        
        // Binance Kline format: 
        // 0: Open time, 1: Open, 2: High, 3: Low, 4: Close, 5: Volume, 
        // 6: Close time, 7: Quote asset volume, 8: Number of trades,
        // 9: Taker buy base asset volume, 10: Taker buy quote asset volume, 11: Ignore
        
        if (values.length >= 6) {
            let timestamp = parseInt(values[0]);
            
            // ✅ FIX: Convert microseconds to milliseconds
            // Your timestamps are 16 digits (microseconds) but Date needs 13 digits (milliseconds)
            if (timestamp > 253402300800000) { // Very large number = microseconds
                timestamp = Math.floor(timestamp / 1000); // Convert microseconds to milliseconds
            }
            
            const open = parseFloat(values[1]);
            const high = parseFloat(values[2]);
            const low = parseFloat(values[3]);
            const close = parseFloat(values[4]);
            const volume = parseFloat(values[5]);
            
            if (!isNaN(timestamp) && !isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close) && !isNaN(volume)) {
                return {
                    timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume,
                    symbol
                };
            }
        }
        
        throw new Error('Invalid numeric data in CSV row');
    }

    simulateOrderBook(currentPrice, previousPrice) {
        const spread = currentPrice * 0.001;
        const baseVolume = 100;
        const priceChange = currentPrice - previousPrice;

        const bids = [];
        const asks = [];

        for (let i = 1; i <= 20; i++) {
            const bidPrice = currentPrice * (1 - (spread * i * 0.1));
            const bidVolume = baseVolume * (1 - (i * 0.05)) * (priceChange < 0 ? 1.5 : 0.8);
            bids.push([bidPrice, bidVolume]);

            const askPrice = currentPrice * (1 + (spread * i * 0.1));
            const askVolume = baseVolume * (1 - (i * 0.05)) * (priceChange > 0 ? 1.5 : 0.8);
            asks.push([askPrice, askVolume]);
        }

        return {
            bids: bids.sort((a, b) => b[0] - a[0]),
            asks: asks.sort((a, b) => a[0] - b[0])
        };
    }

    async logSignalsFromCSV(options = {}) {
        const {
            symbol = 'BTCUSDT',
            csvFilePath,
            analysisInterval = 4,
            minSignalScore = 7,
            startDate = null,
            endDate = null
        } = options;

        console.log(`📊 Starting Signal Logger for ${symbol}`);
        console.log(`📁 CSV File: ${csvFilePath}`);

        const allData = await this.loadCSVData(symbol, csvFilePath);
        const filteredData = this.filterDataByDate(allData, startDate, endDate);
        
        if (filteredData.length === 0) {
            throw new Error('No data available after date filtering');
        }

        console.log(`📈 Analyzing ${filteredData.length} candles...`);

        return await this.analyzeSignals(filteredData, symbol, analysisInterval, minSignalScore);
    }

    filterDataByDate(data, startDate, endDate) {
        let filtered = data;
        
        console.log(`📅 Data range in CSV: ${new Date(data[0].timestamp).toISOString()} to ${new Date(data[data.length-1].timestamp).toISOString()}`);
        
        if (startDate) {
            const startTimestamp = new Date(startDate).getTime();
            console.log(`🔍 Filtering from: ${startDate} (${startTimestamp})`);
            filtered = filtered.filter(d => d.timestamp >= startTimestamp);
        }
        
        if (endDate) {
            const endTimestamp = new Date(endDate).getTime();
            console.log(`🔍 Filtering to: ${endDate} (${endTimestamp})`);
            filtered = filtered.filter(d => d.timestamp <= endTimestamp);
        }
        
        console.log(`📊 After filtering: ${filtered.length} candles remaining`);
        return filtered;
    }

    async analyzeSignals(testData, symbol, analysisInterval, minSignalScore) {
        const state = {
            currentCandles: [],
            signals: []
        };

        // SIMULATE THE INITIAL CANDLE FETCH - like the live bot does
        // Take enough candles to meet the minimum requirement
        const minCandlesRequired = this.bot.config.riskManagement.minCandlesForAnalysis; // This is 50
        const initialCandleCount = Math.min(150, testData.length - 50); // Increased to 150
        
        state.currentCandles = this.convertToCandleArray(testData.slice(0, initialCandleCount));
        
        console.log(`🔥 Simulated initial candle fetch: ${state.currentCandles.length} candles`);
        console.log(`📈 Analyzing ${testData.length} total candles...`);
        console.log(`🎯 Min candles required: ${minCandlesRequired}`);

        // Start analysis from where the initial data ends
        const startIndex = initialCandleCount;
        
        for (let i = startIndex; i < testData.length; i++) {
            if (i % 100 === 0) { // More frequent progress updates
                console.log(`Progress: ${i}/${testData.length} (${Math.round((i/testData.length)*100)}%) - Signals: ${state.signals.length}`);
            }

            // Analyze EVERY candle to catch all signals
            await this.analyzeCandle(testData, i, symbol, state, minSignalScore);
        }

        console.log(`\n✅ Analysis complete! Found ${state.signals.length} signals`);
        await this.generateReport(state, symbol, testData);

        return state.signals;
    }

    async analyzeCandle(testData, currentIndex, symbol, state, minSignalScore) {
        const currentData = testData[currentIndex];
        const previousData = testData[currentIndex - 1] || currentData;
        
        // Update candles
        const newCandle = [
            currentData.timestamp,
            currentData.open,
            currentData.high,
            currentData.low,
            currentData.close,
            currentData.volume
        ];
        
        state.currentCandles.push(newCandle);
        if (state.currentCandles.length > this.bot.config.maxCandles) {
            state.currentCandles.shift();
        }

        // Simulate order book
        const orderBook = this.simulateOrderBook(currentData.close, previousData.close);
        const previousOrderBook = this.simulateOrderBook(
            previousData.close, 
            testData[Math.max(0, currentIndex-2)]?.close || previousData.close
        );

        // Update bot's market data
        this.bot.marketData[symbol] = {
            candles: state.currentCandles,
            orderBook: orderBook,
            previousOrderBook: previousOrderBook,
            lastAnalysis: null
        };

        try {
            const analysis = await this.bot.analyzeMarket(symbol);
            
            if (analysis && analysis.signals) {
                const signalType = analysis.signals.compositeSignal;
                const signalScore = analysis.signals.signalScore?.[signalType];
                
                if (signalType !== 'neutral' && signalScore >= minSignalScore) {
                    const signal = {
                        timestamp: currentData.timestamp,
                        datetime: new Date(currentData.timestamp).toISOString(),
                        symbol: symbol,
                        signal: signalType,
                        score: signalScore,
                        price: currentData.close,
                        indicators: {
                            emaFast: analysis.indicators?.emaFast,
                            emaMedium: analysis.indicators?.emaMedium,
                            emaSlow: analysis.indicators?.emaSlow,
                            rsi: analysis.indicators?.rsi
                        }
                    };

                    state.signals.push(signal);
                    
                    // Real-time logging
                    console.log(`🎯 ${signal.datetime} | ${symbol} | ${signal.signal.toUpperCase()} | Score: ${signal.score} | Price: ${signal.price.toFixed(4)}`);
                }
            }
        } catch (error) {
            // Silent continue on analysis errors
        }
    }

    convertToCandleArray(data) {
        return data.map(d => [d.timestamp, d.open, d.high, d.low, d.close, d.volume]);
    }

    async generateReport(state, symbol, testData) {
        const signals = state.signals;
        const longSignals = signals.filter(s => s.signal === 'long');
        const shortSignals = signals.filter(s => s.signal === 'short');
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 SIGNAL ANALYSIS REPORT');
        console.log('='.repeat(70));
        console.log(`Symbol: ${symbol}`);
        console.log(`Total Candles: ${testData.length}`);
        console.log(`Total Signals: ${signals.length}`);
        console.log(`Long Signals: ${longSignals.length}`);
        console.log(`Short Signals: ${shortSignals.length}`);
        
        console.log(`\n📈 RECENT SIGNALS:`);
        const recentSignals = signals.slice(-10);
        recentSignals.forEach(signal => {
            console.log(`   ${signal.datetime} | ${signal.signal.toUpperCase()} | Score: ${signal.score}`);
        });

        console.log('='.repeat(70));

        // Save to file
        await this.saveToFile(signals, symbol);
    }

    async saveToFile(signals, symbol) {
        const report = {
            symbol: symbol,
            timestamp: new Date().toISOString(),
            signals: signals
        };

        const filename = `signals_${symbol}_${Date.now()}.json`;
        const dirpath = path.join(process.cwd(), 'reports/');
        
        await fs.mkdir(dirpath, { recursive: true });
        await fs.writeFile(path.join(dirpath, filename), JSON.stringify(report, null, 2));
        
        console.log(`📁 Signal report saved: reports/${filename}`);
    }
}

export default SignalLogger;