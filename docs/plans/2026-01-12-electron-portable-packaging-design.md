# Electron 便携版打包设计方案

> 创建日期：2026-01-12

## 概述

将 Unified Holdings Tracker 打包为 Windows 便携版应用，用户双击即可运行，无需安装程序。

## 需求确认

| 需求项   | 选择                          |
| -------- | ----------------------------- |
| 目标平台 | 仅 Windows                    |
| 打包形式 | 便携版（文件夹 + exe）        |
| 后端集成 | Electron 自动启动独立后端进程 |
| 数据存储 | 用户目录（%APPDATA%）         |
| 打包工具 | Electron Forge                |

---

## 架构设计

### 打包后文件夹结构

```
unified-holdings-tracker-win32-x64/
├── Unified Holdings Tracker.exe    # Electron 主程序
├── resources/
│   ├── app/                        # 应用代码
│   │   ├── backend/                # 后端 bundle
│   │   │   └── server-bundle.js    # esbuild 打包的后端
│   │   ├── renderer/               # 前端静态文件
│   │   │   ├── index.html
│   │   │   └── assets/
│   │   ├── main.js                 # Electron 主进程
│   │   └── package.json
│   └── prisma/                     # Prisma 相关文件
│       └── schema.prisma
├── *.dll                           # Electron 运行时依赖
└── LICENSE, version 等
```

### 运行流程

1. 用户双击 `Unified Holdings Tracker.exe`
2. Electron 主进程启动
3. 主进程用 `child_process.fork()` 启动后端服务
4. 等待后端就绪后，加载前端页面
5. 用户关闭窗口时，主进程终止后端子进程

### 数据目录

```
%APPDATA%/unified-holdings-tracker/
├── portfolio.db          # SQLite 主数据库
├── portfolio.db-journal  # SQLite 日志（自动生成）
├── logs/                 # 应用日志
│   └── app.log
└── backups/              # 自动备份（可选）
```

---

## 核心模块设计

### 1. 主进程入口 (`electron/main.ts`)

```typescript
// 核心职责：
// 1. 启动后端子进程
// 2. 创建浏览器窗口
// 3. 管理应用生命周期

import { app, BrowserWindow } from 'electron';
import { BackendManager } from './lib/backend-manager';
import { getAppDataPath } from './lib/paths';

const backendManager = new BackendManager();

app.on('ready', async () => {
  await backendManager.start();
  createWindow(`http://localhost:${backendManager.getPort()}`);
});

app.on('before-quit', async () => {
  await backendManager.stop();
});
```

### 2. 后端进程管理器 (`electron/lib/backend-manager.ts`)

```typescript
class BackendManager {
  private process: ChildProcess | null = null;
  private port = 3001;

  async start(): Promise<void> {
    // 1. 检查端口是否被占用，如被占用则尝试下一个端口
    // 2. fork 后端进程
    // 3. 监听 stdout，等待 "Server running on port XXXX"
    // 4. 超时 10 秒未就绪则抛出错误
  }

  async stop(): Promise<void> {
    // 优雅关闭：先发送 SIGTERM，等待 3 秒
    // 如果还未退出，强制 SIGKILL
  }

  getPort(): number {
    return this.port;
  }
}
```

**错误处理策略**：

- 后端启动失败 → 显示错误对话框，提供重试或退出选项
- 后端运行中崩溃 → 自动重启（最多 3 次），超过则提示用户

### 3. 路径工具 (`electron/lib/paths.ts`)

```typescript
import { app } from 'electron';
import path from 'path';

export function getAppDataPath(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('appData'), 'unified-holdings-tracker');
  }
  return path.join(__dirname, '../../data');
}

export function getDatabaseUrl(): string {
  const dbPath = path.join(getAppDataPath(), 'portfolio.db');
  return `file:${dbPath}`;
}
```

### 4. Forge 配置 (`electron/forge.config.ts`)

```typescript
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Unified Holdings Tracker',
    executableName: 'unified-holdings-tracker',
    icon: './assets/icon',
    asar: false,
    ignore: [/node_modules/, /\.git/, /\.vscode/],
    extraResource: ['./node_modules/.prisma', './node_modules/@prisma/client'],
  },
  makers: [], // 留空 = 不生成安装程序
};

export default config;
```

---

## 构建流程

### 资源复制脚本 (`scripts/copy-to-electron.js`)

```javascript
const fs = require('fs-extra');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'electron');

async function copyAssets() {
  // 1. 清理旧文件
  await fs.emptyDir(path.join(electronDir, 'renderer'));
  await fs.emptyDir(path.join(electronDir, 'backend'));

  // 2. 复制前端构建产物
  await fs.copy(
    path.join(root, 'frontend/dist'),
    path.join(electronDir, 'renderer')
  );

  // 3. 复制后端 bundle
  await fs.copy(
    path.join(root, 'apps/backend/dist'),
    path.join(electronDir, 'backend')
  );

  // 4. 复制 Prisma schema
  await fs.copy(
    path.join(root, 'apps/backend/prisma/schema.prisma'),
    path.join(electronDir, 'prisma/schema.prisma')
  );

  console.log('✓ 资源复制完成');
}

copyAssets().catch(console.error);
```

### 打包命令

```bash
# 一键打包
npm run package

# 等价于：
# 1. npm run build          → 构建所有模块
# 2. npm run copy-assets    → 复制资源到 electron
# 3. cd electron && npm run package → Forge 打包

# 输出位置：
# electron/out/unified-holdings-tracker-win32-x64/
```

---

## 开发调试流程

### 开发模式

```bash
# 终端 1：启动后端
npm run dev:backend

# 终端 2：启动前端
npm run dev:frontend

# 终端 3：启动 Electron
npm run electron-dev
```

### 打包前验证

```bash
npm run build
npm run copy-assets
cd electron && npm run start
```

### 打包后验证清单

- [ ] 窗口正常显示
- [ ] 后端 API 可访问
- [ ] 数据库读写正常
- [ ] 关闭窗口后进程完全退出

---

## 实施文件清单

### 需要新建的文件

| 文件路径                          | 用途            |
| --------------------------------- | --------------- |
| `electron/package.json`           | Electron 包配置 |
| `electron/tsconfig.json`          | TypeScript 配置 |
| `electron/forge.config.ts`        | Forge 打包配置  |
| `electron/main.ts`                | 主进程入口      |
| `electron/preload.ts`             | 预加载脚本      |
| `electron/lib/backend-manager.ts` | 后端进程管理器  |
| `electron/lib/paths.ts`           | 路径工具函数    |
| `electron/assets/icon.ico`        | 应用图标        |
| `scripts/copy-to-electron.js`     | 资源复制脚本    |

### 需要修改的文件

| 文件路径                     | 修改内容             |
| ---------------------------- | -------------------- |
| `package.json`               | 更新 `package` 脚本  |
| `apps/backend/src/server.ts` | 添加启动就绪信号输出 |

---

## 后续可选优化

1. **自动更新** — 集成 electron-updater，支持从 GitHub Releases 更新
2. **产物压缩** — 打包后自动生成 zip 便于分发
3. **多平台支持** — 扩展到 macOS 和 Linux
