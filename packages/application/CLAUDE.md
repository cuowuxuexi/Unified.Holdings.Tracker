[根目录](../../CLAUDE.md) > [packages](../) > **application**

---

# Application 模块文档

> 最后更新：2025-11-16 08:55:50

## 变更记录 (Changelog)

### 2025-11-16
- 初始化模块文档

---

## 模块职责

Application 层是 DDD 架构的应用服务层，负责：

- **业务用例编排**（Use Cases）：组合 Domain 层的实体和服务
- **事务边界管理**：确保业务操作的原子性
- **输入输出转换**：接收 DTO，调用 Domain 层，返回结果
- **跨实体协调**：协调多个实体完成复杂业务流程

**设计原则**：
- 只依赖 Domain 层（不依赖 Infrastructure）
- 通过依赖注入使用仓储接口
- 每个用例对应一个独立的类或函数

---

## 入口与启动

### 模块入口
- **文件**：`src/index.ts`
- **导出内容**：
  ```typescript
  export * from './types';
  export * from './use-cases/list-portfolios.use-case';
  export * from './use-cases/get-portfolio.use-case';
  export * from './use-cases/create-portfolio.use-case';
  export * from './use-cases/add-transaction.use-case';
  export * from './use-cases/remove-transaction.use-case';
  export * from './use-cases/recalculate-portfolio-cash.use-case';
  export * from './use-cases/update-transaction-notes.use-case';
  export * from './use-cases/update-portfolio-attention.use-case';
  ```

### 使用方式
```typescript
import {
  ListPortfoliosUseCase,
  AddTransactionUseCase
} from '@uht/application';

// 在 DI 容器中注入依赖
const listPortfolios = new ListPortfoliosUseCase(portfolioRepository);
const result = await listPortfolios.execute();
```

---

## 对外接口

### 核心用例（Use Cases）

#### 1. ListPortfoliosUseCase（列出所有投资组合）
- **文件**：`src/use-cases/list-portfolios.use-case.ts`
- **输入**：无
- **输出**：`Portfolio[]`
- **职责**：查询所有投资组合，返回列表

#### 2. GetPortfolioUseCase（获取单个投资组合）
- **文件**：`src/use-cases/get-portfolio.use-case.ts`
- **输入**：`{ portfolioId: string }`
- **输出**：`Portfolio | null`
- **职责**：根据 ID 查询投资组合详情，包含持仓和交易

#### 3. CreatePortfolioUseCase（创建投资组合）
- **文件**：`src/use-cases/create-portfolio.use-case.ts`
- **输入**：
  ```typescript
  {
    name: string;
    initialCash: number;
    leverageTotalAmount?: number;
    leverageCostRate?: number;
  }
  ```
- **输出**：`Portfolio`
- **职责**：创建新投资组合，初始化现金和杠杆

#### 4. AddTransactionUseCase（添加交易）
- **文件**：`src/use-cases/add-transaction.use-case.ts`
- **输入**：
  ```typescript
  {
    portfolioId: string;
    type: TransactionType;
    date: Date;
    assetCode?: string;
    quantity?: number;
    price?: number;
    // ...
  }
  ```
- **输出**：`Transaction`
- **职责**：添加交易记录，更新投资组合现金和杠杆

#### 5. RemoveTransactionUseCase（删除交易）
- **文件**：`src/use-cases/remove-transaction.use-case.ts`
- **输入**：`{ portfolioId: string; transactionId: string }`
- **输出**：`void`
- **职责**：删除交易记录，重新计算现金余额

#### 6. UpdateTransactionNotesUseCase（更新交易备注）
- **文件**：`src/use-cases/update-transaction-notes.use-case.ts`
- **输入**：`{ portfolioId: string; transactionId: string; notes: string }`
- **输出**：`Transaction`
- **职责**：更新交易记录的备注信息

#### 7. UpdatePortfolioAttentionUseCase（更新组合备注）
- **文件**：`src/use-cases/update-portfolio-attention.use-case.ts`
- **输入**：`{ portfolioId: string; attentionInfo: string }`
- **输出**：`Portfolio`
- **职责**：更新投资组合的关注信息/备注

#### 8. RecalculatePortfolioCashUseCase（重算现金）
- **文件**：`src/use-cases/recalculate-portfolio-cash.use-case.ts`
- **输入**：`{ portfolioId: string }`
- **输出**：`Portfolio`
- **职责**：根据交易记录重新计算投资组合的现金余额

---

## 关键依赖与配置

### 依赖
- **@uht/domain**：依赖 Domain 层的实体和仓储接口
- **零外部依赖**：不依赖任何基础设施实现

### 依赖注入模式
每个用例通过构造函数注入仓储接口：
```typescript
export class AddTransactionUseCase {
  constructor(
    private readonly portfolioRepository: PortfolioRepository,
    private readonly marketDataProvider: MarketDataProvider
  ) {}

  async execute(input: AddTransactionInput): Promise<Transaction> {
    // 业务逻辑
  }
}
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

### 构建
```bash
npm run build
```

---

## 数据模型

### 输入输出 DTO

#### CreatePortfolioInput
```typescript
interface CreatePortfolioInput {
  name: string;
  initialCash: number;
  leverageTotalAmount?: number;
  leverageCostRate?: number;
}
```

#### AddTransactionInput
```typescript
interface AddTransactionInput {
  portfolioId: string;
  type: TransactionType;
  date: Date;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
}
```

---

## 测试与质量

### 测试策略
- Application 层暂无单元测试（建议补充）
- 建议测试重点：
  - 用例的业务流程（Mock 仓储接口）
  - 输入验证和错误处理
  - 事务边界和数据一致性

### 测试示例
```typescript
describe('AddTransactionUseCase', () => {
  it('should add a buy transaction and update cash', async () => {
    const mockRepo = createMockPortfolioRepository();
    const useCase = new AddTransactionUseCase(mockRepo);

    const result = await useCase.execute({
      portfolioId: 'p1',
      type: TransactionType.BUY,
      assetCode: '000001',
      quantity: 100,
      price: 10,
    });

    expect(result.type).toBe(TransactionType.BUY);
    expect(mockRepo.save).toHaveBeenCalled();
  });
});
```

---

## 常见问题 (FAQ)

### Q1: 用例之间可以互相调用吗？
A: 可以，但应谨慎。建议通过组合仓储操作，而不是嵌套调用用例。

### Q2: 如何处理事务？
A: 事务管理应由调用方（通常是 Infrastructure 层的服务）负责，用例本身不处理事务。

### Q3: 用例应该返回 DTO 还是实体？
A: 当前返回实体，但建议在未来重构时引入专门的输出 DTO，避免暴露内部实现。

### Q4: 如何添加新用例？
A:
1. 在 `src/use-cases/` 创建新文件（如 `xxx.use-case.ts`）
2. 定义输入/输出类型
3. 实现用例类，注入所需仓储
4. 在 `src/index.ts` 导出

---

## 相关文件清单

```
packages/application/
├── src/
│   ├── use-cases/
│   │   ├── add-transaction.use-case.ts          # 添加交易
│   │   ├── create-portfolio.use-case.ts         # 创建投资组合
│   │   ├── get-portfolio.use-case.ts            # 获取单个组合
│   │   ├── list-portfolios.use-case.ts          # 列出所有组合
│   │   ├── recalculate-portfolio-cash.use-case.ts # 重算现金
│   │   ├── remove-transaction.use-case.ts       # 删除交易
│   │   ├── update-portfolio-attention.use-case.ts # 更新组合备注
│   │   └── update-transaction-notes.use-case.ts # 更新交易备注
│   ├── types.ts                                 # 公共类型定义
│   └── index.ts                                 # 模块导出
├── dist/                                        # 编译输出（gitignore）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 架构图

```
┌──────────────────────────────────────────┐
│       Application Layer (用例编排)       │
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐ │
│  │         Use Cases (用例)           │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │ ListPortfoliosUseCase        │  │ │
│  │  │ GetPortfolioUseCase          │  │ │
│  │  │ CreatePortfolioUseCase       │  │ │
│  │  │ AddTransactionUseCase        │  │ │
│  │  │ RemoveTransactionUseCase     │  │ │
│  │  │ UpdatePortfolioAttention...  │  │ │
│  │  └──────────────────────────────┘  │ │
│  └────────────────────────────────────┘ │
│              │                           │
│              ▼ 依赖                      │
│  ┌────────────────────────────────────┐ │
│  │   Domain Layer (仓储接口)          │ │
│  │  PortfolioRepository               │ │
│  │  MarketDataProvider                │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
                ▲
                │ 调用
                │
┌───────────────┴──────────────────────────┐
│  Infrastructure Layer (接口实现)         │
│  PrismaPortfolioRepository               │
│  TencentMarketDataProvider               │
└──────────────────────────────────────────┘
```

---

## 设计模式

### 命令模式（Command Pattern）
每个用例是一个独立的命令对象，封装一个业务操作。

### 依赖注入（Dependency Injection）
通过构造函数注入仓储接口，便于测试和替换实现。

### 单一职责（Single Responsibility）
每个用例只负责一个业务流程，保持简单和可维护。

---

## 未来改进建议

1. **引入 DTO 层**：分离输入/输出模型与 Domain 实体
2. **添加验证器**：使用 Zod 或 class-validator 验证输入
3. **补充单元测试**：覆盖所有用例的正常和异常流程
4. **引入事件机制**：用例执行后发布领域事件
5. **日志和监控**：记录用例执行情况，便于问题排查
