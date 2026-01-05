/**
 * 开发环境日志工具
 */

const config = require('./dev-config');

class Logger {
  constructor(prefix = 'DevEnv') {
    this.prefix = prefix;
  }

  formatMessage(level, message) {
    const timestamp = config.logging.timestamp ? `[${new Date().toISOString()}]` : '';
    const prefix = `[${this.prefix}]`;
    return `${timestamp} ${prefix} ${level} ${message}`;
  }

  log(level, message) {
    if (!config.logging.verbose) return;

    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(config.logging.level);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= currentLevelIndex) {
      const formattedMessage = this.formatMessage(level.toUpperCase(), message);

      switch (level) {
        case 'error':
          console.error(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        case 'info':
          console.info(formattedMessage);
          break;
        default:
          console.log(formattedMessage);
      }
    }
  }

  debug(message) { this.log('debug', message); }
  info(message) { this.log('info', message); }
  warn(message) { this.log('warn', message); }
  error(message) { this.log('error', message); }
}

// 创建默认日志实例
const logger = new Logger();

module.exports = { Logger, logger };