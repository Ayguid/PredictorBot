# Install csv-parser if not already installed
npm install csv-parser

# Run comprehensive signal analysis
node backtest/runSignalAnalysis.js

# Quick analysis with specific CSV file
node backtest/quickSignalLogger.js ./path/to/your/btc_1h.csv BTCUSDT

# Or use in your code
const quickSignalLogger = require('./backtest/quickSignalLogger');
const result = await quickSignalLogger('./data/btc_1h.csv', 'BTCUSDT');