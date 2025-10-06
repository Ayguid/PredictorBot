const RateLimitedQueue = require('./../classes/RateLimitedQueue');
const WebSocket = require('ws');
const { 
  klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount, 
  placeOrder, cancelOrder, cancelAndReplace, exchangeInfo, depth, 
  createListenKey, keepAliveListenKey, closeListenKey 
} = require('../binance-rest');

class ExchangeManager {
    constructor(config) {
        this.config = config;
        this.queue = new RateLimitedQueue(1100, 1800, 20);
        this.exchangeInfo = {};
        this.listenKey = null;
        this.keepAliveInterval = null;
        this.wsBaseUrl = 'wss://stream.binance.com:9443';
        this.sockets = {};
        this.subscribers = {
            kline: {},
            depth: {},
            userData: {}
        };
        this.reconnectTimeouts = new Map(); // Track reconnection timeouts
        this.isShuttingDown = false; // Track shutdown state - ONLY set to true during shutdown
    }

    async init() {
        try {
            // 🎯 CRITICAL: Reset shutdown state on initialization
            this.isShuttingDown = false;
            console.log('Fetching exchange information');
            this.exchangeInfo = await this.fetchExchangeInfo();
            console.log('Exchange information loaded');
            console.log('\x1b[42m%s\x1b[0m', 'Exchange Manager initialized successfully');
        } catch (error) {
            console.error('Error initializing Exchange Manager:', error);
            process.exit(1);
        }
    }
    
    async makeQueuedReq(apiFunction, ...args) {
        return new Promise((resolve, reject) => {
            this.queue.enqueue(async (done) => {
                try {
                    const result = await apiFunction(...args);
                    resolve(result);
                } catch (error) {
                    console.error(`Error executing request with arguments:`, args, error);
                    reject(error);
                } finally {
                    done();
                }
            });
        });
    }

    async fetchExchangeInfo() {
        return await this.makeQueuedReq(exchangeInfo);
    }

    async getUSDTBalance() {
        return await this.makeQueuedReq(userAsset, 'USDT');
    }

    async getSymbolInfo(pair) {
        if (!this.exchangeInfo.symbols) {
            await this.fetchExchangeInfo(); // Ensure exchange info is loaded
        }
        
        const symbolInfo = this.exchangeInfo.symbols.find(s => s.symbol === pair);
        if (!symbolInfo) {
            throw new Error(`Symbol info not found for ${pair}`);
        }
        
        return {
            symbol: symbolInfo.symbol,
            filters: symbolInfo.filters.reduce((acc, filter) => {
                acc[filter.filterType] = filter;
                return acc;
            }, {}),
            baseAsset: symbolInfo.baseAsset,
            quoteAsset: symbolInfo.quoteAsset
        };
    }

    async fetchBalance() {
        return await this.makeQueuedReq(fetchMyAccount);
    }

    async createOrder(...args) {
        return await this.makeQueuedReq(placeOrder, ...args);
    }

    async fetchKlines(...args) {
        return await this.makeQueuedReq(klines, ...args);
    }

    async fetchOrders(pair) {
        return await this.makeQueuedReq(fetchMyOrders, pair);
    }

    async fetchDepth(pair) {
        return await this.makeQueuedReq(depth, pair);
    }

    async subscribeToKline(pair, timeframe, callback) {
        if (!this.subscribers.kline[pair]) {
            this.subscribers.kline[pair] = [];
        }
        this.subscribers.kline[pair].push(callback);

        if (!this.sockets[`${pair}_kline`]) {
            await this.connectKlineSocket(pair, timeframe);
        }
    }

    async subscribeToDepth(pair, callback) {
        if (!this.subscribers.depth[pair]) {
            this.subscribers.depth[pair] = [];
        }
        this.subscribers.depth[pair].push(callback);

        if (!this.sockets[`${pair}_depth`]) {
            await this.connectDepthSocket(pair);
        }
    }

    async subscribeToUserData(callback) {
        this.subscribers.userData.global = callback;
        if (!this.sockets.userData) {
            await this.connectUserDataStream();
        }
    }

    connectKlineSocket(pair, timeframe) {
        return new Promise((resolve, reject) => {
            // Don't connect if we're shutting down
            if (this.isShuttingDown) {
                console.log(`❌ Skipping kline connection for ${pair} - shutdown in progress`);
                resolve();
                return;
            }

            const klineWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@kline_${timeframe}`;
            const klineWs = new WebSocket(klineWsUrl);
            
            klineWs.on('open', () => {
                if (this.isShuttingDown) {
                    klineWs.close();
                    return;
                }
                console.log(`Connected to ${pair} kline websocket`);
                resolve();
            });

            klineWs.on('message', (data) => {
                if (this.isShuttingDown) return;
                const parsedData = JSON.parse(data);
                if (this.subscribers.kline[pair]) {
                    this.subscribers.kline[pair].forEach(callback => callback(parsedData));
                }
            });

            klineWs.on('close', async () => {
                console.log(`Kline websocket for ${pair} disconnected`);
                delete this.sockets[`${pair}_kline`];
                
                // 🎯 ONLY reconnect if we're NOT shutting down
                if (!this.isShuttingDown) {
                    const timeoutId = setTimeout(() => {
                        if (!this.isShuttingDown) {
                            this.connectKlineSocket(pair, timeframe);
                        }
                    }, 5000);
                    this.reconnectTimeouts.set(`${pair}_kline`, timeoutId);
                    console.log(`⏰ Scheduled kline reconnection for ${pair} in 5 seconds`);
                } else {
                    console.log(`❌ Kline reconnection skipped for ${pair} - shutdown in progress`);
                }
            });

            klineWs.on('error', (error) => {
                console.error(`Kline websocket error for ${pair}:`, error);
                reject(error);
            });

            this.sockets[`${pair}_kline`] = klineWs;
        });
    }

    connectDepthSocket(pair) {
        return new Promise((resolve, reject) => {
            // Don't connect if we're shutting down
            if (this.isShuttingDown) {
                console.log(`❌ Skipping depth connection for ${pair} - shutdown in progress`);
                resolve();
                return;
            }

            const depthWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@depth20@100ms`;
            const depthWs = new WebSocket(depthWsUrl);
    
            depthWs.on('open', () => {
                if (this.isShuttingDown) {
                    depthWs.close();
                    return;
                }
                console.log(`Connected to ${pair} depth websocket`);
                resolve();
            });
    
            depthWs.on('message', (data) => {
                if (this.isShuttingDown) return;
                const parsedData = JSON.parse(data);
                //console.log(parsedData)
                if (this.subscribers.depth[pair]) {
                    this.subscribers.depth[pair].forEach(callback => callback(parsedData));
                }
            });
    
            depthWs.on('close', async () => {
                console.log(`Depth websocket for ${pair} disconnected`);
                delete this.sockets[`${pair}_depth`];
                
                // 🎯 ONLY reconnect if we're NOT shutting down
                if (!this.isShuttingDown) {
                    const timeoutId = setTimeout(() => {
                        if (!this.isShuttingDown) {
                            this.connectDepthSocket(pair);
                        }
                    }, 5000);
                    this.reconnectTimeouts.set(`${pair}_depth`, timeoutId);
                    console.log(`⏰ Scheduled depth reconnection for ${pair} in 5 seconds`);
                } else {
                    console.log(`❌ Depth reconnection skipped for ${pair} - shutdown in progress`);
                }
            });
    
            depthWs.on('error', (error) => {
                console.error(`Depth websocket error for ${pair}:`, error);
                reject(error);
            });
    
            this.sockets[`${pair}_depth`] = depthWs;
        });
    }
    
    async connectUserDataStream() {
        try {
            const listenKey = await this.createUserDataStream();
    
            return new Promise((resolve, reject) => {
                const userWs = new WebSocket(`${this.wsBaseUrl}/ws/${listenKey}`);
    
                userWs.on('open', () => {
                    if (this.isShuttingDown) {
                        userWs.close();
                        return;
                    }
                    console.log('Connected to user data stream');
                    resolve();
                });
    
                userWs.on('message', (data) => {
                    if (this.isShuttingDown) return;
                    const parsedData = JSON.parse(data);
                    if (this.subscribers.userData.global) {
                        this.subscribers.userData.global(parsedData);
                    }
                });
    
                userWs.on('error', (error) => {
                    console.error('User data stream error:', error);
                    reject(error);
                });
    
                userWs.on('close', async () => {
                    console.log('User data stream disconnected');
                    await this.closeUserDataStream();
                    
                    // 🎯 ONLY reconnect if we're NOT shutting down
                    if (!this.isShuttingDown) {
                        setTimeout(() => {
                            if (!this.isShuttingDown) {
                                this.connectUserDataStream();
                            }
                        }, 5000);
                    } else {
                        console.log('❌ User data stream reconnection skipped - shutdown in progress');
                    }
                });
    
                this.sockets.userData = userWs;
            });
        } catch (error) {
            console.error('Error connecting to user data stream:', error);
            throw error;
        }
    }
    
    async createUserDataStream() {
        try {
            const response = await this.makeQueuedReq(createListenKey);
            this.listenKey = response.listenKey;
            console.log('User Data Stream started. Listen Key:', this.listenKey);
            
            this.keepAliveInterval = setInterval(
                () => this.keepAliveUserDataStream(),
                30 * 60 * 1000
            );
            
            return this.listenKey;
        } catch (error) {
            console.error('Failed to create User Data Stream:', error);
            throw error;
        }
    }

    async keepAliveUserDataStream() {
        if (!this.listenKey || this.isShuttingDown) {
            console.warn('No active listen key to keep alive or shutting down.');
            return;
        }
        try {
            await this.makeQueuedReq(keepAliveListenKey, this.listenKey);
            console.log('User Data Stream kept alive:', this.listenKey);
        } catch (error) {
            console.error('Failed to keep alive User Data Stream:', error);
        }
    }

    async closeUserDataStream() {
        if (!this.listenKey) {
            console.warn('No active listen key to close.');
            return;
        }
        try {
            await this.makeQueuedReq(closeListenKey, this.listenKey);
            console.log('User Data Stream closed:', this.listenKey);
            
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval);
                this.keepAliveInterval = null;
            }
            
            this.listenKey = null;
        } catch (error) {
            console.error('Failed to close User Data Stream:', error);
            throw error;
        }
    }

    closeAllConnections() {
        console.log('🛑 Closing all websocket connections...');
        
        // 🎯 MARK AS SHUTTING DOWN - this prevents ALL reconnections
        this.isShuttingDown = true;
        
        // Clear all reconnection timeouts FIRST
        this.reconnectTimeouts.forEach((timeoutId, key) => {
            clearTimeout(timeoutId);
            console.log(`🧹 Cleared reconnection timeout for ${key}`);
        });
        this.reconnectTimeouts.clear();
        
        // Close all sockets
        Object.entries(this.sockets).forEach(([key, socket]) => {
            if (socket) {
                console.log(`🔌 Closing ${key}`);
                // Remove close listeners to prevent reconnection triggers
                socket.removeAllListeners('close');
                
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close();
                }
            }
        });
        
        // Clear all subscribers
        this.subscribers.kline = {};
        this.subscribers.depth = {};
        
        this.sockets = {};
        console.log('✅ All connections closed and reconnections disabled');
    }

    // 🎯 IMPROVED: Reset method to ensure clean state
    resetShutdownState() {
        this.isShuttingDown = false;
        // Also clear any pending reconnection timeouts
        this.reconnectTimeouts.forEach((timeoutId, key) => {
            clearTimeout(timeoutId);
        });
        this.reconnectTimeouts.clear();
        console.log('✅ WebSocket reconnections enabled for normal operation');
    }
}

module.exports = ExchangeManager;