[根目录](../../CLAUDE.md) > [apps](../) > **backend**

---

# Backend 模块文档

> 最后更新：2025-11-16 08:55:50

## 变更记录 (Changelog)

### 2025-11-16
- 初始化模块文档

---

## 模块职责

Backend 是基于 Express 5 和 TypeScript 构建的 RESTful API 服务器，负责：

- 提供投资组合管理 API（创建、查询、更新）
- 提供交易记录 API（买入、卖出、存取款、杠杆操作、分红）
- 提供市场数据 API（实时行情、历史数据）
- 批量导入功能（CSV/Excel 批量导入交易）
- 数据持久化（SQLite + Prisma ORM）
- 缓存管理（内存缓存市场数据）
- 汇率服务（USD-CNY、HKD-CNY 汇率获取）

---

## 入口与启动

### 主入口
- **文件**：`src/server.ts`
- **端口**：默认 3001（通过环境变量 `PORT` 配置）
- **API 前缀**：`/api`（通过环境变量 `API_BASE_PATH` 配置）

### 启动流程
1. 加载环境变量（`.env` 或 `apps/backend/.env`）
2. 初始化 Express 应用
3. 配置 CORS、JSON 解析、请求日志中间件
4. 初始化汇率服务（从 Frankfurter API 获取汇率）
5. 挂载路由：
   - `/api/market` → `routes/marketData.ts`
   - `/api/portfolio` → `routes/portfolio.ts`
   - `/api/batch` → `routes/batch.ts`
6. 启动监听（默认 `http://localhost:3001`）

### 启动命令
```bash
# 开发模式（自动重启）
npm run dev

# 生产模式构建
npm run build

# 生产模式运行
npm start
```

---

## 对外接口

### 核心 API 端点

#### 1. Portfolio API (`/api/portfolio`)
- `GET /api/portfolio` - 获取所有投资组合列表
- `GET /api/portfolio/:id` - 获取单个投资组合详情（含持仓、交易）
- `POST /api/portfolio` - 创建新投资组合
- `PATCH /api/portfolio/:id/attention` - 更新组合备注信息
- `POST /api/portfolio/:id/transaction` - 添加交易记录
- `DELETE /api/portfolio/:id/transaction/:txId` - 删除交易记录
- `PATCH /api/portfolio/:id/transaction/:txId/notes` - 更新交易备注
- `POST /api/portfolio/:id/recalculate-cash` - 重新计算现金余额

#### 2. Market Data API (`/api/market`)
- `GET /api/market/quote/:code` - 获取单只股票实时行情
- `POST /api/market/batch-quote` - 批量获取多只股票行情
- `GET /api/market/indices` - 获取市场指数（沪深300、上证、恒指、纳指等）

#### 3. Batch Import API (`/api/batch`)
- `POST /api/batch/import` - 批量导入交易记录（CSV/Excel）

#### 4. Health & Docs
- `GET /` - 健康检查（简单欢迎信息）
- `GET /api/health` - 详细健康检查（包括数据库连接状态）
- `GET /api/openapi.json` - OpenAPI 规范文档

### 数据模型（Prisma Schema）
见 `prisma/schema.prisma`：
- **Portfolio**：投资组合（含现金、杠杆信息）
- **Transaction**：交易记录（类型：BUY, SELL, DEPOSIT, WITHDRAW, LEVERAGE_ADD, LEVERAGE_REMOVE, LEVERAGE_COST, DIVIDEND）
- **Asset**：资产（股票代码、名称、市场）
- **QuoteSnapshot**：行情快照（价格、涨跌幅、成交量等）

---

## 关键依赖与配置

### 主要依赖
- **express** ^5.1.0 - Web 框架
- **@prisma/client** ^6.19.0 - ORM 数据库客户端
- **axios** ^1.8.4 - HTTP 请求（调用腾讯行情 API）
- **node-cache** ^5.1.2 - 内存缓存
- **cors** ^2.8.5 - 跨域支持
- **zod** ^4.1.12 - 数据验证
- **date-fns** ^4.1.0 - 日期处理
- **pino** ^9.5.0 - 高性能日志

### 环境变量
在根目录或 `apps/backend/` 下创建 `.env` 文件：
```bash
# 数据库连接（SQLite）
DATABASE_URL="file:./prisma/data/portfolio.db"

# 服务器配置
PORT=3001
FRONTEND_URL=http://localhost:5173
API_BASE_PATH=/api

# Node 环境
NODE_ENV=development
```

### TypeScript 配置
- **tsconfig.json**：继承自根目录 `tsconfig.base.json`
- **tsconfig.scripts.json**：用于脚本文件（如迁移脚本）

---

## 数据模型

### Prisma Schema 核心表

#### Portfolio（投资组合）
```prisma
model Portfolio {
  id                       String        @id @default(uuid())
  name                     String
  initialCash              Decimal
  cash                     Decimal
  leverageTotalAmount      Decimal
  leverageUsedAmount       Decimal
  leverageAvailableAmount  Decimal
  leverageCostRate         Decimal
  attentionInfo            String?
  transactions             Transaction[]
  createdAt                DateTime      @default(now())
  updatedAt                DateTime      @updatedAt
}
```

#### Transaction（交易记录）
```prisma
model Transaction {
  id            String          @id @default(uuid())
  portfolioId   String
  type          TransactionType
  date          DateTime
  assetCode     String?
  quantity      Decimal?
  price         Decimal?
  amount        Decimal?
  commission    Decimal?
  leverageUsed  Decimal?
  currency      String          @default("CNY")
  exchangeRate  Decimal?
  notes         String?
  // ... 关联字段
}
```

#### Asset（资产）
```prisma
model Asset {
  code        String          @id
  name        String
  market      Market  # CN / HK / US
  // ... 关联字段
}
```

---

## 测试与质量

### 测试框架
- **Jest** ^29.7.0 + **ts-jest** ^29.3.2
- **Supertest** ^7.0.0（HTTP 测试）

### 测试文件
位于 `src/services/__tests__/`：
- `cacheService.test.ts` - 缓存服务测试
- `cacheValidationService.test.ts` - 缓存验证测试
- `tencentApi.test.ts` - 腾讯 API 调用测试
- `cachePerformance.test.ts` - 缓存性能测试

### 运行测试
```bash
npm run test
```

### 代码质量工具
- **ESLint**：`npm run lint`（根目录执行）
- **Prettier**：`npm run format`（根目录执行）

---

## 常见问题 (FAQ)

### Q1: 如何切换数据库？
A: 修改 `.env` 中的 `DATABASE_URL`，然后运行：
```bash
npm run db:push -w backend
```

### Q2: 如何添加新的 API 端点？
A:
1. 在 `src/routes/` 中添加路由
2. 在 `src/services/` 中实现业务逻辑（或调用 `packages/application` 的用例）
3. 更新 `src/openapi.ts` 中的 OpenAPI 文档

### Q3: 市场数据从哪里获取？
A: 使用腾讯财经 API（`src/services/tencentApi.ts`），数据缓存 5 分钟。

### Q4: 如何从旧 JSON 数据迁移？
A: 运行迁移脚本：
```bash
npm run migrate:json -w backend
```

---

## 相关文件清单

### 核心源码
```
src/
├── config/
│   └── env.ts                   # 环境变量配置
├── lib/
│   └── prisma.ts                # Prisma 客户端单例
├── routes/
│   ├── batch.ts                 # 批量导入路由
│   ├── marketData.ts            # 市场数据路由
│   └── portfolio.ts             # 投资组合路由
├── services/
│   ├── cacheService.ts          # 缓存服务
│   ├── cacheValidationService.ts# 缓存验证
│   ├── currencyService.ts       # 汇率服务
│   ├── dataService.ts           # 数据服务
│   ├── storage.prisma.ts        # Prisma 存储实现
│   ├── tencentApi.ts            # 腾讯 API 客户端
│   └── __tests__/               # 测试文件
├── types/
│   └── batch.ts                 # 批量导入类型定义
├── container.ts                 # DI 容器
├── openapi.ts                   # OpenAPI 规范定义
└── server.ts                    # 服务器入口
```

### 配置文件
- `prisma/schema.prisma` - Prisma 数据库 schema
- `jest.config.js` - Jest 测试配置
- `tsconfig.json` / `tsconfig.scripts.json` - TypeScript 配置

### 数据目录
- `prisma/data/portfolio.db` - SQLite 数据库文件（gitignore）
- `data/` - 旧版 JSON 数据（已废弃）

---

## 架构图

```
┌─────────────────────────────────────────┐
│         Express Application             │
├─────────────────────────────────────────┤
│  Middleware: CORS, JSON Parser, Logger  │
├─────────────────────────────────────────┤
│              Routes Layer               │
│  ┌──────────┬──────────┬──────────┐    │
│  │Portfolio │ Market   │  Batch   │    │
│  │  Router  │ Router   │  Router  │    │
│  └─────┬────┴────┬─────┴─────┬────┘    │
├────────┼─────────┼───────────┼─────────┤
│        │   Services Layer     │         │
│  ┌─────▼────┬────▼─────┬─────▼────┐   │
│  │ Storage  │ Tencent  │  Cache   │   │
│  │ (Prisma) │   API    │ Service  │   │
│  └─────┬────┴────┬─────┴─────┬────┘   │
├────────┼─────────┼───────────┼─────────┤
│        │  Infrastructure      │         │
│  ┌─────▼─────────▼───────────▼────┐   │
│  │   SQLite DB  │  External APIs  │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```
