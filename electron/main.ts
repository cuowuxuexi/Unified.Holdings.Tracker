import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import fetch from 'node-fetch';

let mainWindow: BrowserWindow | null = null;
const backendUrl = 'http://localhost:3001';

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
  // 检查后端服务
  const backendRunning = await checkBackendService();

  if (!backendRunning) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: '后端服务未运行',
      message: '无法连接到后端服务。请确保后端服务已启动。',
      buttons: ['重试', '退出'], // 修改：移除“继续”按钮
      defaultId: 0,
      cancelId: 1 // 通常将退出设为 cancelId
    });

    if (response === 0) {
      // 重试
      createWindow(); // 重新调用 createWindow 尝试连接
      return; // 阻止当前函数继续执行
    } else { // response === 1 (退出)
      // 退出
      app.quit();
      return; // 阻止当前函数继续执行
    }
    // 不再有“继续”的逻辑分支
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
    // 确保前端开发服务器在 5173 端口运行
    const devUrl = 'http://localhost:5173';
    console.log(`Loading URL for development: ${devUrl}`);
    mainWindow.loadURL(devUrl).catch(err => {
      console.error('Failed to load development URL:', devUrl, err);
      // 可以在这里添加备选方案，例如加载生产文件或显示错误信息
    });
    // 开发模式下打开开发者工具
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：加载打包后的文件
    // __dirname 指向 main.js 所在的目录 (electron/dist)
    const prodPath = path.join(__dirname, '../renderer/index.html');
    console.log(`Loading file for production: ${prodPath}`);
    mainWindow.loadFile(prodPath).catch(err => {
      console.error('Failed to load production file:', prodPath, err);
      // 可以在这里添加错误处理逻辑
    });
  }


  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // 在 macOS 上，除非用户明确退出，否则应用及其菜单栏通常保持活动状态。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // 在 macOS 上，当单击停靠栏图标并且没有其他窗口打开时，
  // 通常会重新创建一个窗口。
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 可选：处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // 可以考虑记录日志或显示错误对话框
  dialog.showErrorBox('发生错误', `应用遇到未处理的错误: ${error.message}`);
  // 根据情况决定是否退出应用
  // app.quit();
});