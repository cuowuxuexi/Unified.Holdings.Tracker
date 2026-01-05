/**
 * 开发环境配置
 */

module.exports = {
  // 开发环境端口列表
  devPorts: [3001, 5173, 5174, 5175, 8080],

  // 清理配置
  cleanup: {
    // 清理超时时间（毫秒）
    timeout: 2000,
    // 重试次数
    retryAttempts: 2,
    // 重试间隔（毫秒）
    retryDelay: 500
  },

  // 进程检测配置
  processDetection: {
    // 端口检测超时（毫秒）
    portCheckTimeout: 100,
    // 进程信息获取超时（毫秒）
    processInfoTimeout: 2000
  },

  // 日志配置
  logging: {
    // 是否显示详细信息
    verbose: process.env.NODE_ENV !== 'production',
    // 是否显示时间戳
    timestamp: true,
    // 日志级别: 'debug', 'info', 'warn', 'error'
    level: 'info'
  }
};