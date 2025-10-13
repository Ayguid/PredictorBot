class ChartManager {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.priceChart = null;
        this.chartType = 'line';
    }

    initializeChart() {
        const ctx = document.getElementById('priceChart').getContext('2d');
        
        if (this.priceChart) {
            this.priceChart.destroy();
        }

        if (this.chartType === 'line') {
            this.initializeLineChart(ctx);
        } else {
            this.initializeOHLCChart(ctx);
        }
    }

    initializeLineChart(ctx) {
        this.priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Close Price',
                    data: [],
                    borderColor: '#00b4db',
                    backgroundColor: 'rgba(0, 180, 219, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0
                }]
            },
            options: this.getChartOptions()
        });
    }

    initializeOHLCChart(ctx) {
        this.priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Open',
                        data: [],
                        borderColor: '#ffa502',
                        backgroundColor: 'rgba(255, 165, 2, 0.1)',
                        borderWidth: 1,
                        fill: false,
                        tension: 0,
                        pointRadius: 0
                    },
                    {
                        label: 'High',
                        data: [],
                        borderColor: '#00d26a',
                        backgroundColor: 'rgba(0, 210, 106, 0.1)',
                        borderWidth: 1,
                        fill: false,
                        tension: 0,
                        pointRadius: 0
                    },
                    {
                        label: 'Low',
                        data: [],
                        borderColor: '#ff4757',
                        backgroundColor: 'rgba(255, 71, 87, 0.1)',
                        borderWidth: 1,
                        fill: false,
                        tension: 0,
                        pointRadius: 0
                    },
                    {
                        label: 'Close',
                        data: [],
                        borderColor: '#00b4db',
                        backgroundColor: 'rgba(0, 180, 219, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0,
                        pointRadius: 0
                    }
                ]
            },
            options: this.getChartOptions()
        });
    }

    getChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: true,
                    labels: { color: 'rgba(255, 255, 255, 0.7)' }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (context) => {
                            const datasetLabel = context.dataset.label;
                            const value = context.parsed.y;
                            return `${datasetLabel}: $${value.toFixed(4)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: 'rgba(255, 255, 255, 0.7)' }
                },
                y: {
                    position: 'right',
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        callback: (value) => '$' + value.toFixed(2)
                    }
                }
            },
            interaction: { intersect: false, mode: 'index' }
        };
    }

    updateChart(candles) {
        if (!this.priceChart || !candles?.length) {
            console.log('No candle data available');
            return;
        }

        if (this.chartType === 'line') {
            this.updateLineChart(candles);
        } else {
            this.updateOHLCChart(candles);
        }
        
        this.priceChart.update('none');
    }

    updateLineChart(candles) {
        this.priceChart.data.datasets[0].data = candles.map(candle => ({
            x: new Date(candle.timestamp),
            y: candle.close
        }));
    }

    updateOHLCChart(candles) {
        this.priceChart.data.datasets[0].data = candles.map(candle => ({
            x: new Date(candle.timestamp),
            y: candle.open
        }));
        this.priceChart.data.datasets[1].data = candles.map(candle => ({
            x: new Date(candle.timestamp),
            y: candle.high
        }));
        this.priceChart.data.datasets[2].data = candles.map(candle => ({
            x: new Date(candle.timestamp),
            y: candle.low
        }));
        this.priceChart.data.datasets[3].data = candles.map(candle => ({
            x: new Date(candle.timestamp),
            y: candle.close
        }));
    }

    setChartType(type) {
        this.chartType = type;
        this.initializeChart();
    }

    destroy() {
        if (this.priceChart) {
            this.priceChart.destroy();
        }
    }
}