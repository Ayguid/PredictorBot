class SocketManager {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.socket = null;
    }

    connect() {
        this.socket = io({
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000
        });

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.dashboard.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.dashboard.updateConnectionStatus(false);
        });

        this.socket.on('initial-data', (data) => {
            this.dashboard.handleInitialData(data);
        });

        this.socket.on('analysis-update', (analysis) => {
            this.dashboard.handleAnalysisUpdate(analysis);
        });

        this.socket.on('bot-status', (status) => {
            this.dashboard.handleBotStatus(status);
        });

        this.socket.on('candle-data', (data) => {
            this.dashboard.handleCandleData(data);
        });
    }

    requestCandles(symbol, limit) {
        this.socket.emit('request-candles', { symbol, limit });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}