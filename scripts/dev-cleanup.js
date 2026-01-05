#!/usr/bin/env node

/**
 * 开发环境清理脚本
 * 用于清理残留的Node.js进程和端口占用
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const net = require('net');

const execAsync = promisify(exec);

// 需要清理的端口列表
const DEV_PORTS = [3001, 5173, 5174, 5175, 8080];

// 检查端口是否被占用
async function checkPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

// 获取占用端口的进程信息
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
          const { stdout: taskStdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
          const taskInfo = taskStdout.split('","');

          if (taskInfo.length >= 2) {
            processes.push({
              pid: pid,
              name: taskInfo[0].replace('"', ''),
              port: port
            });
          }
        } catch (e) {
          processes.push({
            pid: pid,
            name: 'Unknown',
            port: port
          });
        }
      }
    }

    return processes;
  } catch (error) {
    return [];
  }
}

// 根据PID杀死进程
async function killProcess(pid) {
  try {
    await execAsync(`taskkill /PID ${pid} /F`);
    console.log(`✓ Killed process ${pid}`);
    return true;
  } catch (error) {
    console.log(`✗ Failed to kill process ${pid}: ${error.message}`);
    return false;
  }
}

// 清理Node.js进程
async function cleanupNodeProcesses() {
  console.log('🔍 Looking for Node.js processes...');
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH');
    const lines = stdout.split('\n').filter(line => line.trim());

    let killedCount = 0;
    for (const line of lines) {
      const parts = line.split('","');
      if (parts.length >= 2) {
        const pid = parts[1].replace(/"/g, '');
        if (await killProcess(pid)) {
          killedCount++;
        }
      }
    }

    console.log(`✓ Cleaned up ${killedCount} Node.js processes`);
    return killedCount;
  } catch (error) {
    console.log('✓ No Node.js processes found to clean up');
    return 0;
  }
}

// 清理指定端口
async function cleanupPort(port) {
  console.log(`🔍 Checking port ${port}...`);
  const processes = await getProcessInfoByPort(port);

  if (processes.length === 0) {
    console.log(`✓ Port ${port} is free`);
    return false;
  }

  console.log(`⚠️  Found ${processes.length} process(es) on port ${port}:`);
  for (const proc of processes) {
    console.log(`   - ${proc.name} (PID: ${proc.pid})`);
    await killProcess(proc.pid);
  }

  return true;
}

// 显示当前状态
async function showCurrentStatus() {
  console.log('\n📊 Current Development Environment Status:');
  console.log('==========================================');

  let occupiedPorts = 0;
  let totalProcesses = 0;

  for (const port of DEV_PORTS) {
    const processes = await getProcessInfoByPort(port);
    if (processes.length > 0) {
      occupiedPorts++;
      totalProcesses += processes.length;
      console.log(`\n🔴 Port ${port}:`);
      for (const proc of processes) {
        console.log(`   - ${proc.name} (PID: ${proc.pid})`);
      }
    }
  }

  if (occupiedPorts === 0) {
    console.log('\n✅ All development ports are free');
  } else {
    console.log(`\n⚠️  ${occupiedPorts} ports occupied by ${totalProcesses} processes`);
  }

  // 检查Node.js进程
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV | find /c /v ""');
    const nodeCount = parseInt(stdout.trim()) - 1; // 减去标题行
    if (nodeCount > 0) {
      console.log(`🔴 Found ${nodeCount} Node.js processes`);
    }
  } catch (e) {
    console.log('✅ No Node.js processes found');
  }
}

// 主清理函数
async function performCleanup(options = {}) {
  const { ports = true, node = true, verbose = true } = options;

  if (verbose) {
    console.log('\n🧹 Starting development environment cleanup...');
    console.log('==============================================');
  }

  let cleanedPorts = 0;
  let cleanedProcesses = 0;

  if (ports) {
    for (const port of DEV_PORTS) {
      if (await cleanupPort(port)) {
        cleanedPorts++;
      }
    }
  }

  if (node) {
    cleanedProcesses = await cleanupNodeProcesses();
  }

  if (verbose) {
    console.log('\n✨ Cleanup completed!');
    console.log(`   - Freed ${cleanedPorts} ports`);
    console.log(`   - Killed ${cleanedProcesses} Node.js processes`);
    console.log('\n🔄 You can now restart your development environment safely.');
  }

  return { cleanedPorts, cleanedProcesses };
}

// 命令行参数处理
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🧹 Development Environment Cleanup Tool

Usage: node dev-cleanup.js [options]

Options:
  --status, -s       Show current status only
  --ports, -p        Clean up ports only
  --node, -n         Clean up Node.js processes only
  --all, -a          Clean up everything (default)
  --quiet, -q        Quiet mode (minimal output)
  --help, -h         Show this help message

Examples:
  node dev-cleanup.js              # Clean up everything
  node dev-cleanup.js --status     # Show current status
  node dev-cleanup.js --ports      # Clean ports only
  node dev-cleanup.js --node       # Clean Node.js processes only
  node dev-cleanup.js -a -q        # Clean everything quietly
`);
    return;
  }

  const showStatus = args.includes('--status') || args.includes('-s');
  const portsOnly = args.includes('--ports') || args.includes('-p');
  const nodeOnly = args.includes('--node') || args.includes('-n');
  const all = args.includes('--all') || args.includes('-a') || (!portsOnly && !nodeOnly && !showStatus);
  const quiet = args.includes('--quiet') || args.includes('-q');

  if (showStatus) {
    await showCurrentStatus();
    return;
  }

  if (all) {
    await performCleanup({ ports: true, node: true, verbose: !quiet });
  } else if (portsOnly) {
    await performCleanup({ ports: true, node: false, verbose: !quiet });
  } else if (nodeOnly) {
    await performCleanup({ ports: false, node: true, verbose: !quiet });
  }
}

// 如果是直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  checkPortInUse,
  getProcessInfoByPort,
  killProcess,
  cleanupNodeProcesses,
  cleanupPort,
  performCleanup,
  showCurrentStatus
};