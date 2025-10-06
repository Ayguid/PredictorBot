// handlers/CommandHandler.js
const { wait } = require('../utils/helpers');

class CommandHandler {
    constructor(bot) {
        this.bot = bot;
    }

 async executeCommand(command, args) {
        const commands = {
            start: () => this.startBot(),
            stop: () => this.stopBot(),
            restart: () => this.restartBot(),
            status: () => this.getBotStatus(),
            stats: () => this.getTradingStats(args[0]),
        };

        const action = commands[command];
        return action ? await action() : 'Unknown command...';
    }

    async startBot() {
        if (this.bot.isRunning) {
            return 'Bot is already running!';
        }

        try {
            await this.bot.bootManager.executeBootSequence({ 
                startAnalysis: true, 
                isRestart: false 
            });
            return 'Bot started successfully! All systems operational.';
        } catch (error) {
            console.error('❌ Failed to start bot:', error);
            this.bot.isRunning = false;
            return `Failed to start bot: ${error.message}`;
        }
    }

    async stopBot() {
        if (!this.bot.isRunning) {
            return 'Bot is already stopped!';
        }

        try {
            await this.bot.bootManager.executeShutdownSequence();
            return 'Bot stopped successfully! All connections closed.';
        } catch (error) {
            console.error('❌ Error stopping bot:', error);
            return `Failed to stop bot: ${error.message}`;
        }
    }

    async restartBot() {
        try {
            if (this.bot.isRunning) {
                await this.stopBot();
                await wait(2000); // Brief pause between stop and restart
            }

            await this.bot.bootManager.executeBootSequence({ 
                clearData: true, 
                startAnalysis: true, 
                isRestart: true 
            });
            
            return 'Bot restarted successfully! All systems operational.';
        } catch (error) {
            console.error('❌ Bot restart failed:', error);
            this.bot.isRunning = false;
            return `Restart failed: ${error.message}`;
        }
    }

    async getBotStatus() {
        if (!this.bot?.config) {
            return '❌ Bot configuration not loaded';
        }

        const status = this.bot.isRunning ? '🟢 RUNNING' : '🔴 STOPPED';
        const pairs = this.bot.config.tradingPairs?.length || 0;
        const timeframe = this.bot.config.timeframe || 'Unknown';

        return `
🤖 Bot Status: ${status}
📊 Timeframe: ${timeframe}
🔢 Trading Pairs: ${pairs}
🔄 Analysis Interval: ${this.bot.config.analysisInterval || 'Unknown'}ms
⏰ Uptime: ${this.getUptime()}
        `.trim();
    }

    getUptime() {
        if (!this.bot?.startTime) return 'Unknown';
        
        const uptime = Date.now() - this.bot.startTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    getTradingStats(pair) {
        return `Stats for ${pair || 'all pairs'}: Not implemented yet`;
    }
}

module.exports = CommandHandler;