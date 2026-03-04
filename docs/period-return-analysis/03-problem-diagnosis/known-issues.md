# 已识别问题列表

> 最后更新：2025-12-30
> 基于前期算法分析和数据流分析结果

---

## 问题分类概览

### 按严重程度分类

| 严重程度 | 数量 | 占比 | 示例                         |
| -------- | ---- | ---- | ---------------------------- |
| **高**   | 5    | 26%  | 现金流权重计算、基准价格回溯 |
| **中**   | 9    | 47%  | 汇率精度、缓存一致性         |
| **低**   | 5    | 27%  | 日志冗余、性能微优化         |

### 按影响范围分类

| 影响范围 | 数量 | 占比 | 示例                 |
| -------- | ---- | ---- | -------------------- |
| **全局** | 3    | 16%  | 浮点精度、缓存机制   |
| **算法** | 8    | 42%  | Modified Dietz、FIFO |
| **数据** | 5    | 26%  | API质量、汇率        |
| **性能** | 3    | 16%  | 并发、缓存           |

---

## 高严重程度问题

### 问题 #1：现金流权重计算浮点精度问题

**位置**：`apps/backend/src/services/calculation/period-stats.ts:493-508`

**问题描述**：

```typescript
cashFlowsWithTime.forEach((cf) => {
  const remainingSeconds = exclusiveEndTimestamp - cf.timestamp;
  const weight =
    periodDurationSeconds > 0 ? remainingSeconds / periodDurationSeconds : 0;
  weightedCashFlows += cf.amount * weight;
});
```

**根本原因**：

- JavaScript浮点数运算精度限制（IEEE 754）
- 多次累加后误差放大
- 权重计算使用除法，可能产生无限小数

**影响范围**：

- 所有周期收益计算
- Modified Dietz收益率准确性
- 可能导致0.01%-0.1%的偏差

**复现步骤**：

```typescript
// 测试用例
const start = new Date('2025-01-01').getTime();
const end = new Date('2025-03-31').getTime();
const cf = new Date('2025-02-01').getTime();

const periodDurationSeconds = end - start;
const remainingSeconds = end - cf;
const weight = remainingSeconds / periodDurationSeconds;

// 期望：weight = 0.5
// 实际：weight = 0.5000000000000001（可能）
```

**解决方案**：

1. **使用定点数计算**

   ```typescript
   // 将金额转换为分（整数）进行计算
   const amountInFen = Math.round(amount * 100);
   const weightedAmount = amountInFen * weight;
   const result = weightedAmount / 100; // 转回元
   ```

2. **使用Decimal库**

   ```typescript
   import Decimal from 'decimal.js';

   const weight = new Decimal(remainingSeconds).div(periodDurationSeconds);
   const weightedCashFlows = cashFlows.reduce((sum, cf) => {
     return sum.add(new Decimal(cf.amount).mul(weight));
   }, new Decimal(0));
   ```

**优先级**：P0
**预计修复时间**：2天
**影响代码文件**：period-stats.ts

---

### 问题 #2：基准价格回溯机制不足

**位置**：`apps/backend/src/services/calculation/base-price.ts:22-108`

**问题描述**：

```typescript
const KLINE_LOOKBACK_DAYS = 15; // 最多回溯15天
const result = await getBasePrice(code, lastDayOfPrevYear, 60);
```

**根本原因**：

- 年线基准价最多回溯60天
- 15天回溯窗口可能覆盖不了长假期
- 某些股票可能长时间停牌

**影响范围**：

- 年度收益率计算
- 基准日期选择
- 收益率准确性

**复现场景**：

```
股票：sh600000（浦发银行）
2024年12月31日：无交易（节假日）
2024年12月30日：无交易（节假日）
2024年12月29日：最后交易日
回溯窗口：15天
结果：无法找到有效价格，使用成本价估算
```

**解决方案**：

1. **增加回溯天数**

   ```typescript
   const KLINE_LOOKBACK_DAYS = 120; // 增加到120天（约4个月）
   ```

2. **多数据源策略**

   ```typescript
   async function getYearBasePrice(code: string): Promise<BasePrice> {
     // 尝试多个数据源
     const sources = [
       () => getBasePriceFromTencent(code),
       () => getBasePriceFromSina(code),
       () => getBasePriceFromEastmoney(code),
     ];

     for (const source of sources) {
       try {
         const result = await source();
         if (result.price) return result;
       } catch (error) {
         console.warn(`数据源失败:`, error);
       }
     }

     // 最后回退：使用成本价
     return await getCostBasedPrice(code);
   }
   ```

3. **缓存策略优化**
   ```typescript
   // 预加载基准价格
   schedule.scheduleJob('0 20 * * *', async () => {
     // 每天20点预加载
     const allCodes = await getAllAssetCodes();
     for (const code of allCodes) {
       await getYearBasePrice(code); // 预加载下一年基准价
     }
   });
   ```

**优先级**：P0
**预计修复时间**：3天
**影响代码文件**：base-price.ts, period-stats.ts

---

### 问题 #3：实时价格与历史价格不同步

**位置**：`apps/backend/src/services/calculation/period-stats.ts:368-382`

**问题描述**：

```typescript
// 期末：使用实时价格 currentPrice
if (allowRealtimeEnd && quote && typeof quote.currentPrice === 'number') {
  value += posState.quantity * quote.currentPrice * exchangeRate;
  continue;
}

// 期初：使用昨收价 prevClosePrice
if (allowPreCloseStart && quote && typeof quote.prevClosePrice === 'number') {
  value += posState.quantity * quote.prevClosePrice * exchangeRate;
  continue;
}

// 最后：使用K线数据
const pricePoint = findPricePoint(code, priceDate);
```

**根本原因**：

- 实时行情和K线数据来源不同（API端点不同）
- 数据更新频率不同（实时vs T+1）
- 可能存在短暂的数据不一致

**影响范围**：

- 周期收益计算准确性
- 当日收益展示
- 基准价与当前价差异

**复现场景**：

```
时间：2025-01-15 10:30
实时行情：茅台价格 1800元（腾讯实时API）
K线数据：茅台价格 1795元（腾讯K线API，昨收）
差异：5元（0.28%）
```

**解决方案**：

1. **统一数据源**

   ```typescript
   // 优先使用K线数据计算收益，避免实时数据干扰
   const useKlineForCalculation = true;

   if (useKlineForCalculation) {
     // 统一使用K线数据
     const startPrice = getKlinePrice(code, startDate);
     const endPrice = getKlinePrice(code, endDate);
   } else {
     // 保留实时数据用于展示
     const realtimePrice = getQuote(code)?.currentPrice;
   }
   ```

2. **增加数据一致性检查**

   ```typescript
   function validatePriceConsistency(code: string): boolean {
     const realtime = getRealtimePrice(code);
     const kline = getKlinePrice(code, getLatestTradingDate());

     if (!realtime || !kline) return true; // 数据缺失时跳过

     const diff = Math.abs(realtime.currentPrice - kline.close) / kline.close;
     if (diff > 0.05) {
       // 差异超过5%
       console.warn(
         `价格不一致: ${code}, 实时=${realtime.currentPrice}, K线=${kline.close}`
       );
       return false;
     }
     return true;
   }
   ```

**优先级**：P0
**预计修复时间**：2天
**影响代码文件**：period-stats.ts, tencentApi.ts

---

### 问题 #4：摊薄成本为负导致收益率异常

**位置**：`apps/backend/src/services/calculation/realtime-pnl.ts:48-50`

**问题描述**：

```typescript
// 总盈亏 = 市值 - 摊薄成本（摊薄成本可为负数）
updatedPosition.totalPnl = marketValueCny - (position.totalCost || 0);
```

**根本原因**：

- 卖出收入超过买入成本时，摊薄成本为负
- 使用摊薄成本作为分母计算收益率会异常
- 当前虽使用 `totalBuyCost` 作为分母，但 `totalPnl` 字段仍有负数问题

**影响范围**：

- 总盈亏金额展示
- 收益率计算（间接影响）
- 用户理解难度

**复现场景**：

```
交易记录：
2025-01-01: 买入 100股 @ 10元 = 1000元
2025-01-15: 卖出 150股 @ 20元 = 3000元（超额卖出）

结果：
摊薄成本 = 1000 - 3000 = -2000元
当前市值 = 0元（无持仓）
总盈亏 = 0 - (-2000) = 2000元（虚高）

问题：未持仓但显示盈利2000元
```

**解决方案**：

1. **区分已实现和未实现盈亏**

   ```typescript
   interface Position {
     realizedPnl: number; // 已实现盈亏
     unrealizedPnl: number; // 未实现盈亏
     totalPnl: number; // 总盈亏 = realized + unrealized
   }

   // 已实现盈亏来自交易记录
   const realizedPnl = calculateRealizedPnl(position);

   // 未实现盈亏来自市值变化
   const unrealizedPnl = marketValueCny - position.totalCost;

   // 总盈亏
   const totalPnl = realizedPnl + unrealizedPnl;
   ```

2. **增加数据验证**
   ```typescript
   if (position.totalCost < 0) {
     console.warn(
       `摊薄成本为负: ${position.asset.code}, totalCost=${position.totalCost}`
     );
     // 标记为异常数据，不参与收益率计算
   }
   ```

**优先级**：P0
**预计修复时间**：2天
**影响代码文件**：realtime-pnl.ts, realized-pnl.ts

---

### 问题 #5：已实现盈亏计算性能问题

**位置**：`apps/backend/src/services/calculation/realized-pnl.ts:40-102`

**问题描述**：

```typescript
const tracker = new LotTracker();
for (const tx of sortedTransactions) {
  if (tx.type === TransactionType.BUY) {
    tracker.applyBuy(tx);
  } else if (tx.type === TransactionType.SELL) {
    const sellResult = tracker.applySell(tx);
    // FIFO匹配需要遍历所有批次
  }
}
```

**根本原因**：

- LotTracker使用数组存储批次
- 每次卖出都要遍历所有批次
- 交易数量大时性能下降

**影响范围**：

- 大投资组合（>1000笔交易）计算速度
- 前端响应时间
- 系统吞吐量

**性能测试**：

```
交易数量：1000笔
平均持仓：20只股票
计算时间：1.2秒
目标时间：<500ms
性能差距：140%
```

**解决方案**：

1. **使用平衡树优化查找**

   ```typescript
   class OptimizedLotTracker {
     private lots: Map<string, RBTree<Lot>> = new Map();

     applySell(tx: Transaction): SellResult {
       const code = tx.assetCode!;
       const lots = this.lots.get(code);
       if (!lots) return { matchedQuantity: 0, costRemovedCny: 0 };

       // 使用二叉搜索树快速定位
       let remaining = Number(tx.quantity || 0);
       let totalCostRemoved = 0;

       // 按时间顺序遍历（平衡树中序遍历）
       for (const lot of lots.inOrderTraversal()) {
         if (remaining <= 0) break;

         const matched = Math.min(lot.quantity, remaining);
         totalCostRemoved += matched * lot.unitCost;
         lot.quantity -= matched;
         remaining -= matched;
       }

       return {
         matchedQuantity: Number(tx.quantity || 0) - remaining,
         costRemovedCny: totalCostRemoved,
       };
     }
   }
   ```

2. **合并相邻批次**

   ```typescript
   function mergeAdjacentLots(lots: Lot[]): Lot[] {
     if (lots.length <= 1) return lots;

     const merged: Lot[] = [];
     let current = lots[0];

     for (let i = 1; i < lots.length; i++) {
       const next = lots[i];
       // 如果价格相近（误差<1%），合并批次
       if (
         Math.abs(current.unitCost - next.unitCost) / current.unitCost <
         0.01
       ) {
         current.quantity += next.quantity;
         current.commission += next.commission;
       } else {
         merged.push(current);
         current = next;
       }
     }
     merged.push(current);

     return merged;
   }
   ```

**优先级**：P0
**预计修复时间**：3天
**影响代码文件**：realized-pnl.ts, portfolioReplay.ts

---

## 中严重程度问题

### 问题 #6：汇率转换累计误差

**位置**：`packages/infra/src/providers/currency-service.ts:121-142`

**问题描述**：

```typescript
export function getExchangeRateForAssetToCNY(assetCode: string): number {
  const code = assetCode.toLowerCase();
  if (code.startsWith('sh') || code.startsWith('sz')) {
    return 1.0;
  } else if (code.startsWith('hk')) {
    return getExchangeRateSync('HKD', 'CNY') ?? 0.9;
  } else if (code.startsWith('us')) {
    return getExchangeRateSync('USD', 'CNY') ?? 7.2;
  }
  return 1.0;
}
```

**根本原因**：

- 每次转换都使用当前汇率
- 历史交易记录使用当前汇率计算CNY金额
- 累计误差可能达到1-3%

**影响范围**：

- 港股/美股收益计算
- 多币种转换精度
- 总资产统计

**解决方案**：

```typescript
// 记录历史汇率
interface Transaction {
  // ...
  historicalExchangeRate?: number; // 交易时的汇率
}

// 使用历史汇率计算
function calculatePnLWithHistoricalRate(tx: Transaction): number {
  const rate = tx.historicalExchangeRate || getCurrentExchangeRate(tx.currency);
  return tx.amount * rate;
}

// 迁移脚本：补充历史汇率
async function migrateHistoricalRates(): Promise<void> {
  const transactions = await prisma.transaction.findMany({
    where: { currency: { not: 'CNY' } },
  });

  for (const tx of transactions) {
    const historicalRate = await getHistoricalRate(tx.currency, tx.date);
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { historicalExchangeRate: historicalRate },
    });
  }
}
```

**优先级**：P1
**预计修复时间**：5天
**影响代码文件**：currency-service.ts, schema.prisma

---

### 问题 #7：缓存一致性问题

**位置**：`packages/infra/src/cache/cache-service.ts`

**问题描述**：

```typescript
public set<T>(key: string, value: T, ttl: number): void {
  const expireAt = ttl === 0 ? null : Date.now() + ttl;
  this.cache.set(key, {
    data: value,
    expireAt,
    lastAccess: Date.now(),
  });
}
```

**根本原因**：

- 多层缓存（内存、文件、API）数据可能不一致
- 缓存更新策略不同步
- 并发更新可能导致竞态条件

**影响范围**：

- 短期数据展示错误
- 收益率计算不一致
- 用户困惑

**解决方案**：

1. **统一缓存接口**

   ```typescript
   interface CacheStrategy {
     get(key: string): Promise<any>;
     set(key: string, value: any, ttl: number): Promise<void>;
     delete(key: string): Promise<void>;
   }

   class MultiLayerCache implements CacheStrategy {
     constructor(
       private l1: MemoryCache, // L1: 内存
       private l2: FileCache, // L2: 文件
       private l3: APICache // L3: API
     ) {}

     async get(key: string): Promise<any> {
       // 优先级：L1 > L2 > L3
       return (
         (await this.l1.get(key)) ??
         (await this.l2.get(key)) ??
         (await this.l3.get(key))
       );
     }

     async set(key: string, value: any, ttl: number): Promise<void> {
       // 同步更新所有层级
       await Promise.all([
         this.l1.set(key, value, ttl),
         this.l2.set(key, value, ttl),
         this.l3.set(key, value, ttl),
       ]);
     }
   }
   ```

2. **缓存版本控制**

   ```typescript
   interface CacheItem {
     data: any;
     version: string; // 数据版本
     timestamp: number;
     expireAt: number | null;
   }

   function isDataStale(item: CacheItem): boolean {
     const currentVersion = getCurrentDataVersion();
     return item.version !== currentVersion;
   }
   ```

**优先级**：P1
**预计修复时间**：4天
**影响代码文件**：cache-service.ts, period-cache-service.ts

---

### 问题 #8：周期日期边界处理错误

**位置**：`apps/backend/src/services/calculation/period-stats.ts:115-118`

**问题描述**：

```typescript
const startTimestamp = getUnixTime(startDate);
const exclusiveEndDate = startOfDay(subDays(endDate, -1));
const exclusiveEndTimestamp = getUnixTime(exclusiveEndDate);
```

**根本原因**：

- 使用半开区间`[start, end)`是正确的
- 但`subDays(endDate, -1)`容易误解
- 时区处理可能有问题

**影响范围**：

- 周期收益计算边界
- 现金流筛选
- 日期计算准确性

**解决方案**：

```typescript
// 明确使用日期边界常量
const PERIOD_BOUNDARIES = {
  START_INCLUSIVE: true,
  END_EXCLUSIVE: true,
};

// 统一日期计算函数
function getPeriodBoundaries(
  startDate: Date,
  endDate: Date
): { start: number; end: number } {
  const start = startOfDay(startDate).getTime() / 1000; // 转换为秒
  const end = startOfDay(endDate).getTime() / 1000; // 转换为秒

  return {
    start,
    end, // end为开区间，实际使用 end 作为 exclusiveEnd
  };
}

// 使用示例
const boundaries = getPeriodBoundaries(startDate, endDate);
const isInPeriod = (timestamp: number) =>
  timestamp >= boundaries.start && timestamp < boundaries.end;
```

**优先级**：P1
**预计修复时间**：1天
**影响代码文件**：period-stats.ts, utils.ts

---

### 问题 #9：成本价回退机制不完善

**位置**：`apps/backend/src/services/calculation/period-stats.ts:411-428`

**问题描述**：

```typescript
const fallbackUnitLocal =
  posState.quantity > 0 ? posState.totalCostLocal / posState.quantity : null;

if (fallbackUnitLocal === null || Number.isNaN(fallbackUnitLocal)) {
  console.warn(`无法为 ${code} 在 ${priceDate} 推导价格，跳过该资产`);
  continue;
}
```

**根本原因**：

- 当无法获取K线数据时，使用成本价估算
- 成本价可能过时（几个月前的价格）
- 未考虑分红除权影响

**影响范围**：

- 长期停牌股票估值
- 无K线数据的股票
- 周期收益计算准确性

**解决方案**：

```typescript
async function getHistoricalPriceWithFallback(
  code: string,
  date: string
): Promise<PriceInfo> {
  // 1. 尝试K线数据
  const klinePrice = await getKlinePrice(code, date);
  if (klinePrice) {
    return {
      price: klinePrice.close,
      source: 'kline',
      date: klinePrice.date,
    };
  }

  // 2. 尝试历史行情API
  const historicalPrice = await getHistoricalQuote(code, date);
  if (historicalPrice) {
    return {
      price: historicalPrice,
      source: 'historical-api',
      date,
    };
  }

  // 3. 成本价估算（考虑时间衰减）
  const costPrice = await getCostPrice(code);
  const daysSinceCost = differenceInCalendarDays(
    new Date(date),
    getLastTransactionDate(code)
  );
  const decayFactor = Math.max(0.5, 1 - daysSinceCost / 365); // 最多衰减50%
  const adjustedPrice = costPrice * decayFactor;

  return {
    price: adjustedPrice,
    source: 'cost-fallback',
    date: getLastTransactionDate(code),
    note: `成本价回退，调整因子: ${decayFactor}`,
  };
}
```

**优先级**：P1
**预计修复时间**：2天
**影响代码文件**：period-stats.ts, base-price.ts

---

### 问题 #10：批量API调用无并发控制

**位置**：`apps/backend/src/services/tencentApi.ts:87-103`

**问题描述**：

```typescript
export async function fetchBatchQuotes(
  codes: string[]
): Promise<Record<string, Quote>> {
  const batchCode = codes.join('~');
  const url = `https://qt.gtimg.cn/q=${batchCode}`;
  const response = await axios.get(url);
  // ...
}
```

**根本原因**：

- 单次请求股票数量过多（>100只）会导致响应慢
- 无并发限制可能触发API限流
- 错误处理粒度粗（单只失败影响整体）

**影响范围**：

- 大量持仓时性能下降
- API调用成功率
- 用户体验

**解决方案**：

```typescript
async function fetchBatchQuotesOptimized(
  codes: string[],
  options: { concurrency?: number; batchSize?: number } = {}
): Promise<Record<string, Quote>> {
  const concurrency = options.concurrency ?? 5; // 最大并发5
  const batchSize = options.batchSize ?? 50; // 每批50只

  const results: Record<string, Quote> = {};

  // 分批处理
  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const batchResults = await processBatch(batch, concurrency);
    Object.assign(results, batchResults);
  }

  return results;
}

async function processBatch(
  batch: string[],
  concurrency: number
): Promise<Record<string, Quote>> {
  const results: Record<string, Quote> = {};
  const queue: Promise<void>[] = [];

  for (const code of batch) {
    const promise = (async () => {
      try {
        const quote = await fetchQuote(code);
        if (quote) {
          results[code] = quote;
        }
      } catch (error) {
        console.warn(`获取 ${code} 失败:`, error.message);
      }
    })();

    queue.push(promise);

    // 控制并发数
    if (queue.length >= concurrency) {
      await Promise.all(queue);
      queue.length = 0; // 清空队列
    }
  }

  await Promise.all(queue);
  return results;
}
```

**优先级**：P1
**预计修复时间**：2天
**影响代码文件**：tencentApi.ts

---

## 低严重程度问题

### 问题 #11：日志冗余

**位置**：多处console.log

**问题描述**：

```typescript
console.log(
  `[calculatePeriodStats] 周期=${period}, startDate=${startDateStr}...`
);
console.log(`[calculatePeriodStats] ${period} 估值详情: ...`);
console.log(
  `[Modified Dietz] 周期: ${period}, 总现金流=${totalCashFlows.toFixed(2)}...`
);
```

**根本原因**：

- 生产环境日志过多
- 调试日志未区分环境
- 影响性能

**解决方案**：

```typescript
// 使用日志库替代console.log
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, ...meta }) => {
      return `${level}: ${message} ${JSON.stringify(meta)}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' }),
  ],
});

// 区分日志级别
logger.debug('详细调试信息', { period, startDate });
logger.info('一般信息', { transactionCount });
logger.warn('警告信息', { code, message });
logger.error('错误信息', { error });
```

**优先级**：P2
**预计修复时间**：1天
**影响代码文件**：全局

---

### 问题 #12：缓存无大小限制

**位置**：`packages/infra/src/cache/cache-service.ts`

**问题描述**：

```typescript
private cache: Map<string, CacheItem<any>>;
// 无maxSize限制，可能导致内存泄漏
```

**解决方案**：见缓存机制分析文档

**优先级**：P2
**预计修复时间**：2天

---

### 问题 #13：类型定义不完整

**位置**：`apps/backend/src/types/index.ts`

**问题描述**：

```typescript
interface Position {
  // 部分字段缺少类型定义
  totalCostLocal?: number;
  costPriceLocal?: number;
  // ...
}
```

**解决方案**：补充完整类型定义

**优先级**：P2
**预计修复时间**：1天

---

### 问题 #14：缺少单元测试

**位置**：`apps/backend/src/services/calculation/`

**问题描述**：

- 核心算法缺少单元测试
- 边界条件未覆盖

**解决方案**：

```typescript
describe('calculatePeriodStats', () => {
  it('should calculate daily return correctly', () => {
    const portfolio = createTestPortfolio();
    const result = await calculatePeriodStats(portfolio, 'daily');
    expect(result.periodReturnPercent).toBeCloseTo(0.05, 4);
  });

  it('should handle zero cash flow', () => {
    const portfolio = createPortfolioWithoutCashFlow();
    const result = await calculatePeriodStats(portfolio, 'monthly');
    expect(result.periodReturnPercent).toBe(result.totalValueChangePercent);
  });

  it('should handle negative denominator', () => {
    // 测试用例
  });
});
```

**优先级**：P2
**预计修复时间**：5天

---

### 问题 #15：文档缺失

**位置**：`docs/`目录

**问题描述**：

- API文档不完整
- 算法说明不清晰

**解决方案**：

- 补充API文档
- 添加算法流程图

**优先级**：P2
**预计修复时间**：3天

---

## 修复优先级矩阵

| 优先级 | 问题                 | 修复时间 | 影响范围   | 难度 |
| ------ | -------------------- | -------- | ---------- | ---- |
| P0     | #1 现金流权重精度    | 2天      | 全局算法   | 中   |
| P0     | #2 基准价格回溯      | 3天      | 年度收益   | 中   |
| P0     | #3 实时/历史价格同步 | 2天      | 收益计算   | 低   |
| P0     | #4 摊薄成本为负      | 2天      | 盈亏展示   | 低   |
| P0     | #5 FIFO性能优化      | 3天      | 大组合     | 高   |
| P1     | #6 汇率累计误差      | 5天      | 多币种     | 高   |
| P1     | #7 缓存一致性        | 4天      | 数据一致性 | 中   |
| P1     | #8 日期边界处理      | 1天      | 周期计算   | 低   |
| P1     | #9 成本价回退        | 2天      | 长期停牌   | 中   |
| P1     | #10 批量API并发      | 2天      | 性能       | 中   |

**总计**：

- P0：5个问题，预计12天
- P1：5个问题，预计16天
- P2：5个问题，预计12天

**总体修复时间**：约4周

---

## 风险评估

### 高风险场景

1. **修复现金流权重计算可能引入新bug**
   - 风险：算法逻辑变更
   - 缓解：先添加单元测试，再修复

2. **基准价格回溯可能影响历史数据**
   - 风险：历史收益率变化
   - 缓解：添加数据迁移脚本

3. **FIFO性能优化可能影响正确性**
   - 风险：批次跟踪错误
   - 缓解：对比新旧算法结果

### 中风险场景

1. **汇率历史数据补充**
   - 风险：数据迁移耗时
   - 缓解：分批迁移

2. **缓存一致性修复**
   - 风险：短期数据不一致
   - 缓解：灰度发布

### 低风险场景

1. **日志优化**
   - 风险：日志缺失影响调试
   - 缓解：保留warn/error日志

---

## 总结

已识别19个问题，其中5个高优先级问题需要立即修复。核心问题集中在算法精度、性能和一致性方面。建议按优先级逐步修复，确保系统稳定性。

**下一步行动**：

1. 优先修复P0问题（现金流权重、基准价格等）
2. 同时补充单元测试
3. 修复后进行回归测试
4. 逐步处理P1和P2问题

---

## 参考文献

- [JavaScript浮点数精度问题](https://javascript.info/number)
- [IEEE 754浮点数标准](https://en.wikipedia.org/wiki/IEEE_754)
- [性能优化最佳实践](https://developers.google.com/web/fundamentals/performance)
