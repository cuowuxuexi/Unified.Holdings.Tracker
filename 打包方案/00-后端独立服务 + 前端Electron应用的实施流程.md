# 后端独立服务 + 前端Electron应用的实施流程

本文档详细描述了将项目拆分为独立后端服务和Electron前端应用的完整实施流程，解决打包后后端无法启动的问题。

## 1. 准备工作

### 1.1 安装必要的工具
```bash
# 安装pkg用于打包后端
npm install -g pkg

# 安装Electron Forge用于打包前端
cd electron
npm uninstall electron-builder
npm install --save-dev @electron-forge/cli
npx electron-forge import

# 安装Electron Forge插件
npm install --save-dev @electron-forge/maker-squirrel @electron-forge/maker-zip
```

### 1.2 创建工作目录
```bash
# 创建用于存放最终打包文件的目录
mkdir -p release/backend
mkdir -p release/frontend
```

## 2. 修改后端代码

### 2.1 调整后端配置
修改`backend/src/server.ts`，确保它能作为独立服务运行：

```typescript
// 添加配置文件支持
import path from 'path';
import fs from 'fs';

// 确定数据目录
const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction 
  ? path.join(process.cwd(), 'data') 
  : path.join(__dirname, '../data');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 记录启动信息
console.log(`Server starting in ${isProduction ? 'production' : 'development'} mode`);
console.log(`Data directory: ${dataDir}`);

// 其他代码保持不变...
```

### 2.2 更新后端package.json
修改`backend/package.json`，添加pkg配置：

```json
{
  "bin": "dist/server.js",
  "pkg": {
    "assets": [
      "dist/**/*"
    ],
    "targets": ["node16-win-x64"],
    "outputPath": "../release/backend"
  }
}
```

## 3. 修改前端代码

### 3.1 调整API配置
创建或修改`frontend/src/config.ts`：

```typescript
// 后端API地址配置
export const API_BASE_URL = 'http://localhost:3001/api';

// 检查后端连接状态的函数
export async function checkBackendConnection() {
  try {
    const response = await fetch('http://localhost:3001/');
    return response.ok;
  } catch (error) {
    console.error('Backend connection error:', error);
    return false;
  }
}
```

### 3.2 添加后端连接检测
在`frontend/src/App.tsx`中添加连接检测：

```tsx
import { useEffect, useState } from 'react';
import { message } from 'antd';
import { checkBackendConnection } from './config';

function App() {
  const [backendConnected, setBackendConnected] = useState(true);
  
  useEffect(() => {
    const checkConnection = async () => {
      const isConnected = await checkBackendConnection();
      setBackendConnected(isConnected);
      
      if (!isConnected) {
        message.error('无法连接到后端服务，请确保后端服务已启动');
      }
    };
    
    checkConnection();
    const interval = setInterval(checkConnection, 30000); // 每30秒检查一次
    
    return () => clearInterval(interval);
  }, []);
  
  // 其他代码...
}
```

## 4. 修改Electron应用

### 4.1 简化main.ts
修改`electron/main.ts`，移除后端启动代码：

```typescript
import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import fetch from 'node-fetch';

let mainWindow: BrowserWindow | null = null;
const backendUrl = 'http://localhost:3001';

// 检查后端服务是否运行
async function checkBackendService() {
  try {
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
      buttons: ['重试', '继续', '退出'],
      defaultId: 0
    });
    
    if (response === 0) {
      // 重试
      createWindow();
      return;
    } else if (response === 2) {
      // 退出
      app.quit();
      return;
    }
    // 继续，但功能可能受限
  }
  
  // 创建窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 加载前端
  const startUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../renderer/index.html')}`;
  
  mainWindow.loadURL(startUrl);
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

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
```

### 4.2 配置Electron Forge
创建或修改`electron/forge.config.js`：

```javascript
module.exports = {
  packagerConfig: {
    name: "Portfolio Management Tool",
    executableName: "portfolio-tool",
    icon: "./assets/icon", // 不需要扩展名
    asar: true
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: "portfolio-tool",
        setupIcon: './assets/icon.ico'
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    }
  ],
};
```

## 5. 创建启动器

### 5.1 创建启动器脚本
创建`launcher/launcher.js`：

```javascript
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 确定应用目录
const appDir = path.dirname(process.execPath);
console.log('App directory:', appDir);

// 后端服务路径
const backendPath = path.join(appDir, 'backend', 'portfolio-backend.exe');
console.log('Backend path:', backendPath);

// 前端应用路径
const frontendPath = path.join(appDir, 'frontend', 'portfolio-tool.exe');
console.log('Frontend path:', frontendPath);

// 检查文件是否存在
if (!fs.existsSync(backendPath)) {
  console.error('Backend executable not found:', backendPath);
  process.exit(1);
}

if (!fs.existsSync(frontendPath)) {
  console.error('Frontend executable not found:', frontendPath);
  process.exit(1);
}

// 启动后端服务
console.log('Starting backend service...');
const backendProcess = spawn(
  backendPath,
  [],
  { 
    detached: true, 
    stdio: 'ignore',
    cwd: path.dirname(backendPath)
  }
);
backendProcess.unref();

// 等待一段时间让后端启动
console.log('Waiting for backend to start...');
setTimeout(() => {
  // 启动前端应用
  console.log('Starting frontend application...');
  const frontendProcess = spawn(
    frontendPath,
    [],
    { 
      detached: false,
      stdio: 'inherit',
      cwd: path.dirname(frontendPath)
    }
  );

  frontendProcess.on('close', (code) => {
    console.log(`Frontend process exited with code ${code}`);
    process.exit(code);
  });
}, 2000);
```

### 5.2 打包启动器
使用pkg打包启动器：

```bash
cd launcher
npm init -y
npm install --save-dev pkg
npx pkg launcher.js --targets node16-win-x64 --icon ../assets/icon.ico --output ../release/portfolio-launcher.exe
```

## 6. 构建和打包流程

### 6.1 构建后端
```bash
# 编译TypeScript
cd backend
npm run build

# 使用pkg打包
npx pkg .
```

### 6.2 构建前端
```bash
# 编译React应用
cd frontend
npm run build
```

### 6.3 打包Electron应用
```bash
# 使用Electron Forge打包
cd electron
npm run make
```

### 6.4 整合所有组件
```cmd
:: 创建最终发布目录
mkdir final-release\backend
mkdir final-release\frontend

:: 复制后端
copy release\backend\portfolio-backend.exe final-release\backend\

:: 复制前端
xcopy electron\out\portfolio-tool-win32-x64\* final-release\frontend\ /E /I /H

:: 复制启动器
copy release\portfolio-launcher.exe final-release\
```

## 7. 创建安装程序（可选）

### 7.1 使用Inno Setup
创建`setup.iss`文件：

```iss
[Setup]
AppName=Portfolio Management Tool
AppVersion=1.0
DefaultDirName={pf}\PortfolioTool
DefaultGroupName=Portfolio Tool
OutputDir=release
OutputBaseFilename=portfolio-tool-setup

[Files]
Source: "final-release\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\Portfolio Tool"; Filename: "{app}\portfolio-launcher.exe"
Name: "{commondesktop}\Portfolio Tool"; Filename: "{app}\portfolio-launcher.exe"

[Run]
Filename: "{app}\portfolio-launcher.exe"; Description: "Launch Portfolio Tool"; Flags: postinstall nowait
```

### 7.2 编译安装程序
使用Inno Setup Compiler编译`setup.iss`文件。

## 8. 测试

### 8.1 测试独立组件
- 单独测试后端服务
- 单独测试前端应用
- 测试启动器

### 8.2 测试完整安装
- 安装完整应用
- 验证所有功能
- 测试卸载过程

## 9. 发布

### 9.1 准备发布文件
- 安装程序
- 独立组件（可选）
- 说明文档

### 9.2 发布
- 上传到您的存储位置
- 记录版本信息

## 实施顺序总结

1. **准备工作**：安装工具，创建目录
2. **修改代码**：调整后端、前端和Electron代码
3. **创建启动器**：编写和打包启动器
4. **构建组件**：分别构建后端、前端和Electron应用
5. **整合组件**：将所有组件整合到一个目录
6. **创建安装程序**：使用Inno Setup创建安装程序
7. **测试**：测试各个组件和完整安装
8. **发布**：准备和发布最终文件

## 优势

1. **解耦前端和后端**：使它们可以独立更新和维护
2. **避免Electron子进程问题**：解决打包后后端无法启动的问题
3. **简化调试**：可以单独调试前端或后端
4. **灵活性**：可以选择性地只更新前端或后端
5. **稳定性**：后端作为独立服务运行，不受前端应用关闭影响

## 注意事项

1. **端口冲突**：确保后端服务使用的端口不会与其他应用冲突
2. **安全性**：后端服务将监听本地端口，需要考虑安全性
3. **用户体验**：确保用户理解需要两个组件共同工作
4. **错误处理**：前端应用需要优雅地处理后端服务未运行的情况
