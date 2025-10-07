import TelegramBot from 'node-telegram-bot-api';

class TelegramBotHandler {
    constructor(config, handleCommandCallback) {
        this.config = config;
        this.handleCommandCallback = handleCommandCallback;
        this.processedMessages = new Set();
        if (config.telegramBotEnabled) {
            this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
                polling: true,
                request: { family: 4, timeout: 30000 }
            });
        }
    }

    initialize() {
        if (!this.config.telegramBotEnabled) return;
        this.bot.on("polling_error", console.error);
        
        this.bot.on('message', this.handleTelegramMessage.bind(this));
        console.log('Telegram bot initialized and polling started.');
    }

    async handleTelegramMessage(msg) {
        // Duplicate message prevention
        const messageId = `${msg.message_id}_${msg.chat.id}`;
        if (this.processedMessages.has(messageId)) {
            console.log(`⚠️ Ignoring duplicate message: ${msg.text}`);
            return;
        }
        
        this.processedMessages.add(messageId);
        
        // Clean up old message IDs to prevent memory leaks
        if (this.processedMessages.size > 1000) {
            const firstMessage = Array.from(this.processedMessages)[0];
            this.processedMessages.delete(firstMessage);
        }

        console.log('Received Telegram message:', msg.text);
        if (msg.from.id !== Number(process.env.TELEGRAM_MY_ID)) return; //admin msg
        
        // Check if message is a command (starts with /)
        if (msg.text.startsWith('/')) {
            // Handle command
            const [fullCommand, ...args] = msg.text.split(' ');
            const command = fullCommand.substring(1); // Remove the '/' prefix
            console.log(`Processing command: /${command} with args:`, args);
            
            const response = await this.handleCommandCallback(command, args);
            await this.bot.sendMessage(process.env.TELEGRAM_MY_ID, response);
        } else {
            // Handle regular messages (non-commands)
            await this.bot.sendMessage(process.env.TELEGRAM_MY_ID, `Received your message: '${msg.text}'`);
        }
    }

sendAlert(alertData) {
    if (!this.config.telegramBotEnabled) return;

    const {
        pair,
        signal,
        currentPrice,
        entryPrice,
        stopLoss,
        takeProfit,
        optimalEntry = null  // ✅ Using optimalEntry
    } = alertData;

    if (!this.config.alertSignals.includes(signal)) return;

    const riskPct = Math.abs((entryPrice - stopLoss) / entryPrice * 100);
    const rewardPct = Math.abs((takeProfit - entryPrice) / entryPrice * 100);
    const rrRatio = (rewardPct / riskPct).toFixed(2);

    const action = signal === 'long' ? '🟢 LONG' : '🔴 SHORT';
    const pricePrecision = pair.includes('BTC') ? 2 : 6;

    let message = `
${action} SIGNAL
──────────────
📊 Pair: ${pair}
💰 Current: $${currentPrice.toFixed(pricePrecision)}
🎯 Entry: $${entryPrice.toFixed(pricePrecision)}
    `.trim();

    // ✅ UPDATED: Use "Optimal Entry" for both long and short
    if (optimalEntry && optimalEntry !== entryPrice) {
        const discountPercent = signal === 'long' 
            ? ((currentPrice - optimalEntry) / currentPrice * 100).toFixed(2)
            : ((optimalEntry - currentPrice) / currentPrice * 100).toFixed(2);
        
        const direction = signal === 'long' ? 'below' : 'above';
        
        message += `\n⭐ Optimal Entry: $${optimalEntry.toFixed(pricePrecision)} (${discountPercent}% ${direction} current)\n`;
    }

    message += `
🛑 Stop Loss: $${stopLoss.toFixed(pricePrecision)} (${riskPct.toFixed(2)}%)
🎯 Take Profit: $${takeProfit.toFixed(pricePrecision)} (${rewardPct.toFixed(2)}%)
⚖️ Risk/Reward: ${rrRatio}:1
⏰ Time: ${new Date().toLocaleString()}
    `.trim();

    try {
        this.bot.sendMessage(process.env.TELEGRAM_GROUPCHAT_ID, message);
    } catch (error) {
        console.error(`Failed to send alert for ${pair}:`, error);
    }
}
}

export default TelegramBotHandler;