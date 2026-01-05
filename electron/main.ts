import { app, BrowserWindow, dialog, ipcMain, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { exec, fork, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { PathResolver } from './launcher/path-resolver';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendUrl = 'http://localhost:3001'; // 改为 let，支持动态端口
const DATABASE_FILE_NAME = 'portfolio.db';

// ============ 日志系统 ============
let logStream: fs.WriteStream | null = null;

function initLogSystem() {
  // 生产模式下不创建日志文件，只输出到控制台
  if (app.isPackaged) {
    console.log('='.repeat(80));
    console.log(`Electron 启动 - ${new Date().toISOString()}`);
    console.log(`应用版本: ${app.getVersion()}`);
    console.log('生产模式：日志仅输出到控制台');
    console.log('='.repeat(80));
    return;
  }

  // 开发模式：创建日志文件
  const userDataPath = app.getPath('userData');
  const logsDir = path.join(userDataPath, 'logs');

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logsDir, `electron-${timestamp}.log`);

  logStream = fs.createWriteStream(logFile, { flags: 'a' });

  log('='.repeat(80));
  log(`Electron 启动日志 - ${new Date().toISOString()}`);
  log(`应用版本: ${app.getVersion()}`);
  log(`是否打包: ${app.isPackaged}`);
  log(`用户数据目录: ${userDataPath}`);
  log(`资源路径: ${process.resourcesPath}`);
  log(`日志文件: ${logFile}`);
  log('='.repeat(80));
}

function log(...args: any[]) {
  const message = args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    )
    .join(' ');

  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;

  console.log(logMessage);

  if (logStream) {
    logStream.write(logMessage + '\n');
  }
}

function logError(...args: any[]) {
  const message = args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    )
    .join(' ');

  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ERROR: ${message}`;

  console.error(logMessage);

  if (logStream) {
    logStream.write(logMessage + '\n');
  }
}
// ============ 日志系统结束 ============

// 端口检测函数
async function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: any) => {
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

// 查找可用端口
async function findAvailablePort(
  startPort: number,
  endPort: number
): Promise<number> {
  const occupiedPorts: number[] = [];

  for (let port = startPort; port <= endPort; port++) {
    if (!(await checkPortInUse(port))) {
      // 如果发现之前有端口被占用，提示用户
      if (occupiedPorts.length > 0 && port !== startPort) {
        console.log(
          `ℹ️ 端口 ${occupiedPorts.join(', ')} 已被占用，使用端口 ${port}`
        );
      }
      return port;
    }
    occupiedPorts.push(port);
  }

  // 所有端口都被占用，显示详细错误信息
  const errorMessage = `后端服务启动失败：端口范围 ${startPort}-${endPort} 全部被占用。\n\n被占用端口：${occupiedPorts.join(', ')}\n\n请关闭占用这些端口的程序后重试。`;
  console.error(errorMessage);

  throw new Error(`No available port in range ${startPort}-${endPort}`);
}

// 获取占用端口的进程PID
async function getProcessByPort(port: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        return parts[parts.length - 1];
      }
    }
  } catch (error) {
    console.log(`Port ${port} is not in use`);
  }
  return null;
}

// 清理指定端口的进程
async function cleanupPort(port: number): Promise<void> {
  const pid = await getProcessByPort(port);
  if (pid) {
    try {
      await execAsync(`taskkill /PID ${pid} /F`);
      console.log(`Killed process ${pid} on port ${port}`);
    } catch (error) {
      console.error(`Failed to kill process ${pid}:`, error);
    }
  }
}

// 清理Node.js进程
async function cleanupNodeProcesses(): Promise<void> {
  try {
    await execAsync('taskkill /F /IM node.exe /T');
    console.log('Cleaned up all Node.js processes');
  } catch (error) {
    console.log('No Node.js processes to clean up');
  }
}

function resolveRendererEntry(): string | null {
  try {
    const pathResolver = PathResolver.getInstance();
    return pathResolver.resolveRendererEntry();
  } catch (error) {
    console.error('Failed to resolve renderer entry:', error);
    return null;
  }
}

// 检查后端服务是否运行
async function checkBackendService() {
  try {
    // 注意：node-fetch v2.x 使用 CommonJS 导入，v3+ 使用 ESM。
    // package.json 中是 "node-fetch": "^2.6.7"，所以这里的 fetch 调用方式是正确的。
    const response = await fetch(backendUrl);
    return response.ok;
  } catch (error) {
    console.error('Backend service check failed:', error);
    return false;
  }
}

// 启动后端服务
async function startBackend(): Promise<{ url: string; port: number }> {
  log('\n' + '='.repeat(80));
  log('开始启动后端服务');
  log('='.repeat(80));

  if (process.env.NODE_ENV === 'development') {
    log('开发模式：使用外部后端服务 (端口 3001)');
    return { url: 'http://localhost:3001', port: 3001 };
  }

  log('生产模式：启动内置后端服务');

  // 查找可用端口
  const port = await findAvailablePort(3001, 3010);
  backendUrl = `http://localhost:${port}`;
  log(`✓ 选择后端端口: ${port}`);

  const pathResolver = PathResolver.getInstance();
  let backendEntry: string;

  try {
    backendEntry = pathResolver.resolveBackendEntry();
    log(`✓ 后端入口文件: ${backendEntry}`);

    // 检查文件是否存在
    if (!fs.existsSync(backendEntry)) {
      logError(`✗ 后端入口文件不存在: ${backendEntry}`);
      throw new Error(`Backend entry not found: ${backendEntry}`);
    }
    log(`✓ 后端入口文件存在，大小: ${fs.statSync(backendEntry).size} bytes`);
  } catch (error) {
    logError('✗ 解析后端入口失败:', error);
    dialog.showErrorBox(
      'Backend Error',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }

  // 构建环境变量
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(port),
    NODE_ENV: app.isPackaged ? 'production' : 'development',
  };

  // 数据库配置
  if (process.env.DATABASE_URL) {
    env.DATABASE_URL = process.env.DATABASE_URL;
    log(`✓ DATABASE_URL: ${env.DATABASE_URL}`);
  }

  // 用户数据目录
  if (process.env.ELECTRON_USER_DATA) {
    env.ELECTRON_USER_DATA = process.env.ELECTRON_USER_DATA;
    log(`✓ ELECTRON_USER_DATA: ${env.ELECTRON_USER_DATA}`);
  }

  // Prisma Query Engine 配置
  if (app.isPackaged) {
    const queryEnginePath = path.join(
      process.resourcesPath,
      'backend',
      'query_engine-windows.dll.node'
    );
    env.PRISMA_QUERY_ENGINE_LIBRARY = queryEnginePath;
    log(`✓ PRISMA_QUERY_ENGINE_LIBRARY: ${queryEnginePath}`);

    // 检查 Query Engine 文件
    if (fs.existsSync(queryEnginePath)) {
      log(
        `✓ Query Engine 文件存在，大小: ${fs.statSync(queryEnginePath).size} bytes`
      );
    } else {
      logError(`✗ Query Engine 文件不存在: ${queryEnginePath}`);
    }

    // 检查 Prisma Client
    const prismaClientPath = path.join(
      process.resourcesPath,
      'backend',
      'node_modules',
      '@prisma',
      'client'
    );
    if (fs.existsSync(prismaClientPath)) {
      log(`✓ @prisma/client 存在: ${prismaClientPath}`);
    } else {
      logError(`✗ @prisma/client 不存在: ${prismaClientPath}`);
    }

    const dotPrismaPath = path.join(
      process.resourcesPath,
      'backend',
      'node_modules',
      '.prisma',
      'client'
    );
    if (fs.existsSync(dotPrismaPath)) {
      log(`✓ .prisma/client 存在: ${dotPrismaPath}`);
    } else {
      logError(`✗ .prisma/client 不存在: ${dotPrismaPath}`);
    }
  }

  log('\n环境变量摘要:');
  log(`  NODE_ENV: ${env.NODE_ENV}`);
  log(`  PORT: ${env.PORT}`);
  log(`  DATABASE_URL: ${env.DATABASE_URL}`);
  log(`  ELECTRON_USER_DATA: ${env.ELECTRON_USER_DATA}`);
  log(
    `  PRISMA_QUERY_ENGINE_LIBRARY: ${env.PRISMA_QUERY_ENGINE_LIBRARY || '(未设置)'}`
  );

  try {
    log('\n启动后端子进程...');

    // **关键修复**: 在打包环境下查找并使用系统 Node.js
    if (app.isPackaged) {
      log('查找系统 Node.js...');

      // 尝试查找系统 Node.js
      let nodePath: string | null = null;
      try {
        const { stdout } = await execAsync('where node');
        const paths = stdout.trim().split('\n');
        // 过滤掉 Electron 自己的 node
        nodePath = paths.find((p) => !p.includes('electron')) || paths[0];
        log(`✓ 找到 Node.js: ${nodePath}`);
      } catch (error) {
        logError('✗ 未找到系统 Node.js');
        logError('详细错误:', error);

        dialog.showErrorBox(
          '缺少 Node.js',
          '未在系统中找到 Node.js。\n\n请安装 Node.js 18 或更高版本后重试。\n\n下载地址: https://nodejs.org/'
        );
        throw new Error('Node.js not found in system PATH');
      }

      if (!nodePath) {
        throw new Error('Node.js path is empty');
      }

      log('使用系统 Node.js 启动后端（打包模式）');
      backendProcess = spawn(nodePath.trim(), [backendEntry], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.join(process.resourcesPath, 'backend'),
      });
    } else {
      log('使用 fork 方式启动后端（开发模式）');
      backendProcess = fork(backendEntry, [], {
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        cwd: path.join(process.resourcesPath, 'backend'),
      });
    }

    log(`✓ 后端进程已创建，PID: ${backendProcess.pid}`);

    backendProcess.on('error', (err) => {
      logError('后端进程错误:', err);
      logError('错误堆栈:', err.stack);
    });

    if (backendProcess.stdout) {
      backendProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        log(`[Backend STDOUT]: ${message}`);
      });
    }

    if (backendProcess.stderr) {
      backendProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        logError(`[Backend STDERR]: ${message}`);
      });
    }

    backendProcess.on('exit', (code, signal) => {
      log(`后端进程退出 - 代码: ${code}, 信号: ${signal}`);
      backendProcess = null;
    });

    // 等待后端就绪
    log('\n等待后端服务就绪...');
    let attempts = 0;
    while (attempts < 30) {
      if (await checkBackendService()) {
        log(`✓ 后端服务就绪！(尝试 ${attempts + 1}/30)`);
        log('='.repeat(80));
        return { url: backendUrl, port };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
      if (attempts % 5 === 0) {
        log(`  仍在等待... (${attempts}/30)`);
      }
    }

    logError('✗ 后端服务启动超时 (30秒)');
    throw new Error('Backend startup timeout');
  } catch (error) {
    logError('启动后端进程失败:', error);
    if (error instanceof Error) {
      logError('错误堆栈:', error.stack);
    }
    throw error;
  }
}

async function createWindow() {
  log('\n' + '='.repeat(80));
  log('开始创建主窗口');
  log('='.repeat(80));

  // **仅在非开发模式下清理端口**，避免杀死开发服务
  if (process.env.NODE_ENV !== 'development') {
    log('检查并清理可能冲突的端口...');
    const portsToCheck = [3001, 5173, 5174, 5175];
    for (const port of portsToCheck) {
      if (await checkPortInUse(port)) {
        log(`端口 ${port} 被占用，尝试清理...`);
        await cleanupPort(port);
      }
    }
  } else {
    log('开发模式：跳过自动端口清理');
  }

  // 启动后端并获取实际端口
  try {
    const backend = await startBackend();
    log(`✓ 后端启动成功: ${backend.url}`);
  } catch (error) {
    logError('✗ 后端启动失败:', error);
    // 后续的错误处理会提示用户
  }

  // 检查后端服务
  log('\n检查后端服务连接...');
  const backendRunning = await checkBackendService();

  if (!backendRunning) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: '后端服务未运行',
      message:
        '无法连接到后端服务。请确保后端服务已启动。\n\n点击"重试"重新检查，或点击"清理进程"结束所有相关进程。',
      buttons: ['重试', '清理进程', '退出'],
      defaultId: 0,
      cancelId: 2,
    });

    if (response === 0) {
      // 重试
      createWindow(); // 重新调用 createWindow 尝试连接
      return; // 阻止当前函数继续执行
    } else if (response === 1) {
      // 清理进程
      await cleanupNodeProcesses();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return createWindow();
    } else {
      // 退出
      app.quit();
      return; // 阻止当前函数继续执行
    }
  }

  // 创建窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // 保持禁用 Node Integration 以提高安全性
      contextIsolation: true, // 保持启用 Context Isolation
      // preload: path.join(__dirname, 'preload.js') // 如果需要 preload 脚本，取消注释并确保文件存在
    },
  });

  // 加载前端
  if (process.env.NODE_ENV === 'development') {
    // 开发环境：加载 Vite 开发服务器
    // 开发环境：使用固定的5173端口
    const devUrl = 'http://localhost:5173';
    console.log(`Loading URL for development: ${devUrl}`);
    mainWindow.loadURL(devUrl).catch((err) => {
      console.error('Failed to load development URL:', devUrl, err);
      // 可以在这里添加备选方案，例如加载生产文件或显示错误信息
    });
    // 开发模式下打开开发者工具
    mainWindow.webContents.openDevTools();
  } else {
    const rendererEntry = resolveRendererEntry();
    if (rendererEntry) {
      console.log(`Loading file for production: ${rendererEntry}`);
      mainWindow.loadFile(rendererEntry).catch((err) => {
        console.error('Failed to load production file:', rendererEntry, err);
      });
    } else {
      const missingAssetsMessage =
        'No built renderer assets found. Run the frontend build before packaging.';
      console.error(missingAssetsMessage);
      dialog.showErrorBox('Renderer assets missing', missingAssetsMessage);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 当第二个实例被启动时
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Exiting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当第二个实例被启动时，聚焦到已有的窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    initLogSystem();
    log('App 已就绪，开始初始化...');

    configureDatabaseEnv();
    createWindow();

    // 开发环境快捷键
    if (process.env.NODE_ENV === 'development') {
      globalShortcut.register('CommandOrControl+Shift+C', async () => {
        log('执行手动清理...');
        await cleanupNodeProcesses();
        dialog.showMessageBox(mainWindow!, {
          type: 'info',
          title: '清理完成',
          message: '已清理所有Node.js进程和相关端口。',
        });
      });
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async (event) => {
  log('应用正在退出...');

  if (backendProcess) {
    log('终止后端进程...');
    backendProcess.kill();
    backendProcess = null;
  }

  // 关闭日志流
  if (logStream) {
    log('关闭日志流');
    logStream.end();
  }

  // 清理工作交由清理脚本处理
});

// 可选：处理未捕获的异常
process.on('uncaughtException', (error) => {
  logError('未捕获的异常:', error);
  logError('错误堆栈:', error.stack);

  // 显示错误对话框
  dialog.showErrorBox(
    '发生严重错误',
    `应用遇到未处理的错误:\n\n${error.message}\n\n请查看日志文件获取详细信息。`
  );

  // 根据情况决定是否退出应用
  // app.quit();
});

function configureDatabaseEnv() {
  log('\n配置数据库环境变量...');

  if (!app.isPackaged) {
    log('开发模式：跳过数据库环境变量配置');
    return;
  }

  const userDataPath = app.getPath('userData');
  process.env.ELECTRON_USER_DATA = userDataPath;
  log(`✓ ELECTRON_USER_DATA 设置为: ${userDataPath}`);

  const currentDatabaseUrl = process.env.DATABASE_URL || '';
  log(`当前 DATABASE_URL: ${currentDatabaseUrl || '(空)'}`);

  const shouldOverrideDatabase =
    currentDatabaseUrl.length === 0 ||
    currentDatabaseUrl.includes('apps/backend/prisma') ||
    currentDatabaseUrl.startsWith('file:./');

  if (shouldOverrideDatabase) {
    const dbPath = path.join(userDataPath, DATABASE_FILE_NAME);
    process.env.DATABASE_URL = `file:${dbPath}`;
    log(`✓ DATABASE_URL 更新为: ${process.env.DATABASE_URL}`);
  } else {
    log('保持现有 DATABASE_URL 不变');
  }
}
