# Binance Predictive Trading Bot 🤖

A sophisticated algorithmic trading bot that analyzes market data from Binance to generate predictive trading signals using technical analysis, order book analysis, and machine learning principles.

## 🌟 Features

### 📊 Multi-Timeframe Analysis
- Supports 1m, 5m, 15m, 1h, 4h, and 1d timeframes
- Adaptive risk management based on timeframe
- Configurable analysis intervals

### 🔍 Advanced Signal Detection
- **Candle Pattern Analysis**: EMA crosses, RSI, Bollinger Bands, volume analysis
- **Order Book Analysis**: Bid/ask imbalances, support/resistance levels, wall detection
- **Composite Scoring**: Weighted signal scoring system (0-10 scale)
- **Divergence Detection**: Identifies conflicts between price action and order book signals

### ⚡ Real-Time Monitoring
- WebSocket connections for live market data
- Multiple trading pairs support (BTCUSDT, ETHUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, FETUSDT)
- Configurable signal cooldown periods

### 📱 Telegram Integration
- Real-time trading alerts
- Bot control via Telegram commands
- Customizable alert thresholds

### 🧪 Backtesting Capabilities
- CSV-based historical data analysis
- Signal performance tracking
- Configurable testing parameters

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- Binance account with API keys
- Telegram bot token (optional)

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd binance-predictive-bot
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
# Binance API Keys
BINANCE_API_KEY=your_api_key_here
BINANCE_SECRET_KEY=your_secret_key_here

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_MY_ID=your_user_id_here
TELEGRAM_GROUPCHAT_ID=your_group_chat_id_here

# Bot Configuration
TIMEFRAME=1h
DEBUG=false
```

5. Start the bot
```bash
# Production mode
npm start

# Development mode with file watching
npm run dev

# Backtesting mode
npm run test
```

## 📋 Configuration

### Trading Pairs
The bot supports multiple trading pairs with pair-specific configurations:

```javascript
{
  'BTCUSDT': { cooldown: 10, minVolume: 10, volatilityMultiplier: 1.0 },
  'ETHUSDT': { cooldown: 10, minVolume: 25, volatilityMultiplier: 1.2 },
  'XRPUSDT': { cooldown: 10, minVolume: 50000, volatilityMultiplier: 1.5 },
  // ... more pairs
}
```

### Risk Management
- **Stop Loss**: 2% default (volatility-adjusted)
- **Risk-Reward Ratio**: 2:1 minimum
- **Position Sizing**: Dynamic based on market conditions
- **Signal Cooldown**: Prevents signal spam

### Technical Indicators
- **EMA**: Fast (8), Medium (21), Long (50) periods
- **RSI**: 14-period with overbought/oversold detection
- **Bollinger Bands**: 20-period with 2 standard deviations
- **Volume Analysis**: EMA and spike detection

## 🎯 Usage

### Live Trading Mode
The bot runs in live trading mode by default, connecting to Binance WebSocket streams and analyzing real-time market data.

### Test Mode
Run the bot in test mode for offline analysis:

```javascript
const bot = new BinancePredictiveBot(true); // testMode = true
```

### Telegram Commands
- `/start` - Start the bot
- `/stop` - Stop the bot gracefully
- `/restart` - Restart the bot
- `/status` - Check bot status and uptime
- `/stats [pair]` - View trading statistics

### Signal Analysis
The bot generates signals based on a comprehensive scoring system:

**Long Signal Requirements:**
- Minimum score of 8/10
- EMA bullish cross confirmation
- Buying pressure detection
- Volume spike validation
- No bearish divergence

**Short Signal Requirements:**
- Minimum score of 8/10
- EMA bearish cross confirmation
- Selling pressure detection
- Volume spike validation
- No bullish divergence

## 🏗️ Architecture

### Core Components
```
BinancePredictiveBot/
├── analyzers/
│   ├── CandleAnalyzer.js      # Technical indicator analysis
│   └── OrderBookAnalyzer.js   # Market depth analysis
├── handlers/
│   ├── TelegramBotHandler.js  # Telegram integration
│   └── CommandHandler.js      # Bot command processing
├── managers/
│   ├── BootManager.js         # Startup/shutdown sequencing
│   └── ExchangeManager.js     # Binance API abstraction
├── utils/
│   ├── LogFormatter.js        # Structured logging
│   └── RateLimitedQueue.js    # API rate limiting
└── backtest/
    └── SignalLogger.js        # Historical analysis
```

### Key Classes
- **BinancePredictiveBot**: Main bot class orchestrating all components
- **CandleAnalyzer**: Technical analysis using TA indicators
- **OrderBookAnalyzer**: Market microstructure analysis
- **ExchangeManager**: Handles all Binance API communications
- **BootManager**: Manages startup and shutdown sequences

## ⚙️ Advanced Configuration

### Timeframe Settings
Each timeframe has optimized parameters:

```javascript
'1h': {
  analysisInterval: 60000,      // Check every minute
  maxCandles: 168,             // 1 week of hourly data
  lookbackMultiplier: 60,      // Adaptive lookback
  emaMultiplier: 1.0           // EMA period scaling
}
```

### Signal Scoring
The bot uses a weighted scoring system:
- **EMA Cross**: 3 points
- **Buying/Selling Pressure**: 2 points
- **Trend Alignment**: 2 points
- **Volume Spike**: 2 points
- **Order Book Signals**: 1 point each

### Risk Management
Dynamic risk adjustment based on:
- Market volatility (ATR-based)
- Timeframe characteristics
- Pair-specific multipliers
- Current market conditions

## 🔧 Development

### Adding New Indicators
1. Extend `CandleAnalyzer.js`
2. Implement indicator calculation
3. Add to signal scoring system
4. Update configuration validation

### Customizing Strategies
Modify the signal generation logic in `BinancePredictiveBot.js`:

```javascript
calculateSignalScore(candleAnalysis, obAnalysis, candles, symbol) {
  // Custom scoring logic
}
```

### Backtesting
Use the built-in backtesting system:

```javascript
await bot.analyzeSignalsFromCSV({
  symbol: 'BTCUSDT',
  csvFilePath: './data/historical.csv',
  analysisInterval: 4,
  minSignalScore: 7
});
```

## 🛡️ Safety Features

### Error Handling
- Graceful WebSocket reconnection
- API rate limiting
- Comprehensive error logging
- Automatic recovery from disconnections

### Risk Controls
- Maximum position size limits
- Stop-loss protection
- Signal cooldown periods
- Circuit breakers for extreme volatility

### Monitoring
- Real-time performance metrics
- Telegram status alerts
- Detailed logging with timestamps
- Memory leak prevention

## 📈 Performance

### Signal Accuracy
The bot focuses on high-probability setups with:
- Minimum 8/10 signal score requirement
- Multiple confirmation signals required
- Divergence detection to filter false signals
- Volume confirmation for all major moves

### Optimization
- Adaptive parameters based on timeframe
- Pair-specific configurations
- Real-time market condition assessment
- Continuous signal validation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## ⚠️ Disclaimer

**This software is for educational and research purposes only.** Trading cryptocurrencies carries significant risk and may not be suitable for all investors. Past performance is not indicative of future results.

- Always test with small amounts first
- Use proper risk management
- Monitor the bot regularly
- Understand the strategies before deploying

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
- Check the debugging logs with `DEBUG=true`
- Review the Telegram command responses
- Verify API key permissions
- Ensure sufficient historical data is available

---

**Happy Trading! 📈✨**