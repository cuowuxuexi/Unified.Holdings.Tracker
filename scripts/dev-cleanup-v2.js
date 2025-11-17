#!/usr/bin/env node

/**
 * 增强版开发环境清理脚本
 * 优化的进程管理和端口清理工具
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const net = require('net');
const config = require('./dev-config');
const { logger } = require('./dev-logger');

const execAsync = promisify(exec);

// 优化的端口检测函数
async function checkPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        server.removeAllListeners();
        server.close();
      }
    };

    server.once('error', (err) => {
      cleanup();
      resolve(err.code === 'EADDRINUSE');
    });

    server.once('listening', () => {
      cleanup();
      resolve(false);
    });

    server.listen(port, '127.0.0.1');

    // 设置超时
    setTimeout(() => {
      cleanup();
      resolve(false);
    }, config.processDetection.portCheckTimeout);
  });
}

// 获取占用端口的进程详细信息
async function getProcessInfoByPort(port) {
  try {
    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    const lines = stdout.split('\n').filter(line => line.trim());
    const processes = [];

    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];

        try {
          // 获取进程详细信息
          const { stdout: taskStdout } = await execAsync(
            `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
            { timeout: config.processDetection.processInfoTimeout }
          );

          const taskInfo = taskStdout.split('","');
          if (taskInfo.length >= 2) {
            processes.push({
              pid: pid,
              name: taskInfo[0].replace('"', ''),
              port: port,
              timestamp: new Date().toISOString()
            });
          }
        } catch (e) {
          // 如果无法获取详细信息，仍然记录PID
          processes.push({
            pid: pid,
            name: 'Unknown',
            port: port,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    return processes;
  } catch (error) {
    logger.debug(`Port ${port} is not in use or error occurred: ${error.message}`);
    return [];
  }
}

// 安全地杀死进程
async function killProcess(pid, retryCount = 0) {
  try {
    await execAsync(`taskkill /PID ${pid} /F`);
    logger.info(`Successfully killed process ${pid}`);
    return true;
  } catch (error) {
    // 进程可能已经结束
    if (error.message.includes('找不到进程')) {
      logger.debug(`Process ${pid} already terminated`);
      return true;
    }

    logger.warn(`Failed to kill process ${pid}: ${error.message}`);

    // 重试机制
    if (retryCount < config.cleanup.retryAttempts) {
      logger.debug(`Retrying to kill process ${pid} (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, config.cleanup.retryDelay));
      return killProcess(pid, retryCount + 1);
    }

    return false;
  }
}

// 清理Node.js进程（带智能检测）
async function cleanupNodeProcesses() {
  logger.info('Looking for Node.js processes to clean up...');

  try {
    // 首先获取所有node.exe进程
    const { stdout } = await execAsync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv');
    const lines = stdout.split('\n').filter(line => line.trim());

    let killedCount = 0;
    let skippedCount = 0;

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const pid = parts[parts.length - 1].trim();
        const commandLine = parts.slice(1, -1).join(',').toLowerCase();

        // 智能判断：跳过系统进程或重要进程
        if (commandLine.includes('windows') || commandLine.includes('system32')) {
          logger.debug(`Skipping system Node.js process ${pid}`);
          skippedCount++;
          continue;
        }

        if (pid && !isNaN(parseInt(pid))) {
          if (await killProcess(pid)) {
            killedCount++;
          }
        }
      }
    }

    logger.info(`Node.js cleanup completed: ${killedCount} killed, ${skippedCount} skipped`);
    return killedCount;
  } catch (error) {
    logger.warn(`Failed to enumerate Node.js processes: ${error.message}`);
    return 0;
  }
}

// 清理指定端口
async function cleanupPort(port) {
  logger.info(`Checking port ${port}...`);
  const processes = await getProcessInfoByPort(port);

  if (processes.length === 0) {
    logger.info(`Port ${port} is free`);
    return false;
  }

  logger.warn(`Found ${processes.length} process(es) on port ${port}:`);
  let killedCount = 0;

  for (const proc of processes) {
    logger.info(`  - ${proc.name} (PID: ${proc.pid})`);
    if (await killProcess(proc.pid)) {
      killedCount++;
    }
  }

  return killedCount > 0;
}

// 显示当前状态（带详细信息）
async function showCurrentStatus() {
  console.log('\n📊 Development Environment Status Report');
  console.log('=========================================');

  let occupiedPorts = 0;
  let totalProcesses = 0;
  const allProcesses = [];

  for (const port of config.devPorts) {
    const processes = await getProcessInfoByPort(port);
    if (processes.length > 0) {
      occupiedPorts++;
      totalProcesses += processes.length;
      allProcesses.push(...processes);

      console.log(`\n🔴 Port ${port} (${processes.length} process(es)):`);
      for (const proc of processes) {
        console.log(`   - ${proc.name} (PID: ${proc.pid})`);
      }
    }
  }

  if (occupiedPorts === 0) {
    console.log('\n✅ All development ports are free');
  } else {
    console.log(`\n⚠️  ${occupiedPorts} ports occupied by ${totalProcesses} processes`);

    // 显示进程统计
    const processTypes = {};
    allProcesses.forEach(proc => {
      processTypes[proc.name] = (processTypes[proc.name] || 0) + 1;
    });

    console.log('\n📈 Process Statistics:');
    Object.entries(processTypes).forEach(([name, count]) => {
      console.log(`   - ${name}: ${count}`);
    });
  }

  // 检查Node.js进程
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV | find /c /v ""');
    const nodeCount = parseInt(stdout.trim()) - 1; // 减去标题行
    if (nodeCount > 0) {
      console.log(`\n🔴 Found ${nodeCount} Node.js processes`);
    } else {
      console.log('\n✅ No Node.js processes found');
    }
  } catch (e) {
    console.log('\n✅ No Node.js processes found');
  }

  return { occupiedPorts, totalProcesses };
}

// 生成清理报告
async function generateCleanupReport(results) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      portsCleaned: results.cleanedPorts,
      processesKilled: results.cleanedProcesses,
      duration: results.duration || 0
    },
    details: results.details || [],
    recommendations: []
  };

  // 添加建议
  if (results.cleanedPorts > 0) {
    report.recommendations.push('Consider using the safe start script to avoid port conflicts');
  }

  if (results.cleanedProcesses > 10) {
    report.recommendations.push('Large number of processes detected - review application shutdown logic');
  }

  return report;
}

// 主清理函数（增强版）
async function performCleanup(options = {}) {
  const { ports = true, node = true, verbose = true, generateReport: shouldGenerateReport = false } = options;

  const startTime = Date.now();
  const details = [];

  if (verbose) {
    console.log('\n🧹 Enhanced Development Environment Cleanup');
    console.log('===========================================');
  }

  let cleanedPorts = 0;
  let cleanedProcesses = 0;

  if (ports) {
    for (const port of config.devPorts) {
      const portStartTime = Date.now();
      const portCleaned = await cleanupPort(port);
      if (portCleaned) {
        cleanedPorts++;
        details.push({
          type: 'port',
          port: port,
          duration: Date.now() - portStartTime
        });
      }
    }
  }

  if (node) {
    const nodeStartTime = Date.now();
    cleanedProcesses = await cleanupNodeProcesses();
    if (cleanedProcesses > 0) {
      details.push({
        type: 'node',
        count: cleanedProcesses,
        duration: Date.now() - nodeStartTime
      });
    }
  }

  const duration = Date.now() - startTime;

  if (verbose) {
    console.log('\n✨ Cleanup completed!');
    console.log(`   - Freed ${cleanedPorts} ports`);
    console.log(`   - Killed ${cleanedProcesses} processes`);
    console.log(`   - Duration: ${duration}ms`);
    console.log('\n🔄 You can now restart your development environment safely.');
  }

  const results = { cleanedPorts, cleanedProcesses, duration, details };

  // 生成报告（如果请求）
  if (shouldGenerateReport) {
    const report = await generateCleanupReport(results);
    return { results, report };
  }

  return results;
}

// 命令行参数处理（保持不变，但使用优化后的函数）
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🧹 Enhanced Development Environment Cleanup Tool

Usage: node dev-cleanup-v2.js [options]

Options:
  --status, -s       Show current status only
  --ports, -p        Clean up ports only
  --node, -n         Clean up Node.js processes only
  --all, -a          Clean up everything (default)
  --quiet, -q        Quiet mode (minimal output)
  --report           Generate detailed cleanup report
  --help, -h         Show this help message

Examples:
  node dev-cleanup-v2.js              # Clean up everything
  node dev-cleanup-v2.js --status     # Show current status
  node dev-cleanup-v2.js --ports      # Clean ports only
  node dev-cleanup-v2.js --node       # Clean Node.js processes only
  node dev-cleanup-v2.js -a --report  # Clean everything with report
`);
    return;
  }

  const showStatus = args.includes('--status') || args.includes('-s');
  const portsOnly = args.includes('--ports') || args.includes('-p');
  const nodeOnly = args.includes('--node') || args.includes('-n');
  const all = args.includes('--all') || args.includes('-a') || (!portsOnly && !nodeOnly && !showStatus);
  const quiet = args.includes('--quiet') || args.includes('-q');
  const generateReport = args.includes('--report');

  if (showStatus) {
    await showCurrentStatus();
    return;
  }

  if (all) {
    const result = await performCleanup({
      ports: true,
      node: true,
      verbose: !quiet,
      generateReport
    });

    if (generateReport && result.report) {
      console.log('\n📄 Cleanup Report:');
      console.log('=================');
      console.log(JSON.stringify(result.report, null, 2));
    }
  } else if (portsOnly) {
    await performCleanup({ ports: true, node: false, verbose: !quiet });
  } else if (nodeOnly) {
    await performCleanup({ ports: false, node: true, verbose: !quiet });
  }
}

// 如果是直接运行此脚本
if (require.main === module) {
  main().catch(error => {
    logger.error(`Failed to run cleanup: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  checkPortInUse,
  getProcessInfoByPort,
  killProcess,
  cleanupNodeProcesses,
  cleanupPort,
  performCleanup,
  showCurrentStatus,
  generateCleanupReport
};