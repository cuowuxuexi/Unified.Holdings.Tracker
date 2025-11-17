import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { spawn, exec } from 'child_process';
import net from 'net';
import { promisify } from 'util';

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

// 检查后端服务是否运行
async function checkBackendService(): Promise<boolean> {
  try {
    const response = await fetch(backendUrl);
    return response.ok;
  } catch (error) {
    console.error('Backend service check failed:', error);
    return false;
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

async function createWindow() {
  // 清理可能冲突的端口
  const portsToCheck = [3001, 5173, 5174, 5175];
  for (const port of portsToCheck) {
    if (await checkPortInUse(port)) {
      console.log(`Port ${port} is in use, attempting to clean up...`);
      await cleanupPort(port);
    }
  }

  // 检查后端服务
  const backendRunning = await checkBackendService();

  if (!backendRunning) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: '后端服务未运行',
      message: '无法连接到后端服务。请确保后端服务已启动。\n\n点击"重试"重新检查，或点击"清理进程"结束所有相关进程。',
      buttons: ['重试', '清理进程', '退出'],
      defaultId: 0,
      cancelId: 2
    });

    if (response === 0) {
      // 重试
      return createWindow();
    } else if (response === 1) {
      // 清理进程
      await cleanupNodeProcesses();
      await new Promise(resolve => setTimeout(resolve, 2000));
      return createWindow();
    } else {
      // 退出
      app.quit();
      return;
    }
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    const devUrl = 'http://localhost:5175';
    console.log(`Loading URL for development: ${devUrl}`);
    mainWindow.loadURL(devUrl).catch(err => {
      console.error('Failed to load development URL:', devUrl, err);
      dialog.showErrorBox('加载失败', `无法加载开发服务器: ${devUrl}\n请确保前端开发服务器正在运行。`);
    });
    mainWindow.webContents.openDevTools();
  } else {
    const rendererEntry = resolveRendererEntry();
    if (rendererEntry) {
      console.log(`Loading file for production: ${rendererEntry}`);
      mainWindow.loadFile(rendererEntry).catch(err => {
        console.error('Failed to load production file:', rendererEntry, err);
      });
    } else {
      const missingAssetsMessage = 'No built renderer assets found. Run the frontend build before packaging.';
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  console.log('Application is quitting...');
  // 可以在这里添加清理逻辑
});

// IPC 处理程序
ipcMain.handle('cleanup-ports', async () => {
  const portsToCheck = [3001, 5173, 5174, 5175];
  for (const port of portsToCheck) {
    await cleanupPort(port);
  }
  return { success: true };
});

ipcMain.handle('cleanup-node-processes', async () => {
  await cleanupNodeProcesses();
  return { success: true };
});

// 开发环境清理函数
if (process.env.NODE_ENV === 'development') {
  // 在开发环境中，监听快捷键进行清理
  app.on('ready', () => {
    globalShortcut.register('CommandOrControl+Shift+C', async () => {
      console.log('Performing cleanup...');
      await cleanupNodeProcesses();
      dialog.showMessageBox(mainWindow!, {
        type: 'info',
        title: '清理完成',
        message: '已清理所有Node.js进程和相关端口。',
      });
    });
  });
}