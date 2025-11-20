# Electron Forge + 内嵌后端打包条件评估报告

> **文档版本**: v1.0
> **生成日期**: 2025-11-20
> **项目**: Unified Holdings Tracker
> **评估范围**: Electron 打包配置、构建流程、运行时架构、跨平台兼容性

---

## 1. 执行摘要 (Executive Summary)

### 整体成熟度评级

**⭐️⭐️⭐️⭐️☆ (4/5 星 - 80% 成熟度)**

当前打包方案已经实现了核心功能，能够生成可独立运行的 Windows 应用程序，但在跨平台支持、错误处理和资源优化方面仍有显著提升空间。

### 核心优势 ✅

1. **✅ 完整的生命周期管理**
   - Electron 主进程正确管理后端子进程
   - 实现了僵尸进程检测机制 (`ELECTRON_RUN_AS_NODE`)
   - 应用退出时自动清理后端进程

2. **✅ 现代化构建工具链**
   - 使用 esbuild 打包后端，bundle 体积小、启动快
   - 前端使用 Vite 构建，支持 Tree-shaking
   - 完善的验证脚本 (prebuild-check, postbuild-verify)

3. **✅ 数据库路径动态配置**
   - 打包后自动使用 `userData` 目录存放数据库
   - 避免了写入权限问题

4. **✅ 单实例保护**
   - 使用 `requestSingleInstanceLock()` 防止多开
   - 自动聚焦已有窗口

5. **✅ 安全增强**
   - 启用 ASAR 归档保护源码
   - 配置 Electron Fuses 增强安全性
   - 前端禁用 `nodeIntegration`，启用 `contextIsolation`

### 关键风险 ⚠️

1. **🔴 跨平台兼容性严重不足**
   - Prisma Engine 复制逻辑**硬编码 Windows 平台**
   - macOS/Linux 打包后无法启动（缺少对应的 Query Engine）
   - 影响范围: 100% 的非 Windows 用户

2. **🔴 资源路径依赖脆弱**
   - 多处路径解析依赖特定目录结构 (`../../apps/backend/...`)
   - Monorepo 结构变更可能导致打包失败
   - 缺少路径有效性验证

3. **🟡 端口配置僵化**
   - 后端端口硬编码为 3001，无法动态分配
   - 多用户环境下可能冲突
   - 缺少端口占用时的自动切换机制

4. **🟡 前端资源未优化**
   - ECharts 全量引入，bundle 体积大
   - React Query 默认配置不适合 Electron 本地环境
   - 无代码分割 (Code Splitting)

5. **🟢 错误处理不完善**
   - 后端启动失败时用户只能"重试"或"退出"
   - 缺少降级模式（如离线查看历史数据）
   - 日志收集机制不完善

### 推荐行动优先级

| 优先级 | 任务                            | 预估工作量 | 影响                  |
| ------ | ------------------------------- | ---------- | --------------------- |
| 🔴 P0  | 修复跨平台 Prisma Engine 复制   | 4h         | 阻塞 macOS/Linux 打包 |
| 🔴 P0  | 路径解析健壮性增强              | 2h         | 提升构建稳定性        |
| 🟡 P1  | 前端资源优化 (ECharts 按需加载) | 3h         | 减少 30% 包体积       |
| 🟡 P1  | 动态端口分配机制                | 2h         | 避免端口冲突          |
| 🟢 P2  | 增强错误处理和日志              | 4h         | 提升用户体验          |

---

## 2. 分项评估 (Component Assessment)

### 2.1 构建流程成熟度

**评分: ⭐️⭐️⭐️⭐️☆ (85%)**

#### 优势

1. **完善的脚本化流程**

   ```json
   "build": "npm run prebuild:check && npm run clean:build && npm run build:all && npm run postbuild:verify"
   ```

   - 构建前检查 → 清理 → 构建 → 验证，形成闭环

2. **并行构建优化**

   ```json
   "build:all": "npm run build:prisma && npm run build:packages && concurrently \"npm run build:backend\" \"npm run build:frontend\" && npm run build:electron"
   ```

   - 使用 `concurrently` 并行构建后端和前端
   - Prisma 和 Packages 按依赖顺序串行

3. **构建产物验证 (postbuild-verify.js)**
   - 检查所有关键产物是否存在
   - 区分 critical 和 warning 级别

#### 不足

1. **缺少增量构建支持**
   - 每次全量清理重建，耗时长
   - 建议: 使用 TypeScript 的 `--incremental` 选项

2. **错误回滚机制缺失**
   - 构建失败时不会自动恢复上一个成功版本
   - 建议: 增加 Git tag 或备份机制

3. **缺少构建缓存**
   - esbuild 和 Vite 均未配置持久化缓存
   - 建议: 启用 esbuild 的 `metafile` 和 Vite 的 cache directory

#### 改进建议

```javascript
// apps/backend/build.js - 增加缓存和错误处理
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

console.log('🧹 Building backend bundle with esbuild...');

// 生成构建元数据用于缓存
const metafilePath = path.join(__dirname, 'dist/.esbuild-meta.json');

esbuild
  .build({
    entryPoints: [path.join(__dirname, 'src/server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.join(__dirname, 'dist/server-bundle.js'),
    external: ['electron', '@prisma/client', 'sharp'],
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    metafile: true, // 启用元数据
    logLevel: 'info',
    incremental: false, // 生产环境不使用增量构建
  })
  .then((result) => {
    // 保存元数据用于分析
    if (result.metafile) {
      fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2));
      console.log(`📊 Metafile saved to ${metafilePath}`);
    }
    console.log('✅ Backend bundle built successfully: dist/server-bundle.js');
  })
  .catch((e) => {
    console.error('❌ Build failed:', e);
    // 保留上一次成功的构建产物
    const backupPath = path.join(__dirname, 'dist/server-bundle.js.backup');
    if (fs.existsSync(backupPath)) {
      console.log('⚠️  Restoring previous successful build...');
      fs.copyFileSync(
        backupPath,
        path.join(__dirname, 'dist/server-bundle.js')
      );
    }
    process.exit(1);
  });
```

---

### 2.2 资源打包策略

**评分: ⭐️⭐️⭐️☆☆ (70%)**

#### 优势

1. **后端 Bundle 方案优秀**
   - 使用 esbuild 打包为单文件
   - 启用 minify 和 sourcemap
   - 正确排除 native 模块

2. **ASAR 归档策略合理**
   - 启用 `asar: true` 保护源码
   - 使用 `auto-unpack-natives` 插件处理原生模块

3. **前端资源分离**
   - 前端构建产物独立于 Electron 主进程
   - 支持开发/生产模式路径切换

#### 不足

1. **🔴 Prisma Engine 复制逻辑硬编码平台**

   当前代码 (forge.config.js:80-97):

   ```javascript
   let engineName = 'query_engine-windows.dll.node';
   if (platform === 'darwin') engineName = 'libquery_engine-darwin.dylib.node';
   if (platform === 'linux') engineName = 'libquery_engine-linux-gnu.so.node';

   // 但实际只处理 Windows
   if (platform === 'win32') {
     const engineSrc = path.join(prismaClientDir, engineName);
     if (fs.existsSync(engineSrc)) {
       fs.copyFileSync(engineSrc, path.join(backendDestDir, engineName));
     }
   }
   ```

   **问题**: macOS 和 Linux 的分支永远不会执行！

2. **前端资源未优化**
   - ECharts 全量引入 (~1MB+)
   - 无代码分割
   - 图片资源未压缩

3. **缺少资源完整性校验**
   - 复制完成后未验证文件 MD5/SHA256
   - 可能出现损坏的 bundle

#### 改进方案

**修复跨平台 Prisma Engine 复制**

```javascript
// forge.config.js - packageAfterCopy hook
hooks: {
  packageAfterCopy: async (
    config,
    buildPath,
    electronVersion,
    platform,
    arch
  ) => {
    console.log('📦 [Hook] Copying backend resources...');

    const resourcesDir = path.resolve(buildPath, '..');
    const backendDestDir = path.join(resourcesDir, 'backend');
    fs.mkdirSync(backendDestDir, { recursive: true });

    // 1. Copy server bundle
    const backendSrc = path.join(
      __dirname,
      '../apps/backend/dist/server-bundle.js'
    );
    if (!fs.existsSync(backendSrc)) {
      throw new Error('Backend bundle not found. Did you run npm run build?');
    }
    fs.copyFileSync(backendSrc, path.join(backendDestDir, 'server-bundle.js'));
    console.log('  ✅ Copied server-bundle.js');

    // 2. Copy Prisma Engine - 跨平台支持
    const prismaClientDir = path.join(
      __dirname,
      '../node_modules/.prisma/client'
    );

    // 根据平台确定引擎文件名
    const engineMapping = {
      win32: 'query_engine-windows.dll.node',
      darwin: {
        arm64: 'libquery_engine-darwin-arm64.dylib.node',
        x64: 'libquery_engine-darwin.dylib.node',
      },
      linux: 'libquery_engine-debian-openssl-3.0.x.so.node', // 根据实际 Prisma 版本调整
    };

    let engineName;
    if (platform === 'darwin' && typeof engineMapping.darwin === 'object') {
      engineName = engineMapping.darwin[arch] || engineMapping.darwin.x64;
    } else {
      engineName = engineMapping[platform];
    }

    if (!engineName) {
      console.warn(`⚠️  Unsupported platform: ${platform}-${arch}`);
      return;
    }

    const engineSrc = path.join(prismaClientDir, engineName);
    if (fs.existsSync(engineSrc)) {
      fs.copyFileSync(engineSrc, path.join(backendDestDir, engineName));
      console.log(`  ✅ Copied Prisma Engine (${engineName})`);
    } else {
      console.error(`  ❌ Prisma Engine not found at: ${engineSrc}`);
      console.error(`  Available engines in ${prismaClientDir}:`);
      const availableFiles = fs
        .readdirSync(prismaClientDir)
        .filter((f) => f.includes('query_engine'));
      console.error(`    ${availableFiles.join('\n    ')}`);
      throw new Error(`Prisma Engine for ${platform}-${arch} not found`);
    }

    // 3. Copy Schema
    const schemaSrc = path.join(
      __dirname,
      '../apps/backend/prisma/schema.prisma'
    );
    if (fs.existsSync(schemaSrc)) {
      fs.copyFileSync(schemaSrc, path.join(backendDestDir, 'schema.prisma'));
      console.log('  ✅ Copied schema.prisma');
    }

    // 4. 生成资源清单用于运行时验证
    const manifest = {
      platform,
      arch,
      buildDate: new Date().toISOString(),
      files: {
        serverBundle: 'server-bundle.js',
        prismaEngine: engineName,
        schema: 'schema.prisma',
      },
    };
    fs.writeFileSync(
      path.join(backendDestDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    console.log('  ✅ Generated manifest.json');
  };
}
```

**前端资源优化**

```typescript
// frontend/src/lib/echarts.ts - 按需加载
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

export default echarts;
```

```typescript
// frontend/src/app/providers/QueryProvider.tsx - 优化配置
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30秒内数据视为新鲜
      gcTime: 5 * 60 * 1000, // 5分钟后清理缓存 (原 cacheTime)
      refetchOnWindowFocus: false, // Electron 环境下禁用窗口聚焦重新获取
      refetchOnReconnect: false, // 本地后端，无需重连刷新
      retry: 1, // 本地服务，失败重试1次即可
    },
  },
});
```

---

### 2.3 运行时架构

**评分: ⭐️⭐️⭐️⭐️☆ (80%)**

#### 优势

1. **完善的进程管理**

   ```typescript
   backendProcess = fork(backendEntry, [], {
     env,
     stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
   });

   app.on('before-quit', async (event) => {
     if (backendProcess) {
       backendProcess.kill();
       backendProcess = null;
     }
   });
   ```

2. **僵尸进程预防**
   - 设置 `ELECTRON_RUN_AS_NODE=1` 环境变量
   - 后端可检测父进程存活并自动退出

3. **数据库路径动态配置**

   ```typescript
   function configureDatabaseEnv() {
     if (!app.isPackaged) return;

     const userDataPath = app.getPath('userData');
     const dbPath = path.join(userDataPath, DATABASE_FILE_NAME);
     process.env.DATABASE_URL = `file:${dbPath}`;
   }
   ```

#### 不足

1. **🟡 端口硬编码**

   ```typescript
   const backendUrl = 'http://localhost:3001';
   env.PORT = '3001'; // 硬编码
   ```

   **风险**: 多用户环境下端口冲突

2. **🟡 后端启动超时固定**

   ```typescript
   while (attempts < 30) {
     // 30秒超时
     if (await checkBackendService()) {
       return;
     }
     await new Promise((resolve) => setTimeout(resolve, 1000));
     attempts++;
   }
   ```

   **问题**: 低性能设备可能需要更长时间

3. **🟢 环境变量传递不完整**
   - 未传递 `NODE_ENV`
   - 未传递日志级别配置

#### 改进方案

**动态端口分配**

```typescript
// electron/main.ts
import net from 'net';

// 查找可用端口
async function findAvailablePort(
  startPort: number,
  endPort: number
): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    if (!(await checkPortInUse(port))) {
      return port;
    }
  }
  throw new Error(`No available port in range ${startPort}-${endPort}`);
}

async function startBackend() {
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: Using external backend on port 3001');
    return { url: 'http://localhost:3001', port: 3001 };
  }

  // 查找可用端口
  const port = await findAvailablePort(3001, 3010);
  const backendUrl = `http://localhost:${port}`;

  console.log(`Starting backend on port ${port}...`);

  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'server-bundle.js')
    : path.resolve(__dirname, '../../apps/backend/dist/server-bundle.js');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(port),
    NODE_ENV: app.isPackaged ? 'production' : 'development',
    LOG_LEVEL: app.isPackaged ? 'info' : 'debug',
  };

  if (process.env.DATABASE_URL) {
    env.DATABASE_URL = process.env.DATABASE_URL;
  }

  backendProcess = fork(backendEntry, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  // ... 后续监听和等待逻辑 ...

  return { url: backendUrl, port };
}

async function createWindow() {
  // 启动后端并获取实际 URL
  const backend = await startBackend();

  // 检查后端服务
  const backendRunning = await checkBackendService(backend.url);

  // ... 创建窗口逻辑 ...
}
```

**增强环境变量传递**

```typescript
// apps/backend/src/config/env.ts
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  databaseUrl: process.env.DATABASE_URL || 'file:./prisma/data/portfolio.db',
  isElectron: process.env.ELECTRON_RUN_AS_NODE === '1',
  userDataPath: process.env.ELECTRON_USER_DATA,
};
```

---

### 2.4 跨平台兼容性

**评分: ⭐️⭐️☆☆☆ (40%)**

#### 当前状态

| 平台        | 状态        | 问题                                |
| ----------- | ----------- | ----------------------------------- |
| Windows x64 | ✅ 完全支持 | 无                                  |
| macOS x64   | ❌ 不可用   | Prisma Engine 未复制                |
| macOS ARM64 | ❌ 不可用   | Prisma Engine 未复制                |
| Linux x64   | ❌ 不可用   | Prisma Engine 未复制 + 未配置 Maker |

#### 改进方案

**1. 修复 Prisma Engine 复制 (已在 2.2 节详述)**

**2. 配置 Linux Maker**

```javascript
// forge.config.js
makers: [
  {
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'PortfolioTool',
      setupIcon: './assets/icon.ico'
    },
    platforms: ['win32'] // 明确指定平台
  },
  {
    name: '@electron-forge/maker-zip',
    platforms: ['darwin', 'linux'],
  },
  {
    name: '@electron-forge/maker-deb',
    config: {
      options: {
        maintainer: 'Portfolio Tool Developer',
        homepage: 'https://github.com/cuowuxuexi/Unified.Holdings.Tracker',
        icon: './assets/icon.png',
        categories: ['Office', 'Finance']
      }
    },
    platforms: ['linux']
  },
  {
    name: '@electron-forge/maker-rpm',
    config: {
      options: {
        homepage: 'https://github.com/cuowuxuexi/Unified.Holdings.Tracker',
        icon: './assets/icon.png',
        categories: ['Office', 'Finance']
      }
    },
    platforms: ['linux']
  }
],
```

**3. 跨平台路径处理**

```typescript
// electron/main.ts - 统一路径处理工具
function resolvePath(...segments: string[]): string {
  // 确保跨平台兼容性
  return path.resolve(...segments).replace(/\\/g, '/');
}

function resolveBackendEntry(): string {
  if (app.isPackaged) {
    return resolvePath(process.resourcesPath, 'backend', 'server-bundle.js');
  }

  // 开发模式：从当前文件所在位置向上查找
  // electron/dist/main.js -> electron -> root -> apps/backend/dist
  return resolvePath(__dirname, '../../apps/backend/dist/server-bundle.js');
}

function resolveRendererEntry(): string | null {
  const candidates = [
    resolvePath(__dirname, '../renderer/index.html'),
    resolvePath(__dirname, '../../frontend/dist/index.html'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
```

**4. 测试矩阵**

| 测试项     | Windows | macOS x64 | macOS ARM64 | Linux |
| ---------- | ------- | --------- | ----------- | ----- |
| 构建成功   | ✅      | 🔲        | 🔲          | 🔲    |
| 启动成功   | ✅      | 🔲        | 🔲          | 🔲    |
| 后端连接   | ✅      | 🔲        | 🔲          | 🔲    |
| 数据库读写 | ✅      | 🔲        | 🔲          | 🔲    |
| 单实例锁   | ✅      | 🔲        | 🔲          | 🔲    |

---

### 2.5 安全与稳定性

**评分: ⭐️⭐️⭐️⭐️☆ (85%)**

#### 优势

1. **代码保护**
   - ASAR 归档 (`asar: true`)
   - esbuild minify
   - Source map 分离

2. **Electron 安全配置**

   ```typescript
   webPreferences: {
     nodeIntegration: false,
     contextIsolation: true,
   }
   ```

3. **Fuses 安全增强**

   ```javascript
   [FuseV1Options.RunAsNode]: false,
   [FuseV1Options.EnableCookieEncryption]: true,
   [FuseV1Options.OnlyLoadAppFromAsar]: true,
   [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
   ```

4. **单实例保护**

   ```typescript
   const gotTheLock = app.requestSingleInstanceLock();
   if (!gotTheLock) {
     app.quit();
   }
   ```

5. **僵尸进程预防**
   - 主进程退出时终止后端
   - 后端检测父进程存活

#### 不足

1. **🟡 缺少代码签名**
   - Windows: 未配置 Authenticode 签名
   - macOS: 未配置 notarization
   - 影响: 用户安装时可能被警告

2. **🟡 敏感信息暴露风险**
   - 环境变量可能包含敏感信息
   - Source map 可能暴露源码结构

3. **🟢 更新机制缺失**
   - 无自动更新功能
   - 建议: 集成 `electron-updater`

#### 改进建议

**配置代码签名**

```javascript
// forge.config.js
module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon',
    name: 'Portfolio Tool',
    executableName: 'PortfolioTool',

    // Windows 代码签名
    ...(process.platform === 'win32' &&
      process.env.WINDOWS_CERTIFICATE_FILE && {
        certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
      }),

    // macOS 代码签名
    ...(process.platform === 'darwin' && {
      osxSign: {
        identity: process.env.APPLE_IDENTITY,
        'hardened-runtime': true,
        entitlements: 'entitlements.plist',
        'entitlements-inherit': 'entitlements.plist',
        'signature-flags': 'library',
      },
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      },
    }),
  },
  // ... 其他配置
};
```

**生产环境禁用 Source Map**

```javascript
// apps/backend/build.js
esbuild.build({
  // ...
  sourcemap: process.env.NODE_ENV !== 'production',
  // ...
});
```

---

## 3. 优化建议路线图 (Optimization Roadmap)

### 阶段一：紧急修复 (Critical Fixes) - 1-2 天

#### 🔴 P0-1: 修复跨平台 Prisma Engine 复制

**问题描述**: 当前仅支持 Windows 平台，macOS 和 Linux 打包后无法启动

**影响范围**: 100% 非 Windows 用户

**修复方案**:

1. 更新 `forge.config.js` 的 `packageAfterCopy` hook
2. 使用平台映射表动态选择 Query Engine
3. 增加错误处理和可用引擎列表输出

**预估工作量**: 4 小时

**验证方法**:

```bash
# macOS
npm run make
./out/Portfolio Tool-darwin-x64/Portfolio Tool.app/Contents/MacOS/Portfolio Tool

# Linux
npm run make
./out/make/deb/x64/portfolio-tool_1.0.0_amd64.deb
```

**参考代码**: 见 2.2 节

---

#### 🔴 P0-2: 路径解析健壮性增强

**问题描述**: 路径解析依赖特定目录结构，Monorepo 变更可能导致失败

**影响范围**: 构建流程稳定性

**修复方案**:

```typescript
// electron/launcher/path-resolver.ts (新建)
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export class PathResolver {
  private static instance: PathResolver;

  private constructor(
    private readonly isPackaged: boolean,
    private readonly resourcesPath: string,
    private readonly appPath: string
  ) {}

  static getInstance(): PathResolver {
    if (!this.instance) {
      this.instance = new PathResolver(
        app.isPackaged,
        process.resourcesPath,
        app.getAppPath()
      );
    }
    return this.instance;
  }

  resolveBackendEntry(): string {
    if (this.isPackaged) {
      return path.join(this.resourcesPath, 'backend', 'server-bundle.js');
    }

    // 开发模式：向上查找 apps/backend
    let currentDir = this.appPath;
    for (let i = 0; i < 5; i++) {
      // 最多向上5层
      const candidate = path.join(
        currentDir,
        'apps/backend/dist/server-bundle.js'
      );
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      currentDir = path.dirname(currentDir);
    }

    throw new Error('Backend entry not found. Please run npm run build');
  }

  resolveRendererEntry(): string {
    if (this.isPackaged) {
      // 打包后路径
      const candidates = [
        path.join(this.resourcesPath, 'renderer/index.html'),
        path.join(this.appPath, 'renderer/index.html'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } else {
      // 开发模式：向上查找 frontend/dist
      let currentDir = this.appPath;
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(currentDir, 'frontend/dist/index.html');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
        currentDir = path.dirname(currentDir);
      }
    }

    throw new Error(
      'Renderer entry not found. Please run npm run build:frontend'
    );
  }

  resolvePrismaSchema(): string {
    if (this.isPackaged) {
      return path.join(this.resourcesPath, 'backend', 'schema.prisma');
    }

    let currentDir = this.appPath;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(
        currentDir,
        'apps/backend/prisma/schema.prisma'
      );
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      currentDir = path.dirname(currentDir);
    }

    throw new Error('Prisma schema not found');
  }
}
```

**使用示例**:

```typescript
// electron/main.ts
import { PathResolver } from './launcher/path-resolver';

async function startBackend() {
  const pathResolver = PathResolver.getInstance();

  try {
    const backendEntry = pathResolver.resolveBackendEntry();
    console.log(`Backend entry: ${backendEntry}`);

    // ... 启动逻辑
  } catch (error) {
    dialog.showErrorBox('Backend Error', error.message);
    throw error;
  }
}
```

**预估工作量**: 2 小时

---

### 阶段二：重要优化 (Important Improvements) - 2-3 天

#### 🟡 P1-1: 前端资源优化

**优化目标**: 减少 30% 以上的前端 bundle 体积

**收益**:

- 安装包体积减小
- 首次加载速度提升
- 内存占用降低

**实施步骤**:

1. **ECharts 按需加载** (已在 2.2 节详述)

   预期收益: 减少约 1.2 MB

2. **React Query 配置优化** (已在 2.2 节详述)

   预期收益: 降低运行时内存占用 15%

3. **Ant Design 按需加载**

   ```typescript
   // vite.config.ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import { AntDesignResolver } from 'unplugin-vue-components/resolvers';
   import Components from 'unplugin-vue-components/vite';

   export default defineConfig({
     plugins: [
       react(),
       Components({
         resolvers: [AntDesignResolver()],
       }),
     ],
     build: {
       rollupOptions: {
         output: {
           manualChunks: {
             'vendor-react': ['react', 'react-dom', 'react-router-dom'],
             'vendor-antd': ['antd'],
             'vendor-chart': ['echarts'],
           },
         },
       },
     },
   });
   ```

4. **图片资源优化**

   ```bash
   # 安装优化工具
   npm install --save-dev vite-plugin-imagemin
   ```

   ```typescript
   // vite.config.ts
   import viteImagemin from 'vite-plugin-imagemin';

   export default defineConfig({
     plugins: [
       viteImagemin({
         gifsicle: { optimizationLevel: 7 },
         optipng: { optimizationLevel: 7 },
         mozjpeg: { quality: 80 },
         pngquant: { quality: [0.8, 0.9], speed: 4 },
         svgo: {
           plugins: [
             { name: 'removeViewBox' },
             { name: 'removeEmptyAttrs', active: false },
           ],
         },
       }),
     ],
   });
   ```

**预估工作量**: 3 小时

**验证方法**:

```bash
npm run build:frontend
du -sh electron/renderer  # macOS/Linux
dir electron\renderer  # Windows
```

---

#### 🟡 P1-2: 动态端口分配机制

**优化目标**: 避免端口冲突，支持多用户环境

**收益**:

- 提升稳定性
- 支持同一机器多实例（虽然有单实例锁，但测试时有用）

**实施步骤**: 已在 2.3 节详述

**预估工作量**: 2 小时

---

#### 🟡 P1-3: 增强构建验证

**优化目标**: 确保所有平台产物完整性

**实施步骤**:

```javascript
// scripts/postbuild-verify.js - 增强版
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('\n🔍 开始构建后验证（增强版）...\n');

// 计算文件 SHA256
function calculateHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

const requiredArtifacts = [
  // ... 原有定义
  {
    name: 'Backend Bundle',
    path: 'apps/backend/dist/server-bundle.js',
    critical: true,
    minSize: 1024 * 100, // 至少 100KB
  },
  {
    name: 'Frontend Bundle (JS)',
    pattern: 'electron/renderer/assets/index-*.js',
    critical: true,
    minSize: 1024 * 50,
  },
  // ...
];

let criticalFailed = false;
const manifestData = {
  buildDate: new Date().toISOString(),
  artifacts: [],
};

requiredArtifacts.forEach(({ name, path: artifactPath, critical, minSize }) => {
  const fullPath = path.join(process.cwd(), artifactPath);

  if (!fs.existsSync(fullPath)) {
    if (critical) {
      console.error(`❌ ${name} 缺失：${artifactPath}`);
      criticalFailed = true;
    }
    return;
  }

  const stats = fs.statSync(fullPath);

  // 检查文件大小
  if (minSize && stats.size < minSize) {
    console.error(
      `❌ ${name} 文件过小：${stats.size} bytes (最小: ${minSize} bytes)`
    );
    criticalFailed = true;
    return;
  }

  // 计算哈希
  const hash = calculateHash(fullPath);

  manifestData.artifacts.push({
    name,
    path: artifactPath,
    size: stats.size,
    sha256: hash,
  });

  console.log(`✅ ${name} (${(stats.size / 1024).toFixed(2)} KB)`);
});

// 保存构建清单
fs.writeFileSync(
  path.join(process.cwd(), 'build-manifest.json'),
  JSON.stringify(manifestData, null, 2)
);

console.log('\n📋 构建清单已保存到 build-manifest.json\n');

if (criticalFailed) {
  console.error('❌ 构建验证失败\n');
  process.exit(1);
} else {
  console.log('✅ 构建验证通过\n');
  process.exit(0);
}
```

**预估工作量**: 1 小时

---

### 阶段三：长期演进 (Long-term Enhancements) - 持续迭代

#### 🟢 L1: 自动更新机制

**愿景**: 用户无需手动下载新版本，应用自动检测并更新

**技术方案**: 集成 `electron-updater`

**里程碑**:

1. M1 (1 周): 基础更新检测
2. M2 (2 周): 增量更新支持
3. M3 (3 周): 自动回滚机制

**参考配置**:

```javascript
// forge.config.js
publishers: [
  {
    name: '@electron-forge/publisher-github',
    config: {
      repository: {
        owner: 'cuowuxuexi',
        name: 'Unified.Holdings.Tracker',
      },
      prerelease: false,
    },
  },
];
```

```typescript
// electron/main.ts
import { autoUpdater } from 'electron-updater';

app.whenReady().then(() => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', () => {
      dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: '发现新版本，正在后台下载...',
      });
    });

    autoUpdater.on('update-downloaded', () => {
      dialog
        .showMessageBox({
          type: 'info',
          title: '更新准备就绪',
          message: '新版本已下载，应用将在重启后更新',
          buttons: ['立即重启', '稍后'],
        })
        .then((result) => {
          if (result.response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
    });
  }
});
```

---

#### 🟢 L2: 增强错误处理和日志

**愿景**: 用户遇到问题时能自助诊断，开发者能远程定位

**技术方案**:

1. 集成 Sentry 或自建错误收集
2. 结构化日志 (已有 pino)
3. 诊断报告生成工具

**里程碑**:

1. M1: 客户端错误收集
2. M2: 服务端日志聚合
3. M3: 用户诊断报告导出

**参考实现**:

```typescript
// electron/logger.ts
import { app } from 'electron';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logDir = path.join(app.getPath('userData'), 'logs');
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(
  logDir,
  `app-${new Date().toISOString().split('T')[0]}.log`
);

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: logFile },
      },
      {
        target: 'pino-pretty',
        options: { destination: 1 }, // stdout
      },
    ],
  },
});

// 导出诊断报告
export async function generateDiagnosticReport(): Promise<string> {
  const report = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    logs: fs.readFileSync(logFile, 'utf-8').split('\n').slice(-100), // 最后100行
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL ? '[REDACTED]' : 'undefined',
    },
  };

  const reportPath = path.join(
    app.getPath('userData'),
    'diagnostic-report.json'
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return reportPath;
}
```

---

#### 🟢 L3: 性能监控和优化

**愿景**: 持续监控应用性能，主动优化

**技术方案**:

1. 启动时间监控
2. 内存使用监控
3. API 响应时间监控

**里程碑**:

1. M1: 基础指标收集
2. M2: 性能基线建立
3. M3: 自动性能回归检测

---

## 4. 最佳实践建议 (Best Practices)

### 4.1 构建前检查清单

````markdown
## 构建前检查清单 (Pre-build Checklist)

- [ ] 依赖安装完整
  ```bash
  npm install
  npm run ensure:electron-deps
  ```
````

- [ ] Prisma Client 已生成

  ```bash
  npm run build:prisma
  ```

- [ ] 所有 TypeScript 代码通过编译

  ```bash
  npm run build:packages
  npm run build:backend
  npm run build:frontend
  ```

- [ ] 单元测试通过

  ```bash
  npm run test:backend
  ```

- [ ] 构建产物验证通过

  ```bash
  npm run postbuild:verify
  ```

- [ ] Git 工作区干净（可选，推荐）

  ```bash
  git status
  ```

- [ ] 版本号已更新
  - package.json
  - electron/package.json

````

---

### 4.2 打包后测试清单

```markdown
## 打包后测试清单 (Post-package Testing)

### 基础功能测试

- [ ] 应用成功启动
- [ ] 无控制台错误
- [ ] 后端服务自动启动
- [ ] 数据库连接成功

### 核心功能测试

- [ ] 创建新投资组合
- [ ] 添加交易记录
- [ ] 查看持仓明细
- [ ] 数据导入/导出
- [ ] 市场数据获取

### 稳定性测试

- [ ] 应用重启后数据保留
- [ ] 多次关闭/打开无异常
- [ ] 长时间运行无内存泄漏（运行 1 小时+）
- [ ] 模拟网络断开恢复

### 边界测试

- [ ] 端口 3001 被占用时的处理
- [ ] 数据库文件损坏时的处理
- [ ] 磁盘空间不足时的处理

### 平台特定测试

**Windows**:
- [ ] UAC 提示正常
- [ ] 开始菜单快捷方式创建
- [ ] 卸载程序正常

**macOS**:
- [ ] 应用签名验证通过
  ```bash
  codesign -dv --verbose=4 "Portfolio Tool.app"
````

- [ ] Gatekeeper 检查通过
- [ ] 拖拽到 Applications 文件夹

**Linux**:

- [ ] .deb 包安装成功
- [ ] .rpm 包安装成功
- [ ] 桌面快捷方式创建

````

---

### 4.3 发布前验证清单

```markdown
## 发布前验证清单 (Pre-release Validation)

### 文档完善

- [ ] README.md 更新
  - 新功能说明
  - 已知问题列表
  - 系统要求

- [ ] CHANGELOG.md 更新
  - 版本号
  - 发布日期
  - 变更内容分类（新增/修复/优化）

- [ ] 用户手册更新（如有）

### 资产准备

- [ ] 应用图标齐全
  - icon.ico (Windows, 256x256)
  - icon.icns (macOS, 512x512@2x)
  - icon.png (Linux, 512x512)

- [ ] 截图和宣传素材

### 法律合规

- [ ] LICENSE 文件存在
- [ ] 第三方许可证声明（NOTICE 或 LICENSES 文件夹）
- [ ] 隐私政策（如收集数据）

### 质量保证

- [ ] 代码签名配置正确（生产环境）
  ```bash
  # Windows
  echo %WINDOWS_CERTIFICATE_FILE%

  # macOS
  echo $APPLE_ID
  echo $APPLE_TEAM_ID
````

- [ ] 自动更新配置正确（如启用）

- [ ] 安装包体积合理
  - Windows: < 200 MB
  - macOS: < 250 MB
  - Linux: < 180 MB

### 发布准备

- [ ] Git 标签已打

  ```bash
  git tag -a v1.0.0 -m "Release version 1.0.0"
  git push origin v1.0.0
  ```

- [ ] GitHub Release 草稿已创建
  - 版本号
  - 变更日志
  - 下载链接

- [ ] 备份发布产物

````

---

## 5. 参考资料与工具推荐

### 5.1 官方文档

| 资源 | 链接 | 说明 |
|------|------|------|
| Electron 官方文档 | https://www.electronjs.org/docs/latest | 核心概念、API 参考 |
| Electron Forge 文档 | https://www.electronforge.io/ | 打包、发布工具 |
| Prisma 文档 | https://www.prisma.io/docs | ORM 使用指南 |
| esbuild 文档 | https://esbuild.github.io/ | 构建工具配置 |
| Vite 文档 | https://vitejs.dev/ | 前端构建工具 |

### 5.2 Prisma 打包指南

**关键问题**: Prisma 包含二进制 Query Engine，需要特殊处理

**推荐方案**:

1. **预生成所有平台的引擎**

   ```prisma
   // apps/backend/prisma/schema.prisma
   generator client {
     provider = "prisma-client-js"
     binaryTargets = ["native", "darwin", "darwin-arm64", "debian-openssl-3.0.x", "windows"]
   }
````

2. **验证引擎存在**

   ```bash
   ls -la node_modules/.prisma/client/
   # 应该看到多个 query_engine-* 文件
   ```

3. **打包时复制所有引擎**（已在 2.2 节实现）

4. **运行时动态加载**

   ```typescript
   // apps/backend/src/config/prisma.ts
   import { PrismaClient } from '@prisma/client';
   import path from 'path';

   const isElectron = process.env.ELECTRON_RUN_AS_NODE === '1';

   let prismaClient: PrismaClient;

   if (isElectron && process.env.QUERY_ENGINE_LIBRARY) {
     // Electron 打包环境：指定引擎路径
     prismaClient = new PrismaClient({
       log: ['error', 'warn'],
       __internal: {
         engine: {
           binaryPath: process.env.QUERY_ENGINE_LIBRARY,
         },
       },
     });
   } else {
     // 开发环境：自动检测
     prismaClient = new PrismaClient({
       log: ['query', 'error', 'warn'],
     });
   }

   export { prismaClient };
   ```

**参考文档**:

- https://www.prisma.io/docs/guides/deployment/deployment-guides/caveats-when-deploying-to-aws-platforms
- https://github.com/prisma/prisma/discussions/12735

### 5.3 esbuild 最佳实践

**Bundle 优化技巧**:

```javascript
// apps/backend/build.js
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/server-bundle.js',

    // 性能优化
    minify: true,
    treeShaking: true,

    // 外部依赖（不打包进 bundle）
    external: [
      'electron',
      '@prisma/client',
      'sharp', // 原生图像处理库
      'sqlite3', // 如果使用
    ],

    // 别名配置（如果有路径映射）
    alias: {
      '@uht/domain': '../packages/domain/dist/index.js',
      '@uht/application': '../packages/application/dist/index.js',
      '@uht/infra': '../packages/infra/dist/index.js',
    },

    // 注入环境变量（编译时常量）
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'production'
      ),
    },

    // 生成分析报告
    metafile: true,

    sourcemap: process.env.NODE_ENV !== 'production',
    logLevel: 'info',
  })
  .then((result) => {
    // 分析 bundle 大小
    if (result.metafile) {
      const text = require('esbuild').analyzeMetafileSync(result.metafile, {
        verbose: true,
      });
      console.log(text);
    }
  });
```

**Bundle 体积分析**:

```bash
# 安装分析工具
npm install --save-dev esbuild-visualizer

# 生成可视化报告
npx esbuild-visualizer --metadata dist/.esbuild-meta.json --open
```

### 5.4 工具推荐

| 工具                | 用途                          | 安装                               |
| ------------------- | ----------------------------- | ---------------------------------- |
| `electron-builder`  | 替代 Forge 的打包工具（可选） | `npm install -D electron-builder`  |
| `electron-notarize` | macOS 公证                    | `npm install -D electron-notarize` |
| `electron-updater`  | 自动更新                      | `npm install electron-updater`     |
| `asar`              | ASAR 归档工具                 | `npm install -D asar`              |
| `7zip`              | 压缩分析                      | 系统安装                           |
| `Inno Setup`        | Windows 安装程序制作          | https://jrsoftware.org/isinfo.php  |

### 5.5 调试技巧

**查看 ASAR 内容**:

```bash
# 解压 ASAR 归档
npx asar extract out/Portfolio\ Tool-win32-x64/resources/app.asar ./app-extracted

# 查看文件列表
npx asar list out/Portfolio\ Tool-win32-x64/resources/app.asar
```

**启用 Electron 调试日志**:

```bash
# Windows
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_LOG_FILE=electron-debug.log
.\out\Portfolio Tool-win32-x64\Portfolio Tool.exe

# macOS/Linux
ELECTRON_ENABLE_LOGGING=1 ./out/Portfolio\ Tool-darwin-x64/Portfolio\ Tool.app/Contents/MacOS/Portfolio\ Tool
```

**查看 Chromium 网络请求**:

```typescript
// electron/main.ts
mainWindow.webContents.session.webRequest.onBeforeRequest(
  (details, callback) => {
    console.log('Request:', details.url);
    callback({});
  }
);
```

---

## 6. 总结与行动建议

### 当前状态

本项目的 Electron 打包方案已经具备**基本可用**的能力，在 Windows 平台上能够生成可独立运行的应用程序，并实现了后端进程管理、数据库路径配置等核心功能。

### 核心问题

最严重的问题是**跨平台兼容性缺失**，macOS 和 Linux 平台无法使用打包后的应用。这是一个**阻塞性**问题，必须在下次发布前解决。

### 优先行动

建议按以下顺序执行优化：

1. **🔴 立即执行 (本周内)**:
   - 修复跨平台 Prisma Engine 复制 (P0-1)
   - 增强路径解析健壮性 (P0-2)

2. **🟡 近期规划 (本月内)**:
   - 前端资源优化 (P1-1)
   - 动态端口分配 (P1-2)
   - 构建验证增强 (P1-3)

3. **🟢 长期演进 (下季度)**:
   - 自动更新机制 (L1)
   - 错误处理和日志 (L2)
   - 性能监控 (L3)

### 预期收益

完成阶段一和阶段二优化后，预期达成：

- ✅ 支持 Windows、macOS、Linux 三大平台
- ✅ 安装包体积减少 25%+
- ✅ 构建成功率提升至 98%+
- ✅ 用户启动失败率降低至 1% 以下

---

## 7. 需补充的落实要点

1. **Prisma 引擎闭环**

- `schema.prisma` 的 `binaryTargets` 列出 win32/win32-arm64/darwin/darwin-arm64/debian-openssl-3.0.x/linux-musl 等实际支持矩阵。
- 打包时设置并校验 `PRISMA_QUERY_ENGINE_LIBRARY`/`PRISMA_QUERY_ENGINE_LIBRARY_PATH` 指向复制后的引擎文件；postbuild 校验缺失即失败。
- 增加 `openspec/changes/evaluate-electron-packaging/tasks.md` 中的显式验收项：多平台引擎文件存在、哈希正确、运行时可加载。

2. **数据迁移与兼容**

- 将数据库迁移至 `userData` 后，提供版本化迁移脚本与回滚策略（如迁移失败回退旧文件）；明确 `prisma migrate deploy` 何时执行。
- 首次启动检测旧路径 DB，完成迁移后写入版本标记，防止重复迁移或数据丢失。

3. **IPC / preload 安全**

- 约束 IPC 白名单（通道 + payload 校验），禁用 `remote`、限制自定义 protocol 仅加载受信源。
- 在文档中补充最小可用接口列表及输入校验要求，保持 `contextIsolation`、`sandbox` 配置一致。

4. **动态端口落地细则**

- 端口探测成功后，将后端基地址通过环境变量或 preload 注入到渲染进程；`checkBackendService` 支持动态 URL。
- 端口占用或启动超时的 UI 提示需包含重试/退出以及日志位置，方便诊断。

5. **打包/签名矩阵与 CI**

- 给出 win/mac/linux 的 CI 构建脚本片段：缓存 node_modules/Prisma 引擎、产物哈希、代码签名/公证参数注入方式。
- 明确未签名的临时产物仅限 CI 内部使用，发布产物必须签名/公证并校验哈希。

6. **安装器与更新策略**

- Squirrel 的局限（增量更新不稳定、卸载逻辑有限）需要说明；若未来要平滑更新，可评估 NSIS 或 electron-builder 并给出切换条件。
- 若采用 electron-updater，需在发布渠道与签名策略中补充兼容性说明。

7. **质量门槛（量化验收）**

- 跨平台构建成功率 ≥98%；压缩后包体积：Win <200MB、macOS <250MB、Linux <180MB。
- 冷启动主窗口 <5s（中端机），后端启动超时阈值与重试策略写入验收。
- 打包后检查列表补充：多平台引擎存在、哈希验证、端口冲突兜底演练结果。

8. **最小可用日志/诊断**

- 打包版默认持久化 backend stdout/stderr 至 `userData/logs`，首启失败时弹窗展示日志路径。
- 生成简易诊断报告脚本（收集版本、平台、最近日志片段），便于支持与回归验证。

---

**报告结束**

如有疑问或需要详细的实施指导，请参考本文档的代码示例或查阅相关官方文档。
