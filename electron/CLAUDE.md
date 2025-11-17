[根目录](../CLAUDE.md) > **electron**

---

# Electron 模块文档

> 最后更新：2025-11-16 08:55:50

## 变更记录 (Changelog)

### 2025-11-16
- 初始化模块文档

---

## 模块职责

Electron 模块负责桌面应用的主进程管理，提供：

- **窗口管理**：创建和管理应用主窗口
- **生命周期管理**：应用启动、退出、更新
- **进程间通信**（IPC）：主进程与渲染进程的数据交换
- **系统集成**：菜单、托盘、系统通知
- **应用打包**：使用 Electron Forge 打包成可执行文件

---

## 入口与启动

### 主入口
- **文件**：`dist/main.js`（编译自 `src/main.ts`）
- **配置**：`package.json` 中的 `main` 字段

### 启动流程
1. Electron 加载 `dist/main.js`
2. 创建 BrowserWindow 实例
3. 加载渲染进程：
   - **开发模式**：http://localhost:5173（前端 dev server）
   - **生产模式**：file://（本地 HTML 文件）
4. 注册 IPC 事件监听器
5. 配置应用菜单和快捷键

### 启动命令
```bash
# 开发模式（TypeScript watch）
npm run watch

# 启动主进程（开发模式）
npm run start:dist

# 使用 Electron Forge 启动
npm run start

# 打包应用
npm run package

# 构建安装包
npm run make
```

---

## 对外接口

### 主进程脚本
- **文件**：`src/main.ts`（需编译）
- **职责**：
  - 创建主窗口
  - 加载前端页面
  - 处理应用事件（ready、window-all-closed 等）

### Launcher（应用启动器）
- **目录**：`launcher/`
- **文件**：`launcher/launcher.js`
- **职责**：
  - 自动启动后端服务
  - 等待后端就绪后启动前端
  - 管理子进程生命周期

### Electron Forge 配置
- **文件**：`forge.config.js`
- **配置内容**：
  - Makers（打包格式）：Squirrel (Windows)、Zip、deb、rpm
  - Plugins：auto-unpack-natives、fuses
  - 输出目录：`release/`

---

## 关键依赖与配置

### 主要依赖
- **electron** ^35.1.5 - Electron 框架
- **@electron-forge/cli** ^7.8.0 - CLI 工具
- **@electron-forge/maker-squirrel** ^7.8.0 - Windows 安装包
- **@electron-forge/maker-zip** ^7.8.0 - ZIP 打包
- **electron-squirrel-startup** ^1.0.1 - Squirrel 启动检测

### TypeScript 配置
- **tsconfig.json**：
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "module": "commonjs",
      "outDir": "./dist",
      "rootDir": "./src",
      "esModuleInterop": true,
      "skipLibCheck": true
    }
  }
  ```

### 环境变量
```bash
NODE_ENV=development  # 或 production
```

---

## 数据模型

### 窗口配置
```javascript
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    nodeIntegration: false,      // 安全性
    contextIsolation: true,      // 隔离渲染进程
    preload: path.join(__dirname, 'preload.js') // 预加载脚本
  }
});
```

### IPC 通信示例
```typescript
// 主进程
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 渲染进程（通过 preload）
const version = await ipcRenderer.invoke('get-app-version');
```

---

## 测试与质量

### 测试策略
- Electron 模块暂无自动化测试
- 建议测试重点：
  - 窗口创建和关闭
  - IPC 通信
  - 应用生命周期

### 手动测试
1. 开发模式测试：
   ```bash
   npm run watch
   npm run start:dist
   ```
2. 生产模式测试：
   ```bash
   npm run build
   npm run package
   ```
3. 安装包测试：
   ```bash
   npm run make
   # 运行生成的安装包
   ```

---

## 常见问题 (FAQ)

### Q1: 如何调试主进程？
A:
```bash
# 使用 VSCode 调试
# 在 .vscode/launch.json 中配置：
{
  "type": "node",
  "request": "launch",
  "name": "Electron Main",
  "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
  "program": "${workspaceFolder}/electron/dist/main.js"
}
```

### Q2: 如何修改窗口图标？
A: 在 `forge.config.js` 中配置：
```javascript
build: {
  win: {
    icon: "build/icon.ico"
  }
}
```

### Q3: 如何处理应用更新？
A: 建议使用 `electron-updater`：
1. 安装 `electron-updater`
2. 在主进程中配置自动更新逻辑
3. 发布更新到 GitHub Releases

### Q4: 如何打包后端到 Electron？
A: 在 `forge.config.js` 中配置 `files`：
```javascript
files: [
  "dist/main.js",
  {
    "from": "../backend/dist",
    "to": "backend"
  }
]
```

---

## 相关文件清单

```
electron/
├── launcher/
│   ├── launcher.js               # 应用启动器
│   └── package.json              # Launcher 配置
├── src/
│   ├── main.ts                   # 主进程入口（需编译）
│   └── preload.ts                # 预加载脚本（可选）
├── dist/
│   └── main.js                   # 编译后的主进程
├── renderer/                     # 前端构建产物（来自 frontend/dist）
├── assets/                       # 应用图标等资源
├── forge.config.js               # Electron Forge 配置
├── tsconfig.json                 # TypeScript 配置
└── package.json
```

---

## 架构图

```
┌──────────────────────────────────────────┐
│       Electron Application               │
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐ │
│  │     Main Process (主进程)          │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │  Window Management           │  │ │
│  │  │  (创建窗口、菜单、托盘)      │  │ │
│  │  └──────────────────────────────┘  │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │  IPC Handlers                │  │ │
│  │  │  (处理渲染进程请求)          │  │ │
│  │  └──────────────────────────────┘  │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │  Lifecycle Management        │  │ │
│  │  │  (启动、退出、更新)          │  │ │
│  │  └──────────────────────────────┘  │ │
│  └────────────┬───────────────────────┘ │
│               │ IPC                      │
│  ┌────────────▼───────────────────────┐ │
│  │  Renderer Process (渲染进程)       │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │  React Frontend              │  │ │
│  │  │  (加载自 renderer/ 目录)     │  │ │
│  │  └──────────────────────────────┘  │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

---

## Electron Forge 配置详解

### Makers（打包器）
```javascript
makers: [
  {
    name: '@electron-forge/maker-squirrel',  // Windows 安装包
    config: {
      name: 'Unified Holdings Tracker'
    }
  },
  {
    name: '@electron-forge/maker-zip',       // ZIP 压缩包
    platforms: ['darwin', 'linux', 'win32']
  },
  {
    name: '@electron-forge/maker-deb',       // Debian 包
    config: {}
  },
  {
    name: '@electron-forge/maker-rpm',       // RPM 包
    config: {}
  }
]
```

### Plugins（插件）
```javascript
plugins: [
  {
    name: '@electron-forge/plugin-auto-unpack-natives',
    config: {}
  },
  {
    name: '@electron-forge/plugin-fuses',
    config: {
      version: FuseVersion.V1,
      // 安全性配置
    }
  }
]
```

---

## 安全最佳实践

### 1. 禁用 Node.js 集成
```javascript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true
}
```

### 2. 使用 Preload 脚本
通过 `contextBridge` 暴露安全的 API：
```typescript
// preload.ts
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version')
});
```

### 3. 验证远程内容
加载外部 URL 时验证来源：
```javascript
mainWindow.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith('https://trusted-domain.com')) {
    event.preventDefault();
  }
});
```

---

## 未来改进建议

1. **添加自动更新**：集成 `electron-updater`
2. **补充单元测试**：测试 IPC 通信和窗口管理
3. **优化启动性能**：延迟加载非关键模块
4. **增强错误处理**：捕获主进程异常并上报
5. **支持多窗口**：实现子窗口和窗口管理器
6. **系统托盘**：最小化到托盘，后台运行
