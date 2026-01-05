# Change: Electron 前后端统一打包能力评测与改进方案

## Why

当前项目的 Electron 打包配置**尚未完整实现前后端统一打包**，存在多个关键阻塞问题导致无法直接生成可分发的桌面应用程序。开发团队需要明确了解：
1. 当前打包配置的完整性和准备度
2. 阻碍统一打包的具体技术障碍
3. 实现统一打包所需的具体改进措施

本评测旨在系统性识别问题、量化风险，并提供可执行的解决路径。

## What Changes

本提案记录了对项目 Electron 打包能力的**全面技术评测结果**，包括：

### 1. 评测发现（当前状态分析）
- ✅ **已完成部分**：Electron Forge 基础配置、前端构建集成、ASAR 归档启用
- ❌ **缺失部分**：后端服务启动机制、Node.js 依赖打包、Prisma 数据库引擎配置、生产环境配置管理

### 2. 识别的阻塞问题（Critical Blockers）
**P0 - 必须解决才能打包**：
1. **后端服务启动机制缺失**
   - 当前 [main.ts:86-97](d:\optimize-branch-copy\electron\main.ts#L86-L97) 仅检查后端是否运行，无启动逻辑
   - 旧方案 [launcher.js:10-61](d:\optimize-branch-copy\electron\launcher\launcher.js#L10-L61) 依赖不存在的独立 exe

2. **后端依赖打包不完整**
   - [package.json:26](d:\optimize-branch-copy\electron\package.json#L26) 排除了 `node_modules`
   - 后端运行时依赖（Express、Prisma、Axios 等）无法在打包后使用

3. **Prisma 数据库引擎缺失**
   - Prisma Client 需要平台特定的二进制引擎（query-engine）
   - 当前配置未包含 `.prisma/client` 生成文件
   - SQLite 数据库文件路径在生产环境下未正确配置

**P1 - 影响用户体验**：
4. **环境变量管理混乱**
   - 生产环境的 `DATABASE_URL`、`PORT` 等配置未预设
   - [env.ts:45](d:\optimize-branch-copy\apps\backend\src\config\env.ts#L45) 使用开发环境默认值

5. **数据目录路径不一致**
   - [data-service.ts:18](d:\optimize-branch-copy\packages\infra\src\data\data-service.ts#L18) 依赖 `process.cwd()`
   - ASAR 归档后路径解析可能失败

### 3. 推荐的解决方案架构
提案建议采用 **Electron 主进程内嵌 Node.js 后端** 方案：
- 使用 `child_process.fork()` 在主进程启动后端服务
- 通过 Electron Forge 的 `packagerConfig.extraResource` 打包后端及依赖
- 使用 `app.getPath('userData')` 管理生产环境数据目录
- 为 Prisma 配置正确的二进制引擎路径

## Impact

### 影响的规范（Affected Specs）
- 本提案为**评测报告**，不修改现有规范，但为后续实施提供依据
- 如需实施改进，将影响：
  - `specs/electron-packaging/` （需新建）- Electron 打包流程规范
  - `specs/backend-lifecycle/` （需新建）- 后端服务生命周期管理
  - `specs/database-configuration/` （需新建）- 生产环境数据库配置

### 影响的代码（Affected Code）
- `electron/main.ts` - 需添加后端启动逻辑
- `electron/package.json` - 需修改文件包含规则和依赖配置
- `electron/forge.config.js` - 需配置 extraResources
- `apps/backend/prisma/schema.prisma` - 需添加二进制目标配置
- `packages/infra/src/database/prisma-client.ts` - 需处理生产环境路径
- `apps/backend/src/config/env.ts` - 需添加生产环境默认值

### 风险评估
- **技术复杂度**：中等（需要理解 Electron 进程模型和 Prisma 打包机制）
- **测试工作量**：高（需要在 Windows/macOS/Linux 三平台测试打包结果）
- **回滚难度**：低（改动集中在 Electron 层，不影响业务逻辑）

### 工作量估算
- 评测已完成（本提案）
- 实施改进：3-5 个工作日
- 测试验证：2-3 个工作日
- 总计：**约 1 周**

## 下一步行动

### 决策点
1. **是否接受本评测结果**？
2. **是否授权创建实施提案**？（单独的 `add-electron-backend-integration` 变更）
3. **优先级排序**？（P0 问题必须解决，P1 问题可延迟）

### 推荐方案
✅ **短期**（1-2 周）：解决 P0 阻塞问题，实现基本的统一打包能力
🔄 **中期**（1 个月）：优化 P1 体验问题，添加自动更新、日志收集
🚀 **长期**（2-3 个月）：考虑更先进的方案（如 Tauri 迁移）

---

**评测结论**：当前项目 **不具备** 前后端统一打包的完整条件，但通过系统性改进（预计 1 周工作量），**可以实现**生产可用的打包能力。
