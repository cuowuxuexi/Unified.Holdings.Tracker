# 实施任务清单

## 阶段 1：评测与分析（已完成）

- [x] 1.1 分析 Electron 打包配置完整性
  - 检查 `electron/package.json` 和 `forge.config.js`
  - 验证 ASAR、Makers、Fuses 配置
- [x] 1.2 评估前后端构建产物路径和集成
  - 检查前端构建输出路径（`frontend/dist` → `electron/renderer`）
  - 检查后端构建输出路径（`apps/backend/dist`）
  - 分析文件包含规则的有效性
- [x] 1.3 检查数据库和依赖的打包准备
  - 审查 Prisma schema 和客户端配置
  - 检查 SQLite 数据库路径配置
  - 分析 DataService 的路径解析逻辑
- [x] 1.4 识别打包阻塞问题和风险点
  - 标记 P0（必须解决）和 P1（影响体验）问题
  - 评估技术复杂度和工作量
- [x] 1.5 创建 OpenSpec 提案文档
  - 编写 `proposal.md`（评测结果和改进建议）
  - 编写 `tasks.md`（本文件）

## 阶段 2：问题详细文档化（可选，用于后续实施）

- [ ] 2.1 创建问题跟踪清单
  - 为每个 P0 问题创建详细的技术分析文档
  - 收集相关的 Electron/Prisma 官方文档链接
- [ ] 2.2 原型验证（建议在独立分支）
  - 创建最小化的 PoC 验证 `child_process.fork()` 启动后端
  - 测试 Prisma 引擎在 ASAR 归档后的加载
  - 验证 SQLite 数据库在用户数据目录的读写

## 阶段 3：实施改进（需单独创建变更提案）

**注意**：以下任务应在新的 OpenSpec 变更中实施（如 `add-electron-backend-integration`），而非本评测提案。

### 3.1 后端服务启动机制
- [ ] 3.1.1 在 `electron/main.ts` 添加 `startBackendService()` 函数
- [ ] 3.1.2 使用 `child_process.fork()` 启动后端服务
- [ ] 3.1.3 实现后端健康检查和自动重启逻辑
- [ ] 3.1.4 处理后端进程的生命周期（启动、关闭、错误处理）

### 3.2 依赖打包配置
- [ ] 3.2.1 修改 `electron/forge.config.js` 添加 `extraResources`
- [ ] 3.2.2 配置后端 `node_modules` 的选择性打包（仅包含生产依赖）
- [ ] 3.2.3 排除开发依赖和测试文件

### 3.3 Prisma 数据库配置
- [ ] 3.3.1 在 `schema.prisma` 添加二进制目标配置
  ```prisma
  generator client {
    provider = "prisma-client-js"
    binaryTargets = ["native", "windows", "darwin", "linux"]
  }
  ```
- [ ] 3.3.2 修改 Prisma Client 初始化，支持自定义引擎路径
- [ ] 3.3.3 配置生产环境的 SQLite 数据库路径（使用 `app.getPath('userData')`）

### 3.4 环境变量管理
- [ ] 3.4.1 创建生产环境配置文件（`electron/resources/.env.production`）
- [ ] 3.4.2 修改 `env.ts` 支持从多个位置加载环境变量
- [ ] 3.4.3 为生产环境设置合理的默认值

### 3.5 数据目录路径修复
- [ ] 3.5.1 修改 `DataService` 检测打包环境（检查 `process.resourcesPath`）
- [ ] 3.5.2 使用 Electron 的 `app.getPath('userData')` 作为生产环境数据目录
- [ ] 3.5.3 添加数据迁移逻辑（从旧路径迁移到新路径）

## 阶段 4：测试与验证

- [ ] 4.1 本地打包测试
  - [ ] 4.1.1 执行 `npm run build -w backend`
  - [ ] 4.1.2 执行 `npm run build -w frontend`
  - [ ] 4.1.3 执行 `npm run build:electron`
  - [ ] 4.1.4 执行 `npm run package -w electron`（Electron Forge package）
- [ ] 4.2 打包产物验证
  - [ ] 4.2.1 检查 `electron/out/` 目录结构
  - [ ] 4.2.2 验证后端 `node_modules` 已正确包含
  - [ ] 4.2.3 验证 Prisma 引擎文件存在
  - [ ] 4.2.4 验证前端静态资源完整
- [ ] 4.3 功能测试
  - [ ] 4.3.1 启动打包后的应用，验证后端服务自动启动
  - [ ] 4.3.2 测试数据库连接和数据持久化
  - [ ] 4.3.3 测试前后端 API 通信
  - [ ] 4.3.4 测试市场数据获取和缓存
- [ ] 4.4 跨平台测试
  - [ ] 4.4.1 Windows 平台打包和运行测试
  - [ ] 4.4.2 macOS 平台打包和运行测试（如可用）
  - [ ] 4.4.3 Linux 平台打包和运行测试（如可用）

## 阶段 5：文档更新

- [ ] 5.1 更新 README.md 的打包说明
- [ ] 5.2 创建打包故障排查文档（`docs/packaging-troubleshooting.md`）
- [ ] 5.3 更新 CLAUDE.md 中的打包流程说明
- [ ] 5.4 记录已知问题和限制

## 阶段 6：归档（实施完成后）

- [ ] 6.1 将本变更移动到 `openspec/changes/archive/`
- [ ] 6.2 创建相关的规范文档（如 `specs/electron-packaging/spec.md`）
- [ ] 6.3 运行 `openspec validate --strict` 确认无误

---

**当前状态**：阶段 1 已完成（评测）。等待决策是否进入阶段 2-6（实施改进）。
