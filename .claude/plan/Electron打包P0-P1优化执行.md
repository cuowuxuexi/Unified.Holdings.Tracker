# Electron 打包 P0+P1 优化执行计划

> **创建时间**: 2025-11-20
> **目标平台**: Windows x64
> **优化范围**: P0（紧急修复）+ P1（重要优化）
> **预估总工时**: 11.5 小时

---

## 执行上下文

### 需求总结

- **目标平台**: Windows x64（当前机器环境）
- **优化范围**: P0（跨平台支持 + 路径健壮性）+ P1（前端优化 + 动态端口）
- **执行策略**: 完成所有修复后统一打包测试
- **基础文档**: `Electron打包条件评估与优化方案.md`

### 当前问题

1. **🔴 P0-1**: Prisma Engine 复制逻辑硬编码 Windows 平台，macOS/Linux 无法使用
2. **🔴 P0-2**: 路径解析依赖特定目录结构，Monorepo 变更可能失败
3. **🟡 P1-1**: 前端资源已部分优化，需验证代码分割配置
4. **🟡 P1-2**: 端口硬编码为 3001，多用户环境可能冲突

---

## 执行步骤详解

### 步骤 1: P0-1 修复跨平台 Prisma Engine 复制 [4h]

**目标**: 支持 Windows/macOS/Linux 三大平台的 Query Engine 复制

**修改文件**: `electron/forge.config.js`

**变更位置**: 第 80-97 行（packageAfterCopy hook）

**具体变更**:

```javascript
// 替换现有的硬编码逻辑
const engineMapping = {
  win32: 'query_engine-windows.dll.node',
  darwin: {
    arm64: 'libquery_engine-darwin-arm64.dylib.node',
    x64: 'libquery_engine-darwin.dylib.node',
  },
  linux: 'libquery_engine-debian-openssl-3.0.x.so.node',
};

let engineName;
if (platform === 'darwin' && typeof engineMapping.darwin === 'object') {
  engineName = engineMapping.darwin[arch] || engineMapping.darwin.x64;
} else {
  engineName = engineMapping[platform];
}

if (!engineName) {
  console.warn(`⚠️ Unsupported platform: ${platform}-${arch}`);
  return;
}

const engineSrc = path.join(prismaClientDir, engineName);
if (fs.existsSync(engineSrc)) {
  fs.copyFileSync(engineSrc, path.join(backendDestDir, engineName));
  console.log(`  ✅ Copied Prisma Engine (${engineName})`);
} else {
  console.error(`  ❌ Prisma Engine not found: ${engineSrc}`);
  const availableEngines = fs
    .readdirSync(prismaClientDir)
    .filter((f) => f.includes('query_engine'));
  console.error(`  Available: ${availableEngines.join(', ')}`);
  throw new Error(`Prisma Engine for ${platform}-${arch} not found`);
}
```

**预期结果**:

- ✅ 支持所有平台的引擎复制
- ✅ 错误时列出可用引擎，便于调试

---

### 步骤 2: P0-2 增强路径解析健壮性 [2h]

**目标**: 路径解析支持 Monorepo 结构变化，避免硬编码

**新建文件**: `electron/launcher/path-resolver.ts`

**代码内容**:

```typescript
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
}
```

**修改文件**: `electron/main.ts`

**变更内容**:

1. 导入 PathResolver
2. 替换 `resolveRendererEntry` 函数为 PathResolver 调用
3. 修改 `startBackend` 中的路径解析

**预期结果**:

- ✅ 路径解析更健壮
- ✅ 支持 Monorepo 结构变化

---

### 步骤 3: P1-1 验证前端优化状态 [0.5h]

**目标**: 确认前端资源优化配置完整

**检查项**:

1. `frontend/src/lib/echarts.ts` - ECharts 按需加载 ✅（已确认）
2. `frontend/src/app/providers/QueryProvider.tsx` - React Query 配置 ✅（已确认）
3. `frontend/vite.config.ts` - 代码分割配置

**可能变更**: 如未配置代码分割，添加 manualChunks

**预期结果**:

- ✅ 前端 bundle 分割为多个 chunk

---

### 步骤 4: P1-2 实现动态端口分配 [2h]

**目标**: 后端动态分配 3001-3010 端口，避免冲突

**修改文件**: `electron/main.ts`

**变更内容**:

1. 修改 `backendUrl` 为可变变量
2. 新增 `findAvailablePort` 函数
3. 修改 `startBackend` 返回动态端口
4. 更新 `createWindow` 使用动态 URL

**预期结果**:

- ✅ 端口冲突时自动切换
- ✅ 提升多用户环境稳定性

---

### 步骤 5-8: 构建与测试

**步骤 5**: 执行构建前检查

- 安装依赖
- 生成 Prisma Client
- 运行预构建检查脚本

**步骤 6**: 执行完整构建

- `npm run build` - 编译所有模块

**步骤 7**: 执行 Electron 打包

- `cd electron && npm run package`

**步骤 8**: 执行打包后测试

- 启动测试
- 功能测试
- 数据持久化测试

---

## 执行时间线

| 步骤 | 任务               | 预估时间 | 累计时间 |
| ---- | ------------------ | -------- | -------- |
| 1    | P0-1 Prisma Engine | 4h       | 4h       |
| 2    | P0-2 路径解析      | 2h       | 6h       |
| 3    | P1-1 前端优化      | 0.5h     | 6.5h     |
| 4    | P1-2 动态端口      | 2h       | 8.5h     |
| 5    | 构建前检查         | 0.5h     | 9h       |
| 6    | 完整构建           | 1h       | 10h      |
| 7    | Electron 打包      | 0.5h     | 10.5h    |
| 8    | 打包后测试         | 1h       | 11.5h    |

---

## 质量保证

### 代码质量

- 遵循 TypeScript 严格模式
- 添加适当的错误处理
- 提供详细的日志输出

### 测试覆盖

- 多平台引擎复制逻辑（通过日志验证）
- 路径解析在不同环境下的正确性
- 端口冲突场景测试

### 文档更新

- 更新相关代码注释
- 记录关键决策和实现细节

---

## 执行记录

### 2025-11-20

- [x] 创建执行计划文档
- [ ] 执行 P0-1: Prisma Engine 修复
- [ ] 执行 P0-2: 路径解析增强
- [ ] 执行 P1-1: 前端优化验证
- [ ] 执行 P1-2: 动态端口分配
- [ ] 执行构建与打包
- [ ] 执行测试验证

---

**计划结束**
