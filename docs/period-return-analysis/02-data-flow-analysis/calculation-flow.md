# 计算流程追踪

> 最后更新：2025-12-30
> 分析文件：`apps/backend/src/services/portfolioStatsService.ts`, `apps/backend/src/services/calculation/index.ts`

---

## 1. 计算流程概览

### 1.1 完整流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         用户请求周期收益                              │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PortfolioStatsService                             │
│                  （统一统计服务入口）                                │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │        数据准备阶段                  │
        └────┬───────────────────────────────┘
             │
             ├─► 加载投资组合数据
             ├─► 加载交易记录
             ├─► 获取当前持仓
             ├─► 获取实时行情
             └─► 获取汇率数据
             │
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    数据验证与清洗                                     │
│  - 验证交易数据完整性                                                 │
│  - 清洗异常数据                                                       │
│  - 补全缺失字段                                                       │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    实时盈亏计算                                       │
│                  realtime-pnl.ts                                    │
│  - 计算持仓市值                                                       │
│  - 计算摊薄成本                                                       │
│  - 计算总盈亏                                                         │
│  - 计算浮动盈亏                                                       │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    已实现盈亏计算                                     │
│                  realized-pnl.ts                                     │
│  - FIFO批次跟踪                                                       │
│  - 计算已实现盈亏                                                     │
│  - 计算股息收入                                                       │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    周期收益计算                                       │
│                  period-stats.ts                                     │
│  - 重建期初/期末状态                                                  │
│  - 计算净值变化                                                       │
│  - 计算Modified Dietz收益率                                           │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    结果整合与返回                                     │
│  - 合并所有计算结果                                                   │
│  - 添加元数据                                                         │
│  - 缓存结果                                                           │
└────────────────────┬──────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      返回给前端                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 统一服务入口

### 2.1 PortfolioStatsService

**文档位置**：`apps/backend/src/services/portfolioStatsService.ts`

**职责**：统一管理所有统计计算，提供单一入口

### 2.2 服务结构

```typescript
export class PortfolioStatsService {
  constructor(
    private portfolioRepository: PortfolioRepository,
    private marketDataProvider: MarketDataProvider,
    private cacheService: CacheService
  ) {}

  async getPortfolioStats(
    portfolioId: string,
    period: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'total'
  ): Promise<PortfolioStats> {
    // 统一入口
  }
}
```

**设计分析**：

- ✅ 依赖注入（DI）
- ✅ 单一职责
- ✅ 可测试性强

### 2.3 核心方法

```typescript
async getPortfolioStats(
  portfolioId: string,
  period: Period
): Promise<PortfolioStats> {
  // 1. 生成缓存键
  const cacheKey = this.getCacheKey(portfolioId, period);

  // 2. 尝试从缓存获取
  const cached = this.cacheService.get<PortfolioStats>(cacheKey);
  if (cached) {
    return cached;
  }

  // 3. 计算统计
  const stats = await this.calculateStats(portfolioId, period);

  // 4. 缓存结果
  this.cacheService.set(cacheKey, stats, this.getTTL(period));

  return stats;
}
```

**分析**：

- ✅ 三级缓存：内存→文件→外部API
- ✅ 缓存键设计合理
- ✅ 支持不同周期的不同TTL

---

## 3. 数据准备阶段

### 3.1 加载投资组合数据

```typescript
async function loadPortfolioData(portfolioId: string) {
  // 1. 获取投资组合基本信息
  const portfolio = await portfolioRepository.findById(portfolioId);
  if (!portfolio) {
    throw new Error(`Portfolio not found: ${portfolioId}`);
  }

  // 2. 加载所有交易记录
  const transactions = await portfolioRepository.getTransactions(portfolioId);

  // 3. 加载当前持仓
  const positions = await portfolioRepository.getPositions(portfolioId);

  return { portfolio, transactions, positions };
}
```

**分析**：

- ✅ 包含所有必要数据
- ⚠️ 多次数据库查询，可优化为单次查询

### 3.2 获取市场数据

```typescript
async function loadMarketData(positions: Position[]) {
  // 1. 提取所有股票代码
  const codes = positions.map((p) => p.asset.code);

  // 2. 批量获取实时行情
  const quotes = await marketDataProvider.getBatchQuotes(codes);

  // 3. 获取汇率数据
  const exchangeRates = await currencyService.getAllRates();

  return { quotes, exchangeRates };
}
```

**分析**：

- ✅ 批量获取优化性能
- ✅ 并行获取行情和汇率
- ⚠️ 行情获取失败时缺少降级策略

---

## 4. 实时盈亏计算流程

### 4.1 调用链路

```
getPortfolioStats
  └─► calculateRealtimePnl
       └─► 对每个持仓：
            ├─► 获取行情数据
            ├─► 计算市值
            ├─► 计算摊薄成本
            ├─► 计算浮动盈亏
            └─► 计算盈亏百分比
```

### 4.2 详细流程（第20-100行）

```typescript
export function calculateRealtimePnl(
  positions: Position[],
  quotes: Record<string, Quote>
): Position[] {
  return positions.map((position) => {
    const quote = quotes[position.asset.code];
    const currency =
      position.currency || getCurrencyForAsset(position.asset.code);
    const updatedPosition: Position = { ...position, currency };

    if (quote && quote.currentPrice != null) {
      // 1. 更新当前价格
      updatedPosition.currentPrice = quote.currentPrice;

      // 2. 获取汇率
      const exchangeRate = getExchangeRateForAssetToCNY(position.asset.code);

      // 3. 计算市值
      const marketValueLocal = quote.currentPrice * position.quantity;
      const marketValueCny = marketValueLocal * exchangeRate;
      updatedPosition.marketValueLocal = marketValueLocal;
      updatedPosition.marketValue = marketValueCny;

      // 4. 计算总盈亏
      updatedPosition.totalPnl = marketValueCny - (position.totalCost || 0);

      // 5. 计算浮动盈亏
      if (typeof position.costPriceLocal === 'number') {
        const floatingPnlLocal =
          (quote.currentPrice - position.costPriceLocal) * position.quantity;
        updatedPosition.floatingPnlLocal = floatingPnlLocal;
        updatedPosition.floatingPnl = floatingPnlLocal * exchangeRate;
      }

      // 6. 计算盈亏百分比
      const denominator = position.totalBuyCost ?? position.totalCost ?? 0;
      updatedPosition.totalPnlPercent =
        denominator !== 0 ? updatedPosition.totalPnl / denominator : 0;

      // 7. 计算当日盈亏
      if (quote.changeAmount != null) {
        const dailyChangeLocal = quote.changeAmount * position.quantity;
        updatedPosition.dailyChangeLocal = dailyChangeLocal;
        updatedPosition.dailyChange = dailyChangeLocal * exchangeRate;
      }
    }

    return updatedPosition;
  });
}
```

**流程分析**：

- ✅ 7个步骤清晰明确
- ✅ 每步都有详细注释
- ⚠️ 缺少异常处理

### 4.3 数据传递

```
输入: positions = [
  {
    asset: { code: 'sh600519', name: '贵州茅台' },
    quantity: 100,
    totalCost: 180000,
    totalBuyCost: 180000,
    costPrice: 1800,
  }
]

输出: updatedPosition = {
  asset: { code: 'sh600519', name: '贵州茅台' },
  quantity: 100,
  totalCost: 180000,
  totalBuyCost: 180000,
  costPrice: 1800,
  currentPrice: 1850,        // ← 新增
  marketValue: 185000,       // ← 新增
  totalPnl: 5000,            // ← 新增
  floatingPnl: 5000,         // ← 新增
  totalPnlPercent: 0.0278,   // ← 新增
  dailyChange: 500,          // ← 新增
  // ...
}
```

---

## 5. 已实现盈亏计算流程

### 5.1 调用链路

```
getPortfolioStats
  └─► calculateRealizedPnl
       ├─► 排序交易记录
       ├─► 初始化LotTracker
       ├─► 遍历所有交易：
       │    ├─► 分红 → 直接累加
       │    ├─► 买入 → 记录批次
       │    └─► 卖出 → FIFO匹配，计算盈亏
       └─► 返回已实现盈亏总额
```

### 5.2 详细流程（第23-118行）

```typescript
export async function calculateRealizedPnl(
  portfolio: Portfolio
): Promise<number> {
  // 1. 缓存检查
  const txHash = hashTransactions(portfolio.transactions);
  const cacheKey = `realized-pnl:${portfolio.id}:${txHash}`;
  const cached = cacheService.get<number>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // 2. 初始化
  const tracker = new LotTracker();
  let tradingPnl = 0;
  let totalDividendIncome = 0;
  const sortedTransactions = [...portfolio.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 3. 遍历交易
  for (const tx of sortedTransactions) {
    if (tx.type === TransactionType.DIVIDEND) {
      // 分红处理
      totalDividendIncome += Number(tx.amount || 0);
    } else if (tx.type === TransactionType.BUY) {
      // 买入处理
      tracker.applyBuy(tx);
    } else if (tx.type === TransactionType.SELL) {
      // 卖出处理
      const sellResult = tracker.applySell(tx);
      const rate = resolveTransactionExchangeRate(tx);
      const revenueQuantity = sellResult.matchedQuantity;
      const grossRevenue = revenueQuantity * Number(tx.price || 0) * rate;
      const commissionCny = getCommissionInCny(tx);
      const effectiveCommission =
        (commissionCny * revenueQuantity) / Number(tx.quantity || 1);
      const netRevenue = grossRevenue - effectiveCommission;
      const costRemoved = sellResult.costRemovedCny;
      const realizedFromSell = netRevenue - costRemoved;
      tradingPnl += realizedFromSell;
    }
  }

  // 4. 计算总结果
  const totalRealizedPnl = tradingPnl + totalDividendIncome;

  // 5. 缓存结果
  cacheService.set(cacheKey, totalRealizedPnl, 0); // 永久缓存

  return totalRealizedPnl;
}
```

**流程分析**：

- ✅ 5个阶段清晰
- ✅ FIFO匹配逻辑封装在LotTracker
- ✅ 缓存机制完善

### 5.3 LotTracker内部流程

```typescript
class LotTracker {
  private lots: Map<string, Lot[]> = new Map();

  applyBuy(tx: Transaction) {
    const code = tx.assetCode!;
    const lot: Lot = {
      quantity: Number(tx.quantity || 0),
      unitCost: Number(tx.price || 0),
      commission: Number(tx.commission || 0),
      timestamp: new Date(tx.date).getTime(),
    };

    if (!this.lots.has(code)) {
      this.lots.set(code, []);
    }
    this.lots.get(code)!.push(lot);
  }

  applySell(tx: Transaction): SellResult {
    const code = tx.assetCode!;
    const sellQuantity = Number(tx.quantity || 0);
    let remaining = sellQuantity;
    let totalCostRemoved = 0;

    const lots = this.lots.get(code) || [];
    for (const lot of lots) {
      if (remaining <= 0) break;

      const matched = Math.min(lot.quantity, remaining);
      totalCostRemoved +=
        matched * (lot.unitCost + lot.commission / lot.quantity);
      lot.quantity -= matched;
      remaining -= matched;
    }

    return {
      matchedQuantity: sellQuantity - remaining,
      costRemovedCny: totalCostRemoved,
    };
  }
}
```

**分析**：

- ✅ 简单有效的FIFO实现
- ⚠️ 每次卖出都遍历所有批次，性能可优化

---

## 6. 周期收益计算流程

### 6.1 调用链路

```
getPortfolioStats
  └─► calculatePeriodStats
       ├─► 确定周期日期
       ├─► 提取现金流
       ├─► 重建期初状态
       ├─► 重建期末状态
       ├─► 获取K线数据
       ├─► 计算期初价值
       ├─► 计算期末价值
       ├─► 计算Modified Dietz
       └─► 返回周期统计
```

### 6.2 详细流程（第49-549行）

```typescript
export async function calculatePeriodStats(
  portfolio: Portfolio,
  period: Period,
  options?: PeriodStatsOptions
): Promise<PeriodStatsResult> {
  // 阶段1: 初始化
  const quotesMap = options?.quotes;
  const transactions = portfolio.transactions || [];

  // 阶段2: 确定日期
  const endDate = startOfDay(new Date());
  let startDate: Date;
  if (period === 'total') {
    startDate = getEarliestTransactionDate(transactions);
  } else {
    startDate = getPeriodStartDate(period, endDate);
  }

  // 阶段3: 提取现金流
  const cashFlowsWithTime = extractCashFlows(transactions, startDate, endDate);

  // 阶段4: 重建状态
  const startState = reconstructPortfolioState(portfolio, startDate, false);
  const endState = reconstructPortfolioState(portfolio, endDate, true);

  // 阶段5: 获取K线
  const assetCodes = getAssetCodes(transactions);
  const klineMap = await fetchKlinesForAssets(assetCodes, startDate, endDate);

  // 阶段6: 计算价值
  const startValue = await calculatePortfolioValue(
    startState,
    startDate,
    klineMap
  );
  const endValue = await calculatePortfolioValue(endState, endDate, klineMap);

  // 阶段7: 计算收益率
  const periodReturn = calculateModifiedDietz(
    startValue,
    endValue,
    cashFlowsWithTime,
    startDate,
    endDate
  );

  return periodReturn;
}
```

**分析**：

- ✅ 7个阶段职责单一
- ✅ 清晰的步骤划分
- ✅ 每阶段都有明确输出

### 6.3 关键子流程

#### 6.3.1 重建投资组合状态

```typescript
function reconstructPortfolioState(
  portfolio: Portfolio,
  atDate: Date,
  includeTargetDay: boolean
): PortfolioState {
  const tracker = new LotTracker();
  let cash = portfolio.initialCash || 0;
  let usedLeverage = 0;

  for (const tx of sortedTransactions) {
    const txTimestamp = new Date(tx.date).getTime();
    const targetTimestamp = includeTargetDay
      ? endOfDay(atDate).getTime()
      : startOfDay(atDate).getTime() - 1;

    if (txTimestamp > targetTimestamp) break;

    // 处理各种交易类型...
  }

  return {
    positions: tracker.getPositionsSnapshot(),
    cash,
    usedLeverage,
  };
}
```

**分析**：

- ✅ 时间边界处理正确
- ✅ 逐个处理交易记录
- ⚠️ 时间复杂度O(n)，可优化

#### 6.3.2 计算组合价值

```typescript
async function calculatePortfolioValue(
  state: PortfolioState,
  priceDate: string,
  klineMap: Record<string, KlinePoint[]>
): Promise<number> {
  let totalValue = state.cash;

  for (const [code, posState] of state.positions.entries()) {
    if (posState.quantity <= 0) continue;

    // 1. 查找价格
    const price = await findPriceForAsset(code, priceDate, klineMap);

    // 2. 计算市值
    const marketValue = posState.quantity * price;

    // 3. 累加到总值
    totalValue += marketValue;
  }

  return totalValue - state.usedLeverage; // 净值口径
}
```

**分析**：

- ✅ 净值计算：总资产 - 杠杆
- ✅ 支持成本价回退
- ⚠️ 串行计算价格，可并行优化

#### 6.3.3 Modified Dietz计算

```typescript
function calculateModifiedDietz(
  startValue: number,
  endValue: number,
  cashFlows: CashFlow[],
  startDate: Date,
  endDate: Date
): number {
  const totalCashFlows = cashFlows.reduce((sum, cf) => sum + cf.amount, 0);
  const weightedCashFlows = cashFlows.reduce((sum, cf) => {
    const weight =
      (endDate.getTime() - cf.timestamp) /
      (endDate.getTime() - startDate.getTime());
    return sum + cf.amount * weight;
  }, 0);

  const denominator = startValue + weightedCashFlows;
  if (Math.abs(denominator) < 1e-9) {
    return 0;
  }

  return (endValue - startValue - totalCashFlows) / denominator;
}
```

**分析**：

- ✅ 公式实现正确
- ✅ 处理分母为0的情况
- ⚠️ 权重计算使用除法，可能有精度问题

---

## 7. 结果整合流程

### 7.1 合并所有计算结果

```typescript
async function calculateStats(
  portfolioId: string,
  period: Period
): Promise<PortfolioStats> {
  // 1. 数据准备
  const { portfolio, transactions, positions } =
    await loadPortfolioData(portfolioId);
  const { quotes, exchangeRates } = await loadMarketData(positions);

  // 2. 实时盈亏计算
  const updatedPositions = calculateRealtimePnl(positions, quotes);

  // 3. 已实现盈亏计算
  const realizedPnl = await calculateRealizedPnl(portfolio);

  // 4. 周期收益计算
  const periodStats = await calculatePeriodStats(portfolio, period, { quotes });

  // 5. 整合结果
  const stats: PortfolioStats = {
    portfolio: {
      ...portfolio,
      positions: updatedPositions,
    },
    realizedPnl,
    periodStats,
    metadata: {
      calculatedAt: new Date(),
      dataSource: {
        quotes: Object.keys(quotes).length,
        exchangeRates: Object.keys(exchangeRates).length,
      },
    },
  };

  return stats;
}
```

**分析**：

- ✅ 串行执行，确保数据依赖
- ✅ 包含元数据
- ⚠️ 可并行计算的部分未并行

### 7.2 缓存机制

```typescript
const cacheKey = `portfolio-stats:${portfolioId}:${period}`;
const cached = cacheService.get<PortfolioStats>(cacheKey);
if (cached) {
  // 缓存命中
  return cached;
}

// 计算
const stats = await calculateStats(portfolioId, period);

// 缓存（不同周期不同TTL）
const ttl = {
  daily: 60, // 1分钟
  weekly: 300, // 5分钟
  monthly: 1800, // 30分钟
  yearly: 3600, // 1小时
  total: 3600, // 1小时
}[period];

cacheService.set(cacheKey, stats, ttl);
```

**分析**：

- ✅ 智能TTL策略
- ✅ 缓存键设计合理
- ✅ 包含足够信息

---

## 8. 数据传递链路

### 8.1 输入数据结构

```typescript
interface PortfolioInput {
  id: string;
  name: string;
  initialCash: number;
  cash: number;
  leverage?: {
    totalAmount: number;
    usedAmount: number;
    costRate: number;
  };
  transactions: Transaction[];
}

interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency?: string;
  exchangeRate?: number;
}
```

### 8.2 中间数据结构

```typescript
interface Position {
  asset: Asset;
  quantity: number;
  totalCost: number; // 摊薄成本
  totalCostLocal: number; // 原币种摊薄成本
  totalBuyCost: number; // 累计买入成本
  costPrice?: number; // 成本价
  costPriceLocal?: number; // 原币种成本价
}

interface Quote {
  code: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  changeAmount: number;
  volume?: number;
  turnover?: number;
}
```

### 8.3 输出数据结构

```typescript
interface PeriodStatsResult {
  periodReturnPercent: number | null;
  periodPnl: number | null;
  totalValueChange: number;
  totalValueChangePercent: number | null;
  baseDate: string | null;
  baseDateSource: string;
  endDate: string | null;
  endDateSource: string;
  fallbackDays: number;
}

interface PortfolioStats {
  portfolio: Portfolio;
  realizedPnl: number;
  periodStats: PeriodStatsResult;
  metadata: {
    calculatedAt: Date;
    dataSource: {
      quotes: number;
      exchangeRates: number;
    };
  };
}
```

---

## 9. 性能分析

### 9.1 时间复杂度

| 阶段       | 操作       | 时间复杂度 | 说明       |
| ---------- | ---------- | ---------- | ---------- |
| 数据加载   | 数据库查询 | O(n)       | n=交易数量 |
| 实时盈亏   | 遍历持仓   | O(m)       | m=持仓数量 |
| 已实现盈亏 | 排序+遍历  | O(n log n) | 交易排序   |
| 周期收益   | 重建状态   | O(n)       | 交易遍历   |
| K线获取    | API调用    | O(k)       | k=股票数量 |

**总复杂度**：O(n log n + k)

**分析**：

- 主要瓶颈：交易排序和API调用
- 可优化：并行获取K线

### 9.2 空间复杂度

| 数据结构 | 空间复杂度 | 说明             |
| -------- | ---------- | ---------------- |
| 交易数组 | O(n)       | 所有交易记录     |
| 持仓映射 | O(m)       | 当前持仓         |
| 批次跟踪 | O(b)       | b=活跃批次       |
| K线缓存  | O(k × d)   | k=股票数，d=天数 |

**总空间复杂度**：O(n + m + b + k × d)

### 9.3 优化建议

#### 9.3.1 并行化

```typescript
// 并行获取K线数据
const klinePromises = assetCodes.map(async (code) => {
  return { code, kline: await fetchKline(code, ...) };
});
const klineMap = Object.fromEntries(
  await Promise.all(klinePromises)
);
```

#### 9.3.2 缓存优化

```typescript
// LRU缓存
class LRUCache<K, V> {
  private cache = new Map<K, V>();

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
}
```

#### 9.3.3 索引优化

```sql
-- 交易记录复合索引
CREATE INDEX idx_transaction_portfolio_date_type
ON Transaction(portfolioId, date, type);
```

---

## 10. 错误传播与处理

### 10.1 错误类型

```typescript
enum CalculationError {
  PORTFOLIO_NOT_FOUND = 'PORTFOLIO_NOT_FOUND',
  INVALID_TRANSACTION = 'INVALID_TRANSACTION',
  MARKET_DATA_MISSING = 'MARKET_DATA_MISSING',
  CALCULATION_FAILED = 'CALCULATION_FAILED',
}
```

### 10.2 错误处理策略

```typescript
async function calculateStats(
  portfolioId: string,
  period: Period
): Promise<PortfolioStats> {
  try {
    // 正常计算流程
  } catch (error) {
    if (error.code === CalculationError.PORTFOLIO_NOT_FOUND) {
      throw new Error(`Portfolio not found: ${portfolioId}`);
    }

    if (error.code === CalculationError.MARKET_DATA_MISSING) {
      // 使用缓存数据或默认值
      const cached = await getCachedStats(portfolioId, period);
      if (cached) {
        return cached;
      }
    }

    // 记录错误并重新抛出
    console.error('计算失败:', error);
    throw error;
  }
}
```

### 10.3 容错机制

```typescript
// 单个股票失败不影响整体
const positions = await Promise.all(
  positionCodes.map(async (code) => {
    try {
      return await calculatePositionPnL(code);
    } catch (error) {
      console.warn(`计算 ${code} 失败:`, error);
      return null; // 返回null表示失败
    }
  })
);

// 过滤失败的结果
const validPositions = positions.filter((p) => p !== null);
```

---

## 11. 监控与调试

### 11.1 性能监控

```typescript
const startTime = Date.now();
const result = await calculateStats(portfolioId, period);
const duration = Date.now() - startTime;

console.log(`计算耗时: ${duration}ms, 组合ID: ${portfolioId}, 周期: ${period}`);

// 慢查询告警
if (duration > 5000) {
  alert(`计算时间过长: ${duration}ms`);
}
```

### 11.2 调试日志

```typescript
// 详细计算日志
console.log('[calculatePeriodStats]', {
  period,
  startDate: startDate.toISOString(),
  endDate: endDate.toISOString(),
  transactionCount: transactions.length,
  cashFlowCount: cashFlowsWithTime.length,
  startValue,
  endValue,
  periodReturnPercent,
});
```

### 11.3 指标收集

```typescript
interface CalculationMetrics {
  duration: number;
  transactionCount: number;
  positionCount: number;
  apiCallCount: number;
  cacheHitRate: number;
  errorRate: number;
}

// 收集指标
metricsCollector.record({
  duration,
  transactionCount: transactions.length,
  apiCallCount,
  cacheHitRate: hits / (hits + misses),
});
```

---

## 12. 总结

计算流程设计合理，职责划分清晰。主要瓶颈在交易排序和API调用。建议通过并行化、缓存优化和索引优化来提升性能。

**关键指标**：

- ✅ 流程清晰度：9/10
- ⚠️ 性能：6/10
- ✅ 错误处理：7/10
- ✅ 可维护性：8/10

**需改进**：

- 并行化K线获取
- 优化LotTracker性能
- 添加性能监控
- 完善容错机制

---

## 参考文献

- [软件架构中的计算流程设计](https://martinfowler.com/)
- [Node.js异步编程最佳实践](https://nodejs.org/en/docs/)
- [性能优化指南](https://developers.google.com/web/fundamentals/performance)
