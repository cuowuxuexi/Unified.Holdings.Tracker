# UHT — Unified Holdings Tracker 功能说明书

> **版本**：v2.1（含快照增强）  
> **项目定位**：A股、港股、美股三市统一仓位风险管理系统  
> **技术架构**：DDD 三层架构 + React 前端 + Electron 桌面端

---

## 一、系统概览

UHT 是一个面向个人投资者的跨市场仓位管理工具，支持同时管理 A 股、港股和美股资产，覆盖从交易记录录入、实时行情展示、收益计算到定期报表生成的完整投资管理流程。

### 架构总览

```
┌──────────────────────────────────────────────────────┐
│                    用户界面层                          │
│  ├── React 前端 (Vite + Ant Design + ECharts)         │
│  └── Electron 桌面应用                                │
└──────────────────────┬───────────────────────────────┘
                       │ HTTP API
┌──────────────────────▼───────────────────────────────┐
│                 后端服务层 (Express)                    │
│  ├── portfolio 路由 — 组合/交易/统计/报表               │
│  ├── batch 路由     — 批量导入                         │
│  ├── market 路由    — 实时行情/K线                      │
│  └── archive 路由   — 存档/备份/恢复                    │
├──────────────────────────────────────────────────────┤
│                 核心服务层                              │
│  ├── portfolioStatsService — 统计计算引擎              │
│  ├── snapshotService       — 每日快照采集与调度         │
│  ├── periodReportService   — 期间报表生成              │
│  ├── reportService         — Markdown 报表导出         │
│  ├── batchImportService    — CSV/Excel 批量导入        │
│  ├── tencentApi            — 腾讯金融行情数据源         │
│  ├── currencyService       — 汇率服务 (USD/HKD→CNY)    │
│  ├── calculationService    — 净值/收益率/成本计算       │
│  ├── archiveService        — 年度存档                  │
│  ├── backupService         — 即时备份/恢复              │
│  └── cacheService          — 智能缓存 (node-cache)     │
├──────────────────────────────────────────────────────┤
│                 数据持久层                              │
│  └── SQLite (via Prisma ORM)                          │
└──────────────────────────────────────────────────────┘
```

### 支持市场

| 市场 | 前缀        | 示例代码               | 币种 |
| ---- | ----------- | ---------------------- | ---- |
| A 股 | `sh` / `sz` | `sh600519`（贵州茅台） | CNY  |
| 港股 | `hk`        | `hk00700`（腾讯控股）  | HKD  |
| 美股 | `us`        | `usPDD`（拼多多）      | USD  |

---

## 二、核心功能模块

### 2.1 投资组合管理

#### 创建与配置

- 支持创建多个独立投资组合
- 每个组合包含：初始现金、杠杆额度（总额、已用、可用、利率）
- 支持设置关注标记（attentionInfo）

#### 交易记录

支持 8 种交易类型：

| 类型              | 说明         |
| ----------------- | ------------ |
| `BUY`             | 买入股票     |
| `SELL`            | 卖出股票     |
| `DEPOSIT`         | 入金         |
| `WITHDRAW`        | 出金         |
| `LEVERAGE_ADD`    | 增加融资额度 |
| `LEVERAGE_REMOVE` | 减少融资额度 |
| `LEVERAGE_COST`   | 融资利息支出 |
| `DIVIDEND`        | 股息分红     |

每笔交易记录包含：日期、类型、股票代码、数量、价格、金额、手续费、币种、汇率、备注。

#### 批量导入

- 支持 CSV 和 Excel (XLSX) 格式上传
- 提供模板下载（含示例数据）
- 导入前预览（Preview）：解析验证不入库
- 导入时自动推断币种和汇率
- 支持部分成功（207 状态码）

### 2.2 实时行情

#### 股票报价

- 数据源：腾讯金融 API
- 实时获取：最新价、涨跌额、涨跌幅、成交量、换手率、市盈率等
- 支持批量查询多只股票

#### K 线数据

- 支持日线、周线、月线
- 支持前复权（qfq）、后复权（hfq）
- 可指定起止日期范围

#### 汇率服务

- 实时获取 USD/CNY、HKD/CNY 汇率
- 所有非 CNY 资产自动按汇率折算为人民币市值

### 2.3 统计计算引擎

#### 组合级统计

| 指标       | 说明                                   |
| ---------- | -------------------------------------- |
| 总市值     | 所有持仓按最新价计算的 CNY 市值之和    |
| 总资产     | 总市值 + 现金                          |
| 净资产     | 总资产 - 融资负债                      |
| 累计盈亏   | 总资产 - 净入金 - 融资利息             |
| 当日盈亏   | 当日市值变化（与前一交易日收盘价比较） |
| 已实现盈亏 | 已卖出股票的盈亏                       |
| 未实现盈亏 | 当前持仓的浮动盈亏                     |
| 总手续费   | 所有交易的手续费累计                   |
| 融资成本   | 所有 LEVERAGE_COST 交易累计            |

#### 个股级统计

- 持仓数量、成本价、当前价
- 当日涨跌（金额和百分比）
- 周度/月度/年度涨跌幅
- 个股盈亏金额和比例

#### 周期收益计算

- 支持周度、月度、年度收益率
- 采用修正 Dietz 法（Modified Dietz Method）精确计算
- 考虑期间现金流（入金/出金）的时间加权影响

### 2.4 每日快照系统

#### 采集机制

| 时间（北京） | 任务     | 说明                                          |
| ------------ | -------- | --------------------------------------------- |
| 06:30        | 定量采集 | 周二到周六，采集前一交易日三市收盘数据        |
| 08:00        | 复测校验 | 检查 06:30 数据是否到位，缺失则自动补采并告警 |

#### 存储内容

**组合级快照（PortfolioSnapshot）**：

- 总市值、净资产、累计盈亏、当日盈亏、现金

**个股级快照（PositionSnapshot）**：

- 股票代码、持仓数量、收盘价（原币种）、市值（CNY 含汇率）

#### 数据特性

- 幂等写入：同一组合同一天的快照可重复采集，自动覆盖
- 日期标记为"前一天"，因为采集发生在次日早晨
- 支持手动触发补采

#### 告警机制

- 采集失败或复测缺失时，通过 Webhook 发送 POST 告警
- 告警 URL 通过环境变量 `SNAPSHOT_ALERT_WEBHOOK` 配置

### 2.5 期间报表系统

#### 通用查询

单一接口支持任意时间段报表：日报、周报、月报、季报、年报——只需传入起止日期。

#### 报表内容

| 板块       | 说明                                                      |
| ---------- | --------------------------------------------------------- |
| 组合概览   | 期初/期末净资产、期间盈亏、收益率                         |
| 费用汇总   | 手续费总计、融资利息总计                                  |
| 持仓明细   | 按 A 股/港股/美股分组，含期初价、期末价、涨跌幅、期间盈亏 |
| 盈亏排名   | 所有股票按期间盈亏从高到低排序                            |
| 已清仓标注 | 期末持仓为 0 的股票单独标记                               |

#### 输出格式

- **JSON**：结构化数据，适合程序消费
- **Markdown**：格式化表格，适合直接阅读或推送

### 2.6 存档与备份

#### 年度存档（Archive）

- 创建指定年份的投资组合存档
- 可选包含持仓快照和统计数据
- 支持列表查询、下载、删除

#### 即时备份（Backup）

- 创建当前时刻的组合完整备份
- 包括组合配置、所有交易记录、资产信息
- 支持从备份恢复（可恢复到原组合或创建新组合）

### 2.7 报表导出

- 实时 Markdown 报表导出（含持仓详情、收益统计、周/月/年期间表现）
- 下载为 `.md` 文件
- 报表中按市场分组展示，原币种价格 + CNY 市值

---

## 三、完整 API 接口清单

### 3.1 组合管理（`/api/portfolio`）

| 方法     | 路径   | 说明                         |
| -------- | ------ | ---------------------------- |
| `GET`    | `/`    | 获取所有组合列表             |
| `POST`   | `/`    | 创建新组合                   |
| `GET`    | `/:id` | 获取组合详情（含持仓和统计） |
| `DELETE` | `/:id` | 删除组合                     |

### 3.2 交易记录（`/api/portfolio/:id`）

| 方法     | 路径                            | 说明                   |
| -------- | ------------------------------- | ---------------------- |
| `GET`    | `/:id/transactions`             | 获取组合的所有交易记录 |
| `POST`   | `/:id/transactions`             | 添加交易记录           |
| `DELETE` | `/:id/transactions/:txId`       | 删除交易记录           |
| `PATCH`  | `/:id/transactions/:txId/notes` | 更新交易备注           |

### 3.3 统计与分析（`/api/portfolio/:id`）

| 方法   | 路径                       | 说明                                                   |
| ------ | -------------------------- | ------------------------------------------------------ |
| `GET`  | `/:id/stats?period=weekly` | 获取组合统计（支持 daily/weekly/monthly/yearly/total） |
| `POST` | `/:id/cash-recalc`         | 现金一致性校验与重算                                   |

### 3.4 快照与报表（`/api/portfolio/:id`）

| 方法   | 路径                                   | 说明                                         |
| ------ | -------------------------------------- | -------------------------------------------- |
| `GET`  | `/:id/snapshots?from=&to=`             | 查询组合级快照历史                           |
| `POST` | `/:id/snapshots/trigger`               | 手动触发快照采集                             |
| `GET`  | `/:id/weekly-report?week=YYYY-WW`      | 获取周报（旧接口，兼容保留）                 |
| `GET`  | `/:id/period-report?from=&to=&format=` | **通用期间报表**（推荐，支持 json/markdown） |
| `GET`  | `/:id/export/markdown`                 | 导出实时 Markdown 完整报表                   |

### 3.5 存档与备份（`/api`）

| 方法     | 路径                               | 说明                 |
| -------- | ---------------------------------- | -------------------- |
| `POST`   | `/portfolio/:id/archive`           | 创建年度存档         |
| `GET`    | `/portfolio/:id/archives`          | 列出组合存档         |
| `GET`    | `/archive/:archiveId`              | 获取/下载存档        |
| `DELETE` | `/archive/:archiveId`              | 删除存档             |
| `POST`   | `/portfolio/:id/backup`            | 创建即时备份         |
| `GET`    | `/portfolio/:id/backups`           | 列出组合备份         |
| `POST`   | `/portfolio/:id/restore/:backupId` | 从备份恢复           |
| `GET`    | `/backups`                         | 列出所有备份（全局） |
| `POST`   | `/restore/:backupId`               | 全局恢复备份         |
| `GET`    | `/backup/:backupId`                | 获取/下载备份        |
| `DELETE` | `/backup/:backupId`                | 删除备份             |

### 3.6 批量导入（`/api/batch`）

| 方法   | 路径                         | 说明                   |
| ------ | ---------------------------- | ---------------------- |
| `GET`  | `/template?format=csv\|xlsx` | 下载导入模板           |
| `POST` | `/preview`                   | 上传文件预览（不入库） |
| `POST` | `/import/:portfolioId`       | 执行批量导入           |

### 3.7 市场数据（`/api/market`）

| 方法  | 路径                                       | 说明             |
| ----- | ------------------------------------------ | ---------------- |
| `GET` | `/quote?codes=sh600519,hk00700`            | 批量获取实时报价 |
| `GET` | `/kline?code=&period=&startDate=&endDate=` | 获取 K 线数据    |

### 3.8 系统（`/api`）

| 方法   | 路径                         | 说明                 |
| ------ | ---------------------------- | -------------------- |
| `GET`  | `/health`                    | 健康检查             |
| `GET`  | `/portfolio/exchange-rates`  | 获取实时汇率         |
| `POST` | `/portfolio/correct-history` | 触发历史交易金额修正 |

---

## 四、数据模型

### 核心实体

```
Portfolio (投资组合)
├── id, name
├── initialCash, cash
├── leverage (总额/已用/可用/利率)
├── attentionInfo
├── → Transaction[]
├── → PortfolioSnapshot[]
└── → PositionSnapshot[]

Asset (资产/股票)
├── code (主键，如 sh600519)
├── name, market (CN/HK/US)
├── → QuoteSnapshot[]
├── → Transaction[]
└── → PositionSnapshot[]

Transaction (交易记录)
├── id, portfolioId, type, date
├── assetCode, quantity, price, amount
├── commission, leverageUsed
├── currency, exchangeRate, notes
└── → Asset, → Portfolio

PortfolioSnapshot (组合级快照)
├── portfolioId, date
├── totalMarketValue, netAssets
├── totalPnl, dailyPnl, cash
└── @@unique(portfolioId, date)

PositionSnapshot (个股级快照)
├── portfolioId, date, assetCode
├── quantity, currentPrice (原币种)
├── marketValue (CNY)
└── @@unique(portfolioId, date, assetCode)

QuoteSnapshot (行情快照)
├── assetCode, timestamp
├── currentPrice, changePercent, volume
├── 周/月/年涨跌幅
└── → Asset
```

---

## 五、技术栈

| 层        | 技术           | 版本 |
| --------- | -------------- | ---- |
| 前端框架  | React          | 19.0 |
| UI 组件库 | Ant Design     | 5.24 |
| 图表      | ECharts        | 5.6  |
| 状态管理  | Zustand        | 5.0  |
| 数据请求  | TanStack Query | 5.62 |
| 构建工具  | Vite           | 6.2  |
| 后端框架  | Express        | 5.1  |
| ORM       | Prisma         | 6.19 |
| 数据库    | SQLite         | —    |
| 数据验证  | Zod            | 4.1  |
| 定时任务  | node-schedule  | 2.1  |
| 缓存      | node-cache     | 5.1  |
| 日志      | Pino           | 9.5  |
| 桌面端    | Electron       | 35.1 |
| 语言      | TypeScript     | 5.8  |

---

## 六、环境变量

| 变量名                   | 必填 | 默认值                            | 说明                     |
| ------------------------ | ---- | --------------------------------- | ------------------------ |
| `DATABASE_URL`           | 是   | `file:./prisma/data/portfolio.db` | SQLite 数据库路径        |
| `PORT`                   | 否   | `3001`                            | 服务端口                 |
| `NODE_ENV`               | 否   | `development`                     | 运行环境                 |
| `FRONTEND_URL`           | 否   | `http://localhost:5173`           | 前端地址（CORS）         |
| `API_BASE_PATH`          | 否   | `/api`                            | API 路径前缀             |
| `SNAPSHOT_ALERT_WEBHOOK` | 否   | —                                 | 快照失败告警 Webhook URL |

---

## 七、部署方式

### 开发环境

```bash
npm install          # 安装依赖
npm run dev          # 启动前后端开发服务器
```

### 生产环境

```bash
npm run build        # 构建后端 bundle
node dist/server-bundle.js   # 运行
# 或使用 PM2：
pm2 start ecosystem.config.js
```

### Electron 桌面应用

- 打包为 Windows x64 安装包
- 内嵌 Node.js 运行时，无需额外安装依赖

---

**最后更新**：2026-03-04
