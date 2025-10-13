import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class VisualizationServer {
    constructor(bot, port = 3000) {
        this.bot = bot;
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            pingTimeout: 5000,
            pingInterval: 10000
        });
        
        this.analysisHistory = new Map();
        this.candleData = new Map();
        this.isShuttingDown = false;
        
        this.setupServer();
        this.setupSocketHandlers();
        this.startCandleDataCollection();
        this.startStatusBroadcast();
    }

    setupServer() {
        this.app.use(express.static(path.join(__dirname, 'public')));
        
        this.app.get('/api/bot-status', (req, res) => {
            res.json(this.getBotStatus());
        });

        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`📊 Client connected: ${socket.id}`);
            
            // Send all current data when client connects
            socket.emit('initial-data', {
                analysis: this.getAllAnalysis(),
                botStatus: this.getBotStatus(),
                symbols: Object.keys(this.bot.config.tradingPairs)
            });

            socket.on('request-candles', (data) => {
                const { symbol, limit = 100 } = data;
                const candles = this.candleData.get(symbol) || [];
                socket.emit('candle-data', {
                    symbol,
                    candles: candles.slice(-limit)
                });
            });

            // ADD THIS: Handle status requests
            socket.on('request-status', () => {
                socket.emit('bot-status', this.getBotStatus());
            });

            socket.on('disconnect', () => {
                console.log(`📊 Client disconnected: ${socket.id}`);
            });
        });
    }

    startCandleDataCollection() {
        this.candleInterval = setInterval(() => {
            if (this.isShuttingDown) return;
            
            Object.keys(this.bot.config.tradingPairs).forEach(symbol => {
                const symbolData = this.bot.marketData[symbol];
                if (symbolData?.candles?.length > 0) {
                    const formattedCandles = symbolData.candles.map(candle => ({
                        timestamp: candle[0],
                        open: candle[1],
                        high: candle[2],
                        low: candle[3],
                        close: candle[4],
                        volume: candle[5]
                    }));
                    this.candleData.set(symbol, formattedCandles);
                }
            });
        }, 5000);
    }

    startStatusBroadcast() {
        this.statusInterval = setInterval(() => {
            if (!this.isShuttingDown) {
                this.io.emit('bot-status', this.getBotStatus());
            }
        }, 5000);
    }

    storeAnalysis(analysisResult) {
        if (!analysisResult?.symbol || this.isShuttingDown) return;

        const symbolData = this.analysisHistory.get(analysisResult.symbol) || [];
        
        const analysisWithTimestamp = {
            ...analysisResult,
            receivedAt: new Date().toISOString()
        };

        symbolData.unshift(analysisWithTimestamp);
        
        // Keep only last 100 analyses
        if (symbolData.length > 100) symbolData.splice(100);
        
        this.analysisHistory.set(analysisResult.symbol, symbolData);

        if (!this.isShuttingDown) {
            this.io.emit('analysis-update', analysisWithTimestamp);
        }
    }

    getAllAnalysis() {
        const allAnalysis = {};
        for (const [symbol, analyses] of this.analysisHistory.entries()) {
            allAnalysis[symbol] = analyses[0]; // Latest analysis
        }
        return allAnalysis;
    }

    getBotStatus() {
        return {
            isRunning: this.bot.isRunning,
            startTime: this.bot.startTime,
            uptime: Date.now() - this.bot.startTime,
            testMode: this.bot.testMode,
            timeframe: this.bot.timeframe,
            tradingPairs: Object.keys(this.bot.config.tradingPairs),
            lastUpdate: new Date().toISOString()
        };
    }

    onAnalysisComplete(analysisResults) {
        if (this.isShuttingDown) return;
        analysisResults?.forEach(result => {
            if (result) this.storeAnalysis(result);
        });
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, () => {
                console.log(`🚀 Visualization server running on http://localhost:${this.port}`);
                resolve();
            }).on('error', reject);
        });
    }

    async stop() {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        console.log('📊 Stopping visualization server...');

        return new Promise((resolve) => {
            // Clear intervals
            if (this.candleInterval) clearInterval(this.candleInterval);
            if (this.statusInterval) clearInterval(this.statusInterval);

            // Close sockets and server
            if (this.io) {
                this.io.disconnectSockets();
                this.io.close();
            }

            this.server.close(() => {
                console.log('✅ Visualization server stopped');
                resolve();
            });

            setTimeout(() => {
                console.log('⚠️ Visualization server force stopped');
                resolve();
            }, 2000);
        });
    }
}

export default VisualizationServer;