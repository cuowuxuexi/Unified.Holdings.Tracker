#!/usr/bin/env node

/**
 * 安全的 Electron 开发环境启动脚本
 * 在启动前自动清理端口和进程
 */

const { spawn } = require('child_process');
const path = require('path');

// 导入清理函数
const { performCleanup, showCurrentStatus } = require('./dev-cleanup');

async function main() {
  console.log('🔧 Safe Electron Dev Environment Starter');
  console.log('==========================================\n');

  // 显示当前状态
  await showCurrentStatus();

  console.log('\n🧹 Performing pre-start cleanup...');
  console.log('-----------------------------------');

  // 执行清理
  const result = await performCleanup({
    ports: true,
    node: true,
    verbose: false
  });

  console.log(`\n✨ Pre-cleanup completed: ${result.cleanedPorts} ports, ${result.cleanedProcesses} processes`);

  // 等待一点时间让进程完全退出
  console.log('\n⏳ Waiting for processes to terminate...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n🚀 Starting Electron development environment...');
  console.log('==============================================\n');

  // 启动标准的 electron-dev 命令
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', 'electron-dev'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..')
  });

  child.on('error', (error) => {
    console.error('Failed to start electron-dev:', error);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.log(`\n⚠️  electron-dev exited with code ${code}`);
      console.log('💡 Tip: Run "npm run clean:dev:status" to check environment status');
      console.log('💡 Tip: Run "npm run clean:dev" to clean up stuck processes');
    }
    process.exit(code);
  });

  // 处理中断信号
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Received interrupt signal, cleaning up...');
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Received termination signal, cleaning up...');
    child.kill('SIGTERM');
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error('Failed to start safe electron-dev:', error);
    process.exit(1);
  });
}

module.exports = { main };