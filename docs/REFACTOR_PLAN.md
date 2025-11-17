# 重构工作清单

本清单整理了 Unified Holdings Tracker 重构的总体流程，可用于后续实施与验收参照。阶段可根据实际人力/优先级做微调，但建议遵循“先工具 → 后端 → 前端 → Electron → 质量保障”的顺序。

---

## 第 0 阶段：打基础 ✅
- ✅ 清理仓库：旧产物已移至 `docs/legacy-backend/`，完善了 `.gitignore`。
- ✅ 建立可运行基线：已验证 `backend`、`frontend`、`electron` 均可 `npm run build` 成功。
- ✅ 梳理需求与约束：离线/单机定位、功能诉求、数据安全等已明确。

### 基础需求梳理（结合当前讨论）
- **使用场景**：单人离线工具，仅在 Windows 桌面运行；投资组合按“年度”划分，每年一个独立组合。
- **数据管理**：
  - 所有历史记录永久保留，不允许删除。
  - 需要一个“生成 Markdown 备份/快照”的按钮，可在需要时手动导出；无需实时或自动导出。
  - 支持一次性批量导入交易/仓位数据（CSV/JSON 等），避免逐条录入。
- **功能目标**：本阶段只做架构升级，不扩展其他业务功能。
- **外部数据**：行情/汇率继续使用现有腾讯 API；批量导入按上文要求实现即可。
- **性能可靠性**：无严格指标，只需保持离线可用、体验流畅。
- **发布维护**：
  - 继续使用 Electron Forge + Inno Setup 打包。
  - 计划增加统一的构建/发布脚本（例如 `scripts/release.ps1`）来完成“清理 → 安装依赖 → 构建前后端 → Electron 打包 → 生成 changelog”的流水线，方便未来快速发布。

## 第 1 阶段：统一工具链与仓库结构 ✅
- ✅ 引入 workspace（npm workspaces），集中管理 `backend` / `frontend` / `electron`。
- ✅ 统一 TSConfig（`tsconfig.base.json`）、环境变量解析（Zod），并新增 `.env.example` & `frontend/.env.example`。
- ✅ 在 README 中补充根级脚本、环境配置方法，形成可运行基线。
- ✅ 集中 ESLint/Prettier config，已配置 commit hook（Husky）和 lint-staged。

## 第 2 阶段：后端分层与数据迁移 ✅
- ✅ 新目录划分：`apps/backend` 与 `packages/{domain,application,infra}`。
- ✅ 确立领域模型（Portfolio / Transaction / Asset / QuoteSnapshot），并通过 Prisma + SQLite schema 落地，新增相关环境变量与脚本。
- ✅ Prisma 存储层重构已完成并投入使用，详见 `docs/PRISMA_MIGRATION_COMPLETE.md`。
- 编写迁移脚本，把 `backend/data/*.json` 导入数据库并备份。
- ✅ 拆分业务逻辑：Controller、Use Case、Repository、外部适配器（行情、汇率）。
  - [x] `packages/domain`：落地 Portfolio / Transaction / Asset 等实体与值对象。
  - [x] `packages/domain/src/repositories`：定义 `PortfolioRepository`、`MarketDataProvider`、`FxRateProvider` 等接口。
  - [x] `packages/application/src/use-cases`：实现组合查询、交易写入、现金重算等 Use Case，并通过依赖注入绑定接口。
  - [x] `packages/infra`：提供 Prisma Repository、腾讯行情/汇率适配器、JSON 备份适配器等具体实现。
  - [x] `apps/backend/src`：新增依赖注入容器（`container.ts`），路由层重构为调用 Use Case，去除对旧 services 的直接依赖。
  - [x] 测试保障：创建测试脚本（`apps/backend/test-use-cases.ts`）验证关键 Use Case 行为，确保重构后行为与原实现一致。
- ✅ 增加 Jest + Supertest 测试、日志、错误处理、健康检查；生成 OpenAPI。

## 第 3 阶段：前端架构重塑
- 目录重排为 `src/app`, `src/features`, `src/shared`，`App.tsx` 只保留壳与路由。
- 引入 React Router + TanStack Query 管理数据生命周期，Zustand 仅保留 UI 状态。
- 拆分组件（容器 vs 展示），减少巨石组件；整理 localStorage/状态逻辑。
- 构建类型安全的 API SDK（OpenAPI 生成或手写 + Zod），统一请求/错误处理。
- 建立 Storybook/Vitest，完善组件与逻辑测试。

## 第 4 阶段：Electron 集成与打包
- 主进程托管后端服务（spawn + 进程监控），通过 preload 暴露安全 IPC。
- 更新构建链：`frontend build → electron/renderer`，`backend build → electron/backend`，最终 `electron make`。
- 增强错误提示（缺少 renderer/后端产物时告警），可选加入自动更新、单实例锁。

## 第 5 阶段：CI/CD 与质量保障
- 建立 CI（lint → test → build → pack），如 GitHub Actions。
- 添加 Playwright 等 E2E 测试覆盖核心流程。
- 记录 ADR、更新 README/开发手册，保持文档同步。
- 编写 `scripts/release.ps1` 或等效脚本：依次执行清理、安装依赖、统一构建、Electron 打包、生成 changelog，形成一键发布链路。

## 第 6 阶段：增量交付与验收
- 采用 feature branch + PR，按模块逐步合并，保持每阶段可运行。
- 每阶段完成后进行回归测试（功能 + 构建 + Electron 打包）。
- 新需求在重构后的架构上快速迭代（多账户、报表导出等）。

---

> **提示**：每阶段启动前确认上一阶段任务已通过构建、测试与文档验收，避免技术债在新架构中再次累积。
