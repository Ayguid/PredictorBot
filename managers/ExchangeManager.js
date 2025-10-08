import RateLimitedQueue from '../utils/RateLimitedQueue.js';
import WebSocket from 'ws';
import {
    klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount,
    placeOrder, cancelOrder, cancelAndReplace, exchangeInfo, depth,
    createListenKey, keepAliveListenKey, closeListenKey
} from '../utils/binance-rest.js';

class ExchangeManager {
    constructor() {
        //this.config = config;
        this.DEBUG_MODE = process.env.DEBUG_ORDERBOOK === 'true'; //

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
        // Track last update IDs for sequence validation
        this.lastUpdateIds = new Map();
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
        if (this.isShuttingDown) {
            console.log(`❌ Skipping depth connection for ${pair} - shutdown in progress`);
            resolve();
            return;
        }

        const depthWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@depth@100ms`;
        const depthWs = new WebSocket(depthWsUrl);

        let connectionStartTime = Date.now();
        let messageCount = 0;
        let lastMessageTime = Date.now();

        // Monitor connection health
        const healthCheck = setInterval(() => {
            const timeSinceLastMessage = Date.now() - lastMessageTime;
            if (timeSinceLastMessage > 10000) { // 10 seconds without messages
                console.warn(`🩺 Depth WebSocket health check failed for ${pair}: No messages for ${timeSinceLastMessage}ms`);
                depthWs.close(); // Force reconnect
            }
        }, 5000);

        depthWs.on('open', () => {
            if (this.isShuttingDown) {
                depthWs.close();
                return;
            }
            console.log(`✅ Connected to ${pair} depth websocket`);
            connectionStartTime = Date.now();
            resolve();
        });

        depthWs.on('message', (data) => {
            if (this.isShuttingDown) return;
            
            messageCount++;
            lastMessageTime = Date.now();
            
            // Log connection stats periodically
            /*if (messageCount % 100 === 0) {
                const uptime = Math.floor((Date.now() - connectionStartTime) / 1000);
                console.log(`📊 ${pair} depth: ${messageCount} messages over ${uptime}s (${Math.round(messageCount/uptime)}/sec)`);
            }*/

            try {
                const parsedData = JSON.parse(data);
                if (this.subscribers.depth[pair]) {
                    this.subscribers.depth[pair].forEach(callback => callback(parsedData));
                }
            } catch (error) {
                console.error(`❌ Error parsing depth data for ${pair}:`, error);
            }
        });

        depthWs.on('close', async (code, reason) => {
            clearInterval(healthCheck);
            console.log(`🔌 Depth websocket for ${pair} disconnected: ${code} - ${reason}`);
            delete this.sockets[`${pair}_depth`];

            if (!this.isShuttingDown) {
                const reconnectDelay = 2000; // 2 seconds
                console.log(`⏰ Reconnecting depth for ${pair} in ${reconnectDelay}ms...`);
                
                const timeoutId = setTimeout(() => {
                    if (!this.isShuttingDown) {
                        this.connectDepthSocket(pair);
                    }
                }, reconnectDelay);
                this.reconnectTimeouts.set(`${pair}_depth`, timeoutId);
            }
        });

        depthWs.on('error', (error) => {
            clearInterval(healthCheck);
            console.error(`❌ Depth websocket error for ${pair}:`, error);
            reject(error);
        });

        depthWs.on('ping', () => {
            depthWs.pong(); // Respond to keepalive ping
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

    // ADD: Method to process incremental depth updates
processIncrementalDepthUpdate(data, currentOrderBook) {
    if (!currentOrderBook || !currentOrderBook.bids || !currentOrderBook.asks) {
        return {
            bids: data.b ? data.b.map(b => [parseFloat(b[0]), parseFloat(b[1])]) : [],
            asks: data.a ? data.a.map(a => [parseFloat(a[0]), parseFloat(a[1])]) : [],
            lastUpdateId: data.u,
            timestamp: Date.now()
        };
    }

    // ✅ RELAXED VALIDATION: Only reject if we're clearly behind
    if (currentOrderBook.lastUpdateId) {
        // Old update - ignore
        if (data.u <= currentOrderBook.lastUpdateId) {
            return currentOrderBook;
        }

        // If we're more than 100 updates behind, reinitialize
        if (data.U > currentOrderBook.lastUpdateId + 100) {
            console.warn(`❌ Too far behind: current=${currentOrderBook.lastUpdateId}, U=${data.U}, gap=${data.U - currentOrderBook.lastUpdateId}`);
            return null;
        }
    }

    // Process update (same logic as applyDepthUpdate)
    const orderBookCopy = this.deepCopyOrderBook(currentOrderBook);

    if (data.b && Array.isArray(data.b)) {
        data.b.forEach(([price, quantity]) => {
            const numPrice = parseFloat(price);
            const numQty = parseFloat(quantity);
            orderBookCopy.bids = orderBookCopy.bids.filter(bid => bid[0] !== numPrice);
            if (numQty > 0) orderBookCopy.bids.push([numPrice, numQty]);
        });
    }

    if (data.a && Array.isArray(data.a)) {
        data.a.forEach(([price, quantity]) => {
            const numPrice = parseFloat(price);
            const numQty = parseFloat(quantity);
            orderBookCopy.asks = orderBookCopy.asks.filter(ask => ask[0] !== numPrice);
            if (numQty > 0) orderBookCopy.asks.push([numPrice, numQty]);
        });
    }

    this.cleanupOrderBook(orderBookCopy);
    orderBookCopy.bids.sort((a, b) => b[0] - a[0]);
    orderBookCopy.asks.sort((a, b) => a[0] - b[0]);
    orderBookCopy.lastUpdateId = data.u;
    orderBookCopy.timestamp = Date.now();

    return orderBookCopy;
}

    // ✅ ADD: Deep copy method
    deepCopyOrderBook(orderBook) {
        if (!orderBook) return null;

        return {
            bids: orderBook.bids ? orderBook.bids.map(bid => [...bid]) : [],
            asks: orderBook.asks ? orderBook.asks.map(ask => [...ask]) : [],
            lastUpdateId: orderBook.lastUpdateId,
            timestamp: orderBook.timestamp
        };
    }

    // ✅ Also update cleanupOrderBook to be safer
    cleanupOrderBook(orderBook) {
        if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) return;

        // Add safety checks
        const bestBid = orderBook.bids[0]?.[0];
        const bestAsk = orderBook.asks[0]?.[0];

        if (bestBid === undefined || bestAsk === undefined) return;

        const currentPrice = (bestBid + bestAsk) / 2;

        // Define cleanup range
        const cleanupRange = 0.10;
        const minPrice = currentPrice * (1 - cleanupRange);
        const maxPrice = currentPrice * (1 + cleanupRange);

        // These operations now work on the copy, not the original
        orderBook.bids = orderBook.bids.filter(bid => bid[0] >= minPrice);
        orderBook.asks = orderBook.asks.filter(ask => ask[0] <= maxPrice);

        const maxLevels = 500;
        if (orderBook.bids.length > maxLevels) {
            orderBook.bids = orderBook.bids.slice(0, maxLevels);
        }
        if (orderBook.asks.length > maxLevels) {
            orderBook.asks = orderBook.asks.slice(0, maxLevels);
        }
    }

    // ADD: Method to get initial order book snapshot
    async getOrderBookSnapshot(symbol, limit = 1000) {
        try {
            const snapshot = await this.makeQueuedReq(depth, symbol, limit);
            return {
                bids: snapshot.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
                asks: snapshot.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
                lastUpdateId: snapshot.lastUpdateId,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error(`❌ Failed to get order book snapshot for ${symbol}:`, error);
            return null;
        }
    }
    async synchronizeOrderBook(symbol) {
    console.log(`🔄 Synchronizing order book for ${symbol}...`);
    
    try {
        // Get fresh snapshot
        const snapshot = await this.getOrderBookSnapshot(symbol);
        if (!snapshot) {
            throw new Error('Failed to get order book snapshot');
        }

        // Wait a bit for WebSocket to catch up
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`✅ ${symbol}: Order book synchronized with lastUpdateId=${snapshot.lastUpdateId}`);
        return snapshot;
        
    } catch (error) {
        console.error(`❌ Failed to synchronize order book for ${symbol}:`, error);
        throw error;
    }
}
}

export default ExchangeManager;