# Change: migrate-electron-to-tauri（Electron 迁移到 Tauri）

## Why

当前桌面应用基于 Electron + Electron Forge：

- 打包链路复杂：需要同时协调 Electron、前端构建、Node 后端、Prisma/SQLite 等多个部分，评测结果显示前后端统一打包存在多个 P0 阻塞（参考 `evaluate-electron-packaging` 变更）。
- 体积与性能开销较大：Electron 内置完整 Chromium 与 Node 运行时，安装包与运行时内存占用都偏高。
- 安全边界粗粒度：主进程 + 渲染进程都运行在 Node 环境下，虽然可以通过配置收紧能力，但默认攻击面较大。

Tauri 提供了一个潜在更优的长期方案：

- 使用系统自带 WebView，显著减小安装包体积和内存占用。
- 后端逻辑运行在 Rust 侧（或通过受控命令桥接 Node 服务），安全边界更清晰。
- 更贴近原生的系统集成能力（系统托盘、通知、自动更新等有成熟生态）。

出于风险控制，本变更聚焦于**桌面壳层从 Electron 迁移到 Tauri**，在第一阶段尽量保持业务层（前端 React、后端 Node/Prisma）不做大改动，仅调整接入与打包方式。

## What Changes

本变更计划分阶段完成从 Electron 到 Tauri 的迁移。

### 1. 目标架构（第一阶段）

- 桌面壳层：由 Electron 切换为 Tauri（Rust + 系统 WebView）。
- 前端：继续使用现有 React + Vite 构建产物，作为 Tauri WebView 的前端资源。
- 后端：
  - 第一阶段继续复用现有 Node + Express + Prisma + SQLite 服务。
  - 由 Tauri 在应用启动时通过受控方式启动/管理后端进程（类似当前 Electron 计划中的 `startBackendService`）。
- 打包与发布：
  - 使用 Tauri bundler 产出 Windows/macOS/Linux 平台可安装包。
  - 安装包中包含前端静态资源、后端 Node 运行时与必要依赖（Prisma 引擎、SQLite 数据文件）。

### 2. 主要变更内容

1. **新增 Tauri 桌面工程**
   - 在 monorepo 中新增 `apps/desktop-tauri`（命名待确认），作为 Tauri 主工程。
   - 配置 Tauri 对应的 Rust 项目结构与前端资源目录（指向现有 `frontend` 构建输出）。
2. **后端进程管理迁移**
   - 在 Tauri 侧实现后端服务启动/停止逻辑：
     - 启动应用时启动 Node 后端（如通过命令或脚本）。
     - 应用退出时优雅关闭后端进程。
   - 确保 API 访问路径在 Tauri 环境下与现有前端代码兼容（`FRONTEND_URL`、`API_BASE_PATH` 等配置需统一）。
3. **数据与配置路径规范化**
   - 在 Tauri 中使用适当的应用数据目录（如 `app_dir` 或 `config_dir`），替代 Electron 中 `app.getPath('userData')` 的语义。
   - 约定 SQLite 数据文件、日志、导入/导出文件在各平台的数据目录布局，并与现有 `DataService` 等实现对齐或适配。
4. **打包配置与 CI 集成**
   - 为 Windows/macOS/Linux 配置 Tauri 打包目标。
   - 在现有 CI/CD 流水线中增加 Tauri 构建与发布步骤（至少本地脚本级别）。
5. **迁移策略**
   - 第一阶段保留 Electron 工程，Tauri 与 Electron 并行存在一段时间，支持灰度验证。
   - 当 Tauri 版本覆盖核心功能并通过回归测试后，再评估是否在后续变更中移除 Electron 工程。

### 3. 非目标（本变更暂不包含）

- 不在本变更中重写 Node/Express/Prisma 到 Rust（如 Axum/SQLx），如需要将通过后续独立变更规划。
- 不改变现有前端路由与主要 UI/交互，仅适配 Tauri 环境下的运行要求。
- 不在本变更中引入自动更新、崩溃上报等能力（可以在 Tauri 稳定后作为单独能力规划）。

## Impact

### 影响的规范（Affected Specs）

本变更将为桌面打包与壳层引入新的长期规范：

- `specs/electron-packaging/spec.md`
  - **ADDED / MODIFIED Requirements**：从 Electron 打包规范演进为更通用的“桌面应用打包规范”，新增对 Tauri 打包与运行时要求的描述。

后续如有需要，可在独立变更中补充：

- `specs/backend-lifecycle/spec.md`
  - 描述桌面应用启动时对后端服务的期望：启动方式、重试策略、健康检查。
- `specs/database-configuration/spec.md`
  - 描述 SQLite 数据路径、迁移策略与跨平台约束（Electron 与 Tauri 下应保持一致的行为）。

### 影响的代码（Affected Code）

新建：

- `apps/desktop-tauri/`（命名示例，实际可视团队习惯调整）
  - Tauri Rust 项目（`src-tauri`）
  - Tauri 配置文件（`tauri.conf.json` 或 `tauri.conf.toml`）

调整/适配：

- `frontend/`：
  - 构建产物输出路径与 Tauri 集成配置。
  - 某些直接依赖 `window.location` 或特定端口的逻辑需要适配。
- `apps/backend/`：
  - `env.ts` 中对 `FRONTEND_URL`、`DATABASE_URL` 的默认值与部署策略。
  - 启动脚本与端口配置，确保在 Tauri 打包环境中可执行。
- `packages/infra/src/data/data-service.ts`：
  - 数据目录路径解析逻辑需兼容 Tauri 使用的应用数据目录。

Electron 相关代码：

- `electron/` 目录在本变更中保留，作为对照与回退方案；是否删除将在后续变更中依据 Tauri 稳定性与团队决策进行。

### 风险评估

- **技术栈引入风险**：引入 Rust + Tauri，新工具链与生态需要学习成本。
- **跨平台一致性风险**：Tauri 在不同平台使用系统 WebView，可能出现渲染/行为差异，需要额外测试。
- **打包复杂度**：第一阶段继续包含 Node 后端与 Prisma，引擎文件与运行时配置在 Tauri 包内需要谨慎处理。
- **调试复杂度**：调试路径从“Electron + Node”变为“Rust（Tauri）+ Node + 浏览器 DevTools”，需要规范化调试与日志方案。

### 工作量估算（2–3 个月）

- 技术调研与 PoC：1–2 周（熟悉 Tauri、验证前端集成与后端进程管理可行性）。
- 第一版 Tauri 壳层 + Node 后端集成：3–4 周。
- 打包链路与 CI 集成：1–2 周。
- 跨平台测试与灰度迁移：2–4 周。

## Open Questions

在进一步细化设计与实施前，需要确认/决策的问题：

1. **Node 后端定位**：短期内是否继续使用 Node 作为唯一业务后端？是否有中长期将核心计算迁移到 Rust 的规划？
2. **数据迁移策略**：现有 Electron 打包后的数据目录与 Tauri 使用的数据目录之间，是否需要自动迁移脚本？支持哪些场景的无损迁移？
3. **平台优先级**：Tauri 初期是否以 Windows 为主，macOS/Linux 作为“尽力支持”？还是三平台同时作为一等公民？
4. **发布与回退策略**：是否支持同时分发 Electron 与 Tauri 两个版本的安装包，用于灰度与回退？

## 下一步行动

1. 评审并确认本变更的范围与目标（仅迁移桌面壳层，复用现有前后端业务逻辑）。
2. 在 `openspec/changes/migrate-electron-to-tauri/tasks.md` 中细化实施任务与阶段划分。
3. 基于本提案与 `evaluate-electron-packaging` 结果，补充/新增相关 spec delta，并运行 `openspec validate migrate-electron-to-tauri --strict`，在实施前确保规范完整、一致。

