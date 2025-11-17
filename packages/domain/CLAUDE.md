[根目录](../../CLAUDE.md) > [packages](../) > **domain**

---

# Domain 模块文档

> 最后更新：2025-11-16 08:55:50

## 变更记录 (Changelog)

### 2025-11-16
- 初始化模块文档

---

## 模块职责

Domain 层是 DDD（领域驱动设计）架构的核心，提供：

- **核心实体**（Entities）：Asset、Portfolio、Position、Transaction、Quote
- **值对象**（Value Objects）：LeverageInfo
- **仓储接口**（Repository Interfaces）：PortfolioRepository、MarketDataProvider、FxRateProvider
- **业务规则**：封装在实体和值对象的方法中

**设计原则**：
- 不依赖任何外部框架或库（纯 TypeScript）
- 实体包含业务逻辑和验证规则
- 仓储接口定义数据访问契约，但不实现

---

## 入口与启动

### 模块入口
- **文件**：`src/index.ts`
- **导出内容**：
  ```typescript
  export * from './entities/asset';
  export * from './entities/transaction';
  export * from './entities/portfolio';
  export * from './entities/position';
  export * from './entities/quote';
  export * from './value-objects/leverage-info';
  export * from './repositories';
  ```

### 使用方式
```typescript
import { Portfolio, Asset, PortfolioRepository } from '@uht/domain';
```

---

## 对外接口

### 核心实体（Entities）

#### 1. Portfolio（投资组合）
- **文件**：`src/entities/portfolio.ts`
- **职责**：管理投资组合的现金、杠杆、交易记录
- **关键方法**：
  ```typescript
  class Portfolio {
    calculateTotalAssets(): number;
    addTransaction(tx: Transaction): void;
    updateCash(amount: number): void;
    // ...
  }
  ```

#### 2. Asset（资产）
- **文件**：`src/entities/asset.ts`
- **职责**：表示股票/基金等资产
- **属性**：
  ```typescript
  interface Asset {
    code: string;        // 股票代码
    name: string;        // 资产名称
    market: Market;      // 市场（CN/HK/US）
  }
  ```

#### 3. Transaction（交易）
- **文件**：`src/entities/transaction.ts`
- **职责**：表示交易记录（买入、卖出、存取款等）
- **类型枚举**：
  ```typescript
  enum TransactionType {
    BUY, SELL, DEPOSIT, WITHDRAW,
    LEVERAGE_ADD, LEVERAGE_REMOVE,
    LEVERAGE_COST, DIVIDEND
  }
  ```

#### 4. Position（持仓）
- **文件**：`src/entities/position.ts`
- **职责**：计算持仓成本、盈亏、收益率
- **关键方法**：
  ```typescript
  class Position {
    calculateAverageCost(): number;
    calculatePnL(currentPrice: number): number;
    calculateReturnRate(currentPrice: number): number;
  }
  ```

#### 5. Quote（行情）
- **文件**：`src/entities/quote.ts`
- **职责**：表示实时行情数据
- **属性**：价格、涨跌幅、成交量、市盈率等

### 值对象（Value Objects）

#### LeverageInfo（杠杆信息）
- **文件**：`src/value-objects/leverage-info.ts`
- **职责**：封装杠杆总额、已用、可用、费率等信息
- **特点**：不可变对象，通过方法返回新实例

### 仓储接口（Repository Interfaces）

#### 1. PortfolioRepository
- **文件**：`src/repositories/portfolio-repository.ts`
- **方法**：
  ```typescript
  interface PortfolioRepository {
    findAll(): Promise<Portfolio[]>;
    findById(id: string): Promise<Portfolio | null>;
    save(portfolio: Portfolio): Promise<void>;
    delete(id: string): Promise<void>;
  }
  ```

#### 2. MarketDataProvider
- **文件**：`src/repositories/market-data-provider.ts`
- **方法**：
  ```typescript
  interface MarketDataProvider {
    getQuote(assetCode: string): Promise<Quote>;
    getBatchQuotes(codes: string[]): Promise<Quote[]>;
  }
  ```

#### 3. FxRateProvider
- **文件**：`src/repositories/fx-rate-provider.ts`
- **方法**：
  ```typescript
  interface FxRateProvider {
    getRate(from: string, to: string): Promise<number>;
  }
  ```

---

## 关键依赖与配置

### 依赖
- **零依赖**：Domain 层不依赖任何外部 npm 包，保持纯粹性

### TypeScript 配置
- **tsconfig.json**：
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "./dist",
      "rootDir": "./src"
    }
  }
  ```

### 构建
```bash
npm run build
```
输出到 `dist/` 目录，生成 `.js` 和 `.d.ts` 文件。

---

## 数据模型

### 核心实体关系

```
Portfolio (投资组合)
  │
  ├── transactions: Transaction[]  (交易记录)
  │     └── asset: Asset?           (关联资产)
  │
  └── leverageInfo: LeverageInfo    (杠杆信息)

Position (持仓，运行时计算)
  ├── asset: Asset
  └── transactions: Transaction[]   (该资产的所有交易)

Quote (行情快照)
  └── asset: Asset
```

### 枚举类型

```typescript
// 市场
enum Market {
  CN = 'CN',  // 中国A股
  HK = 'HK',  // 港股
  US = 'US'   // 美股
}

// 交易类型
enum TransactionType {
  BUY,              // 买入
  SELL,             // 卖出
  DEPOSIT,          // 存款
  WITHDRAW,         // 取款
  LEVERAGE_ADD,     // 增加杠杆额度
  LEVERAGE_REMOVE,  // 减少杠杆额度
  LEVERAGE_COST,    // 杠杆费用
  DIVIDEND          // 分红
}
```

---

## 测试与质量

### 测试策略
- Domain 层暂无单元测试（建议补充）
- 建议测试重��：
  - 实体的业务逻辑方法（如成本计算、盈亏计算）
  - 值对象的不可变性
  - 接口定义的完整性

### 代码质量
- 使用 TypeScript 严格模式
- 接口和类型定义清晰
- 遵循 DDD 设计原则

---

## 常见问题 (FAQ)

### Q1: 为什么 Domain 层没有依赖？
A: 遵循 DDD 原则，Domain 层应该是纯业务逻辑，不依赖外部框架，保持稳定性和可移植性。

### Q2: 仓储接口在哪里实现？
A: 在 `packages/infra` 模块中实现（如 `PrismaPortfolioRepository`）。

### Q3: 如何添加新实体？
A:
1. 在 `src/entities/` 创建新文件
2. 定义实体类和相关接口
3. 在 `src/index.ts` 导出
4. 更新 Prisma schema（如果需要持久化）

### Q4: Position 为什么不是数据库表？
A: Position（持仓）是根据交易记录运行时计算的，不需要单独存储。

---

## 相关文件清单

```
packages/domain/
├── src/
│   ├── entities/
│   │   ├── asset.ts              # 资产实体
│   │   ├── portfolio.ts          # 投资组合实体
│   │   ├── position.ts           # 持仓实体（运行时）
│   │   ├── quote.ts              # 行情实体
│   │   └── transaction.ts        # 交易实体
│   ├── repositories/
│   │   ├── fx-rate-provider.ts   # 汇率提供者接口
│   │   ├── market-data-provider.ts # 市场数据提供者接口
│   │   ├── portfolio-repository.ts # 投资组合仓储接口
│   │   └── index.ts              # 仓储接口导出
│   ├── value-objects/
│   │   └── leverage-info.ts      # 杠杆信息值对象
│   └── index.ts                  # 模块导出
├── dist/                         # 编译输出（gitignore）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 设计原则

### 单一职责
- 每个实体只负责自己的业务逻辑
- 值对象表示不可变的业务概念
- 仓储接口定义数据访问契约

### 依赖倒置
- Application 层依赖 Domain 层的接口
- Infrastructure 层实现 Domain 层的接口
- Domain 层不依赖任何层

### 领域模型纯粹性
- 不包含框架特定的注解或装饰器
- 业务规则封装在实体和值对象中
- 可独立测试，不依赖外部系统

---

## 架构图

```
┌───────────────────────────────────┐
│        Domain Layer (纯业务)      │
├───────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │      Entities (实体)        │ │
│  │  Portfolio, Asset,          │ │
│  │  Transaction, Position      │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │  Value Objects (值对象)     │ │
│  │  LeverageInfo               │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │  Repositories (仓储接口)    │ │
│  │  PortfolioRepository,       │ │
│  │  MarketDataProvider         │ │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
         ▲                   ▲
         │                   │
    依赖关系            实现关系
         │                   │
┌────────┴────────┐  ┌───────┴──────────┐
│  Application    │  │  Infrastructure  │
│  (用例编排)     │  │  (接口实现)      │
└─────────────────┘  └──────────────────┘
```
