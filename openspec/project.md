# Project Context

## Purpose

Unified Holdings Tracker 是一个桌面应用程序，用于跟踪和管理投资组合。它帮助用户记录和分析股票交易、资金流动、杠杆使用、分红收益等投资活动，并提供实时市场数据和投资报表。

**核心目标**：
- 提供全面的投资组合管理功能（A股、港股、美股）
- 记录交易历史和资金流动
- 计算持仓成本、收益率、年化收益等关键指标
- 展示实时市场行情和指数数据
- 支持杠杆融资管理和成本计算
- 生成投资报表和统计分析

## Tech Stack

### 桌面框架
- **Electron**: 跨平台桌面应用框架
- **Electron Forge**: 打包和分发工具
- **Inno Setup**: Windows 安装程序生成

### 前端
- **React 19**: UI 框架
- **TypeScript**: 类型安全的 JavaScript
- **Vite**: 构建工具和开发服务器
- **Ant Design**: UI 组件库
- **React Router**: 路由管理
- **Zustand**: 状态管理
- **TanStack Query (React Query)**: 数据获取和缓存
- **ECharts**: 图表可视化
- **dayjs**: 日期处理

### 后端
- **Node.js**: 运行时环境
- **Express 5**: Web 框架
- **TypeScript**: 类型安全
- **Prisma**: ORM 和数据库迁移工具
- **SQLite**: 嵌入式数据库
- **Zod**: 数据验证
- **Pino**: 日志记录
- **node-cache**: 内存缓存
- **axios**: HTTP 客户端（调用外部 API）
- **csv-parse & xlsx**: 文件解析（批量导入）
- **multer**: 文件上传处理

### 开发工具
- **npm workspaces**: Monorepo 管理
- **ESLint**: 代码检查
- **Prettier**: 代码格式化
- **Husky + lint-staged**: Git hooks
- **Jest & Vitest**: 单元测试
- **ts-node-dev**: 开发时热重载

## Project Conventions

### Code Style
- **语言**: 所有代码、注释、文档使用**简体中文**（除了代码标识符、API 名称等保持英文）
- **格式化**: 使用 Prettier，配置在根目录
- **Linting**: 使用 ESLint + TypeScript ESLint，配置在 `eslint.config.mjs`
- **命名规范**:
  - 文件名: kebab-case (如 `batch-import.ts`)
  - 组件: PascalCase (如 `PortfolioList.tsx`)
  - 变量/函数: camelCase (如 `getPortfolios`)
  - 类型/接口: PascalCase (如 `Portfolio`, `TransactionType`)
  - 常量: UPPER_SNAKE_CASE (如 `API_BASE_PATH`)
- **提交规范**: 遵循 Git Hooks，提交前自动 lint 和格式化

### Architecture Patterns

**Monorepo 结构**:
```
apps/backend/       # 后端 Express 服务
frontend/           # 前端 React 应用
electron/           # Electron 主进程
packages/           # 共享包（domain, application, infra - 预留）
```

**后端架构**:
- **分层设计**: Routes → Services → Storage (Prisma)
- **依赖注入**: 使用 `container.ts` 管理服务依赖
- **数据存储**: Prisma ORM + SQLite
- **API 设计**: RESTful API，OpenAPI 文档自动生成
- **缓存策略**: node-cache 用于市场数据缓存
- **错误处理**: 统一错误处理中间件

**前端架构**:
- **功能模块化**: features/ 目录按功能组织（portfolio, transaction, market）
- **组件分层**: pages → components → hooks
- **状态管理**: Zustand (全局) + React Query (服务端状态)
- **API 调用**: 使用 @hey-api/openapi-ts 从 OpenAPI 生成类型安全的客户端
- **样式**: CSS Modules + Ant Design 主题定制

**数据模型**:
- `Portfolio`: 投资组合（现金、杠杆额度等）
- `Asset`: 资产（股票代码、市场）
- `Transaction`: 交易记录（买卖、入金、出金、杠杆、分红）
- `QuoteSnapshot`: 行情快照（实时价格、涨跌幅等）

### Testing Strategy

**后端测试**:
- 使用 Jest
- 单元测试覆盖关键服务（如 `batchImportService`, `calculationService`, `cacheService`）
- 测试文件位于 `apps/backend/src/services/__tests__/`
- 运行: `npm run test:backend`

**前端测试**:
- 使用 Vitest + Testing Library
- 组件测试位于 `frontend/src/components/__tests__/`
- 运行: `npm run test -w frontend`

**测试原则**:
- 优先测试业务逻辑和数据处理
- 关键功能必须有测试覆盖（如批量导入、计算服务）
- 边界情况和错误处理必须测试

### Git Workflow

- **分支策略**: 主分支为 `main`，功能开发在独立分支
- **提交规范**: 使用 Husky + lint-staged 自动检查
- **代码审查**: 提交前确保通过 ESLint 和 Prettier 检查
- **部署**: 通过 Electron Forge 打包为桌面应用

## Domain Context

**投资组合管理领域知识**:

1. **市场类型**:
   - CN (A股): 上海证券交易所 (sh) 和深圳证券交易所 (sz)
   - HK (港股): 香港交易所
   - US (美股): 美国交易所

2. **交易类型**:
   - `BUY`: 买入股票
   - `SELL`: 卖出股票
   - `DEPOSIT`: 入金（增加现金）
   - `WITHDRAW`: 出金（减少现金）
   - `LEVERAGE_ADD`: 增加杠杆额度
   - `LEVERAGE_REMOVE`: 减少杠杆额度
   - `LEVERAGE_COST`: 杠杆利息成本
   - `DIVIDEND`: 股息分红

3. **关键指标**:
   - 持仓成本: 考虑买入价格、手续费、杠杆使用
   - 收益率: (当前市值 - 成本) / 成本
   - 年化收益率: 考虑持有时间的收益率
   - 杠杆使用率: 已用杠杆 / 总杠杆额度

4. **货币和汇率**:
   - 支持 CNY、USD、HKD
   - 所有金额统一转换为 CNY 计算
   - 汇率数据从外部 API 获取并缓存

5. **数据精度**:
   - 使用 Prisma `Decimal` 类型确保财务数据精度
   - 避免浮点数精度问题

## Important Constraints

1. **数据精度要求**: 财务数据必须使用 `Decimal` 类型，不能使用 `Float`
2. **数据库**: 仅支持 SQLite（嵌入式，适合桌面应用）
3. **平台**: 主要支持 Windows（通过 Inno Setup 打包）
4. **网络依赖**: 市场数据依赖外部 API，需处理网络失败情况
5. **文件大小**: 批量导入 CSV 文件限制 10MB
6. **编码格式**: CSV 文件必须使用 UTF-8 编码
7. **环境变量**: 通过 `.env` 文件配置，不提交到版本控制

## External Dependencies

1. **腾讯财经 API**: 获取实时股票行情和市场指数数据
   - 使用 `tencentApi.ts` 封装
   - 实现缓存机制减少 API 调用
   
2. **汇率 API**: 获取实时汇率数据（CNY/USD/HKD）
   - 使用 `currencyService.ts` 管理
   - 定期更新和缓存

3. **Prisma**: 数据库 ORM
   - Schema 定义在 `apps/backend/prisma/schema.prisma`
   - 数据库文件: `apps/backend/data/portfolio.db`

4. **OpenAPI 规范**: 
   - 后端生成 OpenAPI 文档 (`/api/openapi.json`)
   - 前端使用 `@hey-api/openapi-ts` 生成类型安全的客户端代码

## Development Workflow

- **Monorepo 管理**: 通过 npm workspaces 统一安装依赖 (`npm install`)，常用脚本集中在根 `package.json`。
- **并行开发体验**: `npm run dev` 使用 `concurrently` 同时启动后端与前端；`npm run electron-dev` 再加上 Electron 主进程与 `wait-on`。
- **独立工作区脚本**:
  - 后端：`npm run dev -w backend`、`npm run build -w backend`、`npm run test -w backend`
  - 前端：`npm run dev -w frontend`、`npm run build -w frontend`、`npm run test -w frontend`
  - Electron：`npm run watch:electron`（tsc watch）、`npm run start:electron`（连接到 dev server）、`npm run build:electron`
- **质量保障**: `npm run lint`、`npm run lint:fix`、`npm run format:check`、`npm run test:backend`；前端测试走 `npm run test -w frontend`。
- **缓存清理**: `npm run clean` 会移除构建产物、`.vite` 缓存及 `.tsbuildinfo`，必要时可使用 `npm run clean:cache` 单独清理前端构建缓存。

## Environment & Configuration

- **环境变量模板**: 根目录 `.env.example`、前端 `frontend/.env.example`，需复制为 `.env` / `frontend/.env`。
- **关键变量**:
  - `PORT`、`API_BASE_PATH`、`FRONTEND_URL`
  - `DATABASE_URL`（默认 `file:./apps/backend/data/portfolio.db`）
  - `VITE_API_BASE_URL`（前端访问后端的基础路径）
- **Windows 优化**: `setup.iss`、`electron/launcher/` 提供安装器与本地服务启动脚本，保证桌面端一键部署体验。

## Build & Release Process

1. **预构建**: 先分别执行 `npm run build -w backend`、`npm run build -w frontend`，确保 Electron 可打包最新产物（renderer 将拷贝到 `electron/renderer`，后端落在 `electron/backend`）。
2. **Electron Forge**: 通过 `npm run build:electron`（tsc）后，使用 `npm run package -w electron` 或 `npm run make -w electron` 生成平台对应包；`electron/package.json` 的 `build.files` 自动包含前端与后端 dist。
3. **安装包**: Windows 通过 Inno Setup (`setup.iss`) 生成 `.exe` 安装器；Electron Forge `make` 也配置了 `squirrel`、`zip`、`deb`、`rpm`、`AppImage` 等产物，方便多平台发布。
4. **Release 流程**: 发布到 GitHub Releases（或内部渠道），向用户提供安装包；安装器会把后端、前端与 Electron 主进程一起部署并创建桌面快捷方式。

## Documentation Map

- `docs/notes/`：方案、阶段性准备（如 `STAGE_3_READINESS.md`、`注意信息模块优化步骤预案.md`）。
- `docs/reports/`：历史投资报表、阶段总结。
- `HOW_TO_USE_NOW.md`、`开发模式使用指南.md`：面向开发/运维的即时说明。
- `CLEAR_CACHE_AND_RESTART.md`、`RESTART_INSTRUCTIONS.md`：常见维护操作。
- OpenSpec 文档集中在 `openspec/`，`specs/` 为基准规范，`changes/` 记录进行中的提案。

## Data Management & Migration

- **Prisma CLI**:
  - `npm run prisma:generate -w backend`：生成 Prisma Client
  - `npm run prisma:migrate -w backend`：开发环境迁移
  - `npm run prisma:deploy -w backend`：部署环境应用迁移
  - `npm run db:push -w backend`：将 schema 推送到 SQLite
- **数据导入**: `npm run migrate:json -w backend` 将 `apps/backend/data/` 下的 JSON 数据转换为 SQLite。
- **批量导入工具**: `batch_import_template.xlsx`、`test-batch-import-api.js` 等脚本帮助验证批量导入流程。
