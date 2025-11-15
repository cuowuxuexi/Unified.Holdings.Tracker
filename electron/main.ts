import { app, BrowserWindow, dialog, ipcMain, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
const backendUrl = 'http://localhost:3001';

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
  const candidates = [
    path.join(__dirname, '../renderer/index.html'),
    path.join(__dirname, '../../frontend/dist/index.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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

async function createWindow() {
  // **仅在非开发模式下清理端口**，避免杀死开发服务
  if (process.env.NODE_ENV !== 'development') {
    // 清理可能冲突的端口
    const portsToCheck = [3001, 5173, 5174, 5175];
    for (const port of portsToCheck) {
      if (await checkPortInUse(port)) {
        console.log(`Port ${port} is in use, attempting to clean up...`);
        await cleanupPort(port);
      }
    }
  } else {
    console.log('Development mode: Skipping automatic port cleanup');
  }

  // 检查后端服务
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
    createWindow();

    // 开发环境快捷键
    if (process.env.NODE_ENV === 'development') {
      globalShortcut.register('CommandOrControl+Shift+C', async () => {
        console.log('Performing cleanup...');
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
  console.log('Application is quitting...');
  // 清理工作交由清理脚本处理
});

// 可选：处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // 可以考虑记录日志或显示错误对话框
  dialog.showErrorBox('发生错误', `应用遇到未处理的错误: ${error.message}`);
  // 根据情况决定是否退出应用
  // app.quit();
});
