class Dashboard {
    constructor() {
        this.socketManager = new SocketManager(this);
        this.chartManager = new ChartManager(this);
        this.analysisData = {};
        this.currentSymbol = null;
        this.autoRefresh = true;
        this.chartUpdateInterval = null;
        this.currentLimit = 100;
        
        this.initializeDashboard();
        this.setupEventListeners();
    }

    initializeDashboard() {
        this.socketManager.connect();
        this.chartManager.initializeChart();
    }

    setupEventListeners() {
        document.getElementById('timeframeSelect').addEventListener('change', (e) => {
            this.currentLimit = parseInt(e.target.value);
            this.loadChartData(this.currentLimit);
        });

        document.getElementById('refreshChart').addEventListener('click', () => {
            this.loadChartData(this.currentLimit);
        });

        document.getElementById('autoRefreshToggle').addEventListener('click', () => {
            this.toggleAutoRefresh();
        });

        document.querySelectorAll('.chart-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.target.dataset.type;
                this.setChartType(type);
            });
        });
    }

    // Socket event handlers
    handleInitialData(data) {
        this.analysisData = data.analysis;
        this.updateSymbolsList();
        this.selectFirstSymbol();
        this.updateStatusBar(data.botStatus);
    }

    handleAnalysisUpdate(analysis) {
        this.analysisData[analysis.symbol] = analysis;
        this.updateSymbolsList();
        
        if (analysis.symbol === this.currentSymbol) {
            this.updateAnalysisDetails(analysis);
        }
        
        this.updateLastUpdateTime();
    }

    handleBotStatus(status) {
        this.updateStatusBar(status);
    }

    handleCandleData(data) {
        if (data.symbol === this.currentSymbol) {
            this.chartManager.updateChart(data.candles);
        }
    }

    // Chart methods
    setChartType(type) {
        this.chartManager.setChartType(type);
        document.querySelectorAll('.chart-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });

        if (this.currentSymbol) {
            this.loadChartData(this.currentLimit);
            document.getElementById('chartTitle').textContent = 
                `${this.currentSymbol} Price Chart (${type.toUpperCase()})`;
        }
    }

    loadChartData(limit = null) {
        if (!this.currentSymbol) {
            console.log('No symbol selected');
            return;
        }
        
        if (limit === null) {
            limit = this.currentLimit;
        } else {
            this.currentLimit = limit;
        }
        
        this.socketManager.requestCandles(this.currentSymbol, limit);
    }

    // Auto refresh methods
    toggleAutoRefresh() {
        this.autoRefresh = !this.autoRefresh;
        const button = document.getElementById('autoRefreshToggle');
        button.textContent = this.autoRefresh ? '🔁 Auto: ON' : '⏸️ Auto: OFF';
        
        if (this.autoRefresh && this.currentSymbol) {
            this.startChartAutoRefresh();
        } else {
            this.stopChartAutoRefresh();
        }
    }

    startChartAutoRefresh() {
        this.stopChartAutoRefresh();
        this.chartUpdateInterval = setInterval(() => {
            if (this.currentSymbol && this.autoRefresh) {
                this.loadChartData(this.currentLimit);
            }
        }, 10000);
    }

    stopChartAutoRefresh() {
        if (this.chartUpdateInterval) {
            clearInterval(this.chartUpdateInterval);
            this.chartUpdateInterval = null;
        }
    }

    // UI update methods
    updateSymbolsList() {
        const symbolsList = document.getElementById('symbolsList');
        const symbols = Object.keys(this.analysisData);
        
        if (symbols.length === 0) {
            symbolsList.innerHTML = '<div class="no-data">No analysis data available yet...</div>';
            return;
        }

        symbolsList.innerHTML = symbols.map(symbol => {
            const analysis = this.analysisData[symbol];
            const isActive = symbol === this.currentSymbol;
            const signal = analysis.signals?.compositeSignal || 'neutral';
            const currentPrice = analysis.currentPrice?.toFixed(4) || '--';
            const score = analysis.signals?.signalScore || { long: 0, short: 0 };

            return `
                <div class="symbol-item ${isActive ? 'active' : ''}" 
                     onclick="dashboard.selectSymbol('${symbol}')">
                    <div class="symbol-item-header">
                        <div class="symbol-name">${symbol}</div>
                        <div class="signal ${signal}">${signal.toUpperCase()}</div>
                    </div>
                    <div class="symbol-price">$${currentPrice}</div>
                    <div class="symbol-details">
                        <div>Long: ${score.long}/10</div>
                        <div>Short: ${score.short}/10</div>
                    </div>
                    <div class="score-bars">
                        <div class="score-bar">
                            <div class="score-fill long" style="width: ${score.long * 10}%"></div>
                        </div>
                        <div class="score-bar">
                            <div class="score-fill short" style="width: ${score.short * 10}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    selectSymbol(symbol) {
        this.currentSymbol = symbol;
        this.updateSymbolsList();
        this.chartManager.initializeChart();
        this.loadChartData(this.currentLimit);
        this.updateAnalysisDetails(this.analysisData[symbol]);
        document.getElementById('chartTitle').textContent = 
            `${symbol} Price Chart (${this.chartManager.chartType.toUpperCase()})`;
        
        if (this.autoRefresh) {
            this.startChartAutoRefresh();
        }
    }

    selectFirstSymbol() {
        const symbols = Object.keys(this.analysisData);
        if (symbols.length > 0) {
            this.selectSymbol(symbols[0]);
        }
    }

    updateAnalysisDetails(analysis) {
        const detailsContainer = document.getElementById('analysisDetails');
        if (!analysis) {
            detailsContainer.innerHTML = '<div class="no-data">Select a symbol to view analysis details</div>';
            return;
        }

        const signals = analysis.signals || {};
        const indicators = analysis.indicators || {};
        const suggestedPrices = analysis.suggestedPrices || {};

        detailsContainer.innerHTML = `
            <h3 style="margin-bottom: 15px;">Analysis Details - ${analysis.symbol}</h3>
            
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Current Price</div>
                    <div class="detail-value">$${analysis.currentPrice?.toFixed(4) || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Signal</div>
                    <div class="detail-value signal ${signals.compositeSignal}">
                        ${(signals.compositeSignal || 'neutral').toUpperCase()}
                    </div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Signal Score</div>
                    <div class="detail-value">
                        Long: ${signals.signalScore?.long || 0}/10<br>
                        Short: ${signals.signalScore?.short || 0}/10
                    </div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Last Analysis</div>
                    <div class="detail-value">${new Date(analysis.timestamp).toLocaleTimeString()}</div>
                </div>
            </div>

            <div class="technical-indicators">
                <div class="indicator">
                    <div>RSI</div>
                    <div>${indicators.rsi?.toFixed(2) || '--'}</div>
                </div>
                <div class="indicator">
                    <div>EMA Fast</div>
                    <div>${indicators.emaFast?.toFixed(4) || '--'}</div>
                </div>
                <div class="indicator">
                    <div>EMA Medium</div>
                    <div>${indicators.emaMedium?.toFixed(4) || '--'}</div>
                </div>
                <div class="indicator">
                    <div>EMA Slow</div>
                    <div>${indicators.emaSlow?.toFixed(4) || '--'}</div>
                </div>
                <div class="indicator">
                    <div>Volume Spike</div>
                    <div>${indicators.volumeSpike ? '📈' : '📊'}</div>
                </div>
                <div class="indicator">
                    <div>Buying Pressure</div>
                    <div>${indicators.buyingPressure ? '✅' : '❌'}</div>
                </div>
            </div>

            ${suggestedPrices.entry ? `
            <div style="margin-top: 20px;">
                <h4 style="margin-bottom: 10px;">Trading Suggestions</h4>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-label">Entry Price</div>
                        <div class="detail-value">$${suggestedPrices.entry.toFixed(4)}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Stop Loss</div>
                        <div class="detail-value">$${suggestedPrices.stopLoss.toFixed(4)}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Take Profit</div>
                        <div class="detail-value">$${suggestedPrices.takeProfit.toFixed(4)}</div>
                    </div>
                    ${suggestedPrices.optimalEntry ? `
                    <div class="detail-item">
                        <div class="detail-label">Optimal Entry</div>
                        <div class="detail-value">$${suggestedPrices.optimalEntry.toFixed(4)}</div>
                    </div>
                    ` : ''}
                </div>
            </div>
            ` : ''}
        `;
    }

    updateStatusBar(status) {
        const statusBar = document.getElementById('statusBar');
        const statusClass = status.isRunning ? 'running' : 'stopped';
        const testClass = status.testMode ? 'test' : '';
        
        statusBar.classList.add('updating');
        setTimeout(() => statusBar.classList.remove('updating'), 500);
        
        statusBar.innerHTML = `
            <div class="status-item ${statusClass}">
                <div class="status-label">Bot Status</div>
                <div class="status-value">${status.isRunning ? '🟢 RUNNING' : '🔴 STOPPED'}</div>
            </div>
            <div class="status-item ${testClass}">
                <div class="status-label">Mode</div>
                <div class="status-value">${status.testMode ? '🧪 TEST MODE' : '🚀 LIVE'}</div>
            </div>
            <div class="status-item">
                <div class="status-label">Timeframe</div>
                <div class="status-value">${status.timeframe || '--'}</div>
            </div>
            <div class="status-item">
                <div class="status-label">Uptime</div>
                <div class="status-value">${this.formatUptime(status.uptime)}</div>
            </div>
            <div class="status-item">
                <div class="status-label">Symbols</div>
                <div class="status-value">${status.tradingPairs?.length || 0}</div>
            </div>
        `;
    }

    formatUptime(uptime) {
        if (!uptime) return '--';
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        if (connected) {
            statusElement.textContent = '✅ Connected';
            statusElement.className = 'connection-status connected';
        } else {
            statusElement.textContent = '❌ Disconnected';
            statusElement.className = 'connection-status disconnected';
        }
    }

    updateLastUpdateTime() {
        document.getElementById('lastUpdate').textContent = 
            `Last update: ${new Date().toLocaleTimeString()}`;
    }

    destroy() {
        this.stopChartAutoRefresh();
        this.chartManager.destroy();
        this.socketManager.disconnect();
    }
}