[根目录](../../CLAUDE.md) > [packages](../) > **infra**

---

# Infrastructure 模块文档

> 最后更新：2025-11-16 08:55:50

## 变更记录 (Changelog)

### 2025-11-16
- 初始化模块文档

---

## 模块职责

Infrastructure（基础设施层）是 DDD 架构的最外层，负责：

- **实现仓储接口**：PrismaPortfolioRepository（Prisma ORM）
- **外部 API 调用**：市场数据提供者（腾讯 API）
- **缓存服务**：内存缓存市场数据（node-cache）
- **数据库访问**：Prisma Client 单例管理
- **汇率服务**：USD-CNY、HKD-CNY 汇率获取（Frankfurter API）
- **遗留存储**：JSON 文件读写（已废弃，用于迁移）

**设计原则**：
- 实现 Domain 层定义的仓储接口
- 对外部系统的调用封装在 Provider 中
- 不包含业务逻辑，只负责技术实现

---

## 入口与启动

### 模块入口
- **文件**：`src/index.ts`
- **导出内容**：
  ```typescript
  export * from './cache/cache-service';
  export * from './data/data-service';
  export * from './providers/currency-service';
  export * from './storage/storage.prisma';
  export * as legacyStorage from './storage/storage.legacy';
  export * from './database/prisma-client';
  export * from './storage/prisma-portfolio.repository';
  ```

### 使用方式
```typescript
import {
  PrismaPortfolioRepository,
  CacheService,
  CurrencyService
} from '@uht/infra';

// 在 DI 容器中实例化
const repository = new PrismaPortfolioRepository(prisma);
const cache = new CacheService();
```

---

## 对外接口

### 核心服务与实现

#### 1. PrismaPortfolioRepository（Prisma 仓储实现）
- **文件**：`src/storage/prisma-portfolio.repository.ts`
- **实现接口**：`PortfolioRepository` (Domain)
- **职责**：通过 Prisma ORM 实现投资组合的 CRUD 操作
- **方法**：
  ```typescript
  class PrismaPortfolioRepository implements PortfolioRepository {
    async findAll(): Promise<Portfolio[]>;
    async findById(id: string): Promise<Portfolio | null>;
    async save(portfolio: Portfolio): Promise<void>;
    async delete(id: string): Promise<void>;
  }
  ```

#### 2. CacheService（缓存服务）
- **文件**：`src/cache/cache-service.ts`
- **依赖**：node-cache
- **职责**：缓存市场数据，减少 API 调用频率
- **配置**：默认 TTL 5 分钟
- **方法**：
  ```typescript
  class CacheService {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T, ttl?: number): void;
    clear(): void;
  }
  ```

#### 3. CurrencyService（汇率服务）
- **文件**：`src/providers/currency-service.ts`
- **外部 API**：Frankfurter API（免费）
- **职责**：获取并缓存 USD-CNY、HKD-CNY 汇率
- **刷新策略**：每日凌晨 1 点自动刷新
- **缓存位置**：`backend/data/latest_rates.json`

#### 4. DataService（数据服务）
- **文件**：`src/data/data-service.ts`
- **职责**：管理数据目录路径，提供文件读写工具
- **方法**：
  ```typescript
  class DataService {
    getDataDirPath(): string;
    readJsonFile<T>(filename: string): T;
    writeJsonFile<T>(filename: string, data: T): void;
  }
  ```

#### 5. PrismaClient（数据库客户端）
- **文件**：`src/database/prisma-client.ts`
- **职责**：提供 Prisma Client 单例
- **连接管理**：自动连接/断开，支持连接池

#### 6. LegacyStorage（遗留存储，已废弃）
- **文件**：`src/storage/storage.legacy.ts`
- **职责**：JSON 文件读写（用于数据迁移）
- **状态**：已废弃，推荐使用 Prisma

---

## 关键依赖与配置

### 主要依赖
- **@uht/domain** ^0.1.0 - 领域层（接口定义）
- **@prisma/client** ^6.19.0 - Prisma ORM 客户端
- **axios** ^1.8.4 - HTTP 请求（调用外部 API）
- **node-cache** ^5.1.2 - 内存缓存
- **node-schedule** ^2.1.1 - 定时任务（汇率刷新）
- **dotenv** ^17.2.3 - 环境变量管理
- **uuid** ^11.1.0 - UUID 生成

### 环境变量
```bash
DATABASE_URL="file:./prisma/data/portfolio.db"
```

### TypeScript 配置
- **tsconfig.json**：
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "./dist",
      "rootDir": "./src"
    },
    "references": [
      { "path": "../domain" }
    ]
  }
  ```

---

## 数据模型

### Prisma Client 使用

```typescript
import { prisma } from '@uht/infra';

// 查询投资组合（含关联）
const portfolio = await prisma.portfolio.findUnique({
  where: { id: portfolioId },
  include: {
    transactions: {
      include: { asset: true }
    }
  }
});

// 创建交易
const transaction = await prisma.transaction.create({
  data: {
    portfolioId,
    type: 'BUY',
    assetCode: '000001',
    quantity: 100,
    price: 10,
    // ...
  }
});
```

### 缓存键命名规范
- 市场行情：`quote:${assetCode}`
- 批量行情：`batch-quote:${codes.join(',')}`
- 汇率：`fx-rate:${from}-${to}`

---

## 测试与质量

### 测试策略
- Infrastructure 层暂无单元测试（建议补充）
- 建议测试重点：
  - Prisma 仓储的 CRUD 操作（集成测试）
  - 缓存服务的读写和过期
  - 外部 API 调用的错误处理

### 测试示例
```typescript
describe('PrismaPortfolioRepository', () => {
  it('should save and retrieve portfolio', async () => {
    const repo = new PrismaPortfolioRepository(prisma);
    const portfolio = createMockPortfolio();

    await repo.save(portfolio);
    const result = await repo.findById(portfolio.id);

    expect(result).toBeDefined();
    expect(result?.name).toBe(portfolio.name);
  });
});
```

---

## 常见问题 (FAQ)

### Q1: 如何切换数据库实现？
A: 实现新的 PortfolioRepository 接口（如 MongoPortfolioRepository），在 DI 容器中替换即可。

### Q2: 缓存如何失效？
A: 可以手动调用 `cacheService.clear()` 或等待 TTL 过期。

### Q3: 汇率数据从哪里获取？
A: 使用免费的 Frankfurter API（https://www.frankfurter.app/），无需 API Key。

### Q4: 如何添加新的外部 API 提供者？
A:
1. 在 `src/providers/` 创建新文件
2. 实现 Domain 层定义的 Provider 接口
3. 在 `src/index.ts` 导出

---

## 相关文件清单

```
packages/infra/
├── src/
│   ├── cache/
│   │   └── cache-service.ts          # 内存缓存服务
│   ├── data/
│   │   └── data-service.ts           # 数据文件服务
│   ├── database/
│   │   └── prisma-client.ts          # Prisma Client 单例
│   ├── providers/
│   │   └── currency-service.ts       # 汇率服务
│   ├── storage/
│   │   ├── prisma-portfolio.repository.ts # Prisma 仓储实现
│   │   ├── storage.legacy.ts         # 遗留 JSON 存储（废弃）
│   │   └── storage.prisma.ts         # Prisma 存储导出
│   └── index.ts                      # 模块导出
├── dist/                             # 编译输出（gitignore）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 架构图

```
┌──────────────────────────────────────────────┐
│   Infrastructure Layer (基础设施层)          │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐ │
│  │   Repositories (仓储实现)              │ │
│  │  PrismaPortfolioRepository             │ │
│  │    ↓ 使用                              │ │
│  │  Prisma Client                         │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │   Providers (外部服务)                 │ │
│  │  CurrencyService (Frankfurter API)     │ │
│  │  TencentMarketDataProvider             │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │   Services (技术服务)                  │ │
│  │  CacheService (node-cache)             │ │
│  │  DataService (文件读写)                │ │
│  └────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│              ▼ 依赖                          │
│  ┌────────────────────────────────────────┐ │
│  │   External Systems (外部系统)          │ │
│  │  SQLite Database                       │ │
│  │  Frankfurter API                       │ │
│  │  Tencent Finance API                   │ │
│  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 设计模式

### 仓储模式（Repository Pattern）
- 封装数据访问逻辑
- 提供领域对象的持久化和查询
- 隐藏底层存储实现（Prisma/JSON）

### 单例模式（Singleton Pattern）
- Prisma Client 使用单例，避免重复连接

### 适配器模式（Adapter Pattern）
- 将外部 API（腾讯、Frankfurter）适配为 Domain 接口

---

## 未来改进建议

1. **补充集成测试**：测试 Prisma 仓储与真实数据库的交互
2. **错误处理增强**：外部 API 调用失败时的重试和降级策略
3. **缓存策略优化**：支持分布式缓存（Redis）
4. **监控和日志**：记录数据库查询性能和外部 API 调用情况
5. **连接池优化**：根据负载调整 Prisma 连接池配置
