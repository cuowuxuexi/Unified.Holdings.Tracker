# 重构路线图

> 最后更新：2025-12-30
> 基于问题诊断结果制定的分阶段重构计划

---

## 重构策略

### 核心原则

1. **渐进式重构**：分阶段进行，避免一次性大改动
2. **向后兼容**：确保旧数据和新算法兼容
3. **充分测试**：每阶段完成后进行全面测试
4. **灰度发布**：逐步推广到所有用户

### 总体时间线

```
Phase 1: 算法优化          (Week 1-2)
Phase 2: 数据质量提升      (Week 3-4)
Phase 3: 性能优化          (Week 5-6)
Phase 4: 监控与测试        (Week 7-8)
```

---

## Phase 1: 算法优化 (Week 1-2)

### Week 1: 现金流权重计算修复

#### Day 1-2: 代码审查与测试设计

**任务清单**：

- [ ] 阅读period-stats.ts完整代码
- [ ] 设计测试用例（覆盖所有边界条件）
- [ ] 创建基准数据集（手工计算结果）

**测试用例设计**：

```typescript
interface TestCase {
  name: string;
  input: {
    startDate: string;
    endDate: string;
    cashFlows: CashFlow[];
    startValue: number;
    endValue: number;
  };
  expected: {
    periodReturnPercent: number;
    weightedCashFlows: number;
  };
}

const testCases: TestCase[] = [
  {
    name: '期初入金',
    input: {
      startDate: '2025-01-01',
      endDate: '2025-03-31',
      cashFlows: [
        {
          date: '2025-01-01',
          amount: 10000,
          timestamp: new Date('2025-01-01').getTime() / 1000,
        },
      ],
      startValue: 10000,
      endValue: 11000,
    },
    expected: {
      periodReturnPercent: 0.1, // 10%
      weightedCashFlows: 10000, // 权重1.0
    },
  },
  {
    name: '期末出金',
    input: {
      startDate: '2025-01-01',
      endDate: '2025-03-31',
      cashFlows: [
        {
          date: '2025-03-31',
          amount: -5000,
          timestamp: new Date('2025-03-31').getTime() / 1000,
        },
      ],
      startValue: 10000,
      endValue: 6000,
    },
    expected: {
      periodReturnPercent: 0.1, // 10%
      weightedCashFlows: 0, // 权重0
    },
  },
];
```

#### Day 3-4: 实现定点数计算

**修改文件**：`apps/backend/src/services/calculation/period-stats.ts`

```typescript
// 方案1: 使用Decimal.js
import Decimal from 'decimal.js';

// 修改现金流权重计算
cashFlowsWithTime.forEach((cf) => {
  const remainingSeconds = exclusiveEndTimestamp - cf.timestamp;
  const weight =
    periodDurationSeconds > 0
      ? new Decimal(remainingSeconds).div(periodDurationSeconds)
      : new Decimal(0);

  // 使用Decimal进行精确计算
  const weightedAmount = new Decimal(cf.amount).mul(weight);
  weightedCashFlows = weightedCashFlows.add(weightedAmount).toNumber();
  totalCashFlows += cf.amount;
});

// 修改收益率计算
const denominator = new Decimal(startValue).add(weightedCashFlows).toNumber();
if (Math.abs(denominator) > 1e-9) {
  const numerator = new Decimal(endValue)
    .sub(startValue)
    .sub(totalCashFlows)
    .toNumber();
  periodReturnPercent = numerator / denominator;
}
```

**验证步骤**：

```bash
# 运行测试
npm test -- period-stats.test.ts

# 对比新旧算法结果
npm run compare-algorithms
```

#### Day 5: 单元测试与验证

**任务清单**：

- [ ] 编写单元测试（使用Jest）
- [ ] 运行所有测试用例
- [ ] 性能测试（对比修改前后的计算时间）
- [ ] 手工验证关键测试用例

**单元测试示例**：

```typescript
describe('Modified Dietz with Decimal', () => {
  testCases.forEach((tc) => {
    it(`should calculate correctly for: ${tc.name}`, async () => {
      const result = await calculatePeriodStats(
        createTestPortfolio(tc.input),
        'total'
      );

      expect(result.periodReturnPercent).toBeCloseTo(
        tc.expected.periodReturnPercent,
        6
      );
    });
  });
});
```

### Week 2: 基准价格回溯优化

#### Day 8-10: 增加回溯天数

**修改文件**：`apps/backend/src/services/calculation/base-price.ts`

```typescript
// 修改前
const KLINE_LOOKBACK_DAYS = 15;

// 修改后
const KLINE_LOOKBACK_DAYS = 120; // 增加到120天

// 增加多数据源策略
async function getBasePriceWithFallback(
  code: string,
  anchorDate: Date,
  maxLookbackDays: number
): Promise<{ price: number | null; date: string | null }> {
  // 尝试主数据源
  const primaryResult = await getBasePrice(code, anchorDate, maxLookbackDays);
  if (primaryResult.price) {
    return primaryResult;
  }

  // 尝试备用数据源
  const backupSources = [
    () => getBasePriceFromSina(code, anchorDate, maxLookbackDays),
    () => getBasePriceFromEastmoney(code, anchorDate, maxLookbackDays),
  ];

  for (const source of backupSources) {
    try {
      const result = await source();
      if (result.price) {
        console.warn(`[getBasePrice] ${code} 使用备用数据源`);
        return result;
      }
    } catch (error) {
      console.warn(`备用数据源失败:`, error);
    }
  }

  // 最后回退：使用成本价
  return await getCostBasedPrice(code, anchorDate);
}
```

#### Day 11-12: 预加载基准价格

**任务清单**：

- [ ] 创建定时任务（每日20点执行）
- [ ] 预加载下一年的基准价格
- [ ] 缓存策略优化

**实现代码**：

```typescript
// 定时预加载任务
schedule.scheduleJob('0 20 * * *', async () => {
  console.log('开始预加载基准价格...');

  const portfolios = await portfolioRepository.findAll();
  const allCodes = new Set<string>();

  // 收集所有股票代码
  for (const p of portfolios) {
    const positions = await portfolioRepository.getPositions(p.id);
    positions.forEach((pos) => allCodes.add(pos.asset.code));
  }

  // 预加载基准价格
  const batchSize = 50;
  for (let i = 0; i < allCodes.size; i += batchSize) {
    const batch = Array.from(allCodes).slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (code) => {
        try {
          await getYearBasePrice(code);
          console.log(`预加载完成: ${code}`);
        } catch (error) {
          console.warn(`预加载失败: ${code}`, error);
        }
      })
    );
  }

  console.log('基准价格预加载完成');
});
```

---

## Phase 2: 数据质量提升 (Week 3-4)

### Week 3: 数据验证增强

#### Day 15-17: 实现数据验证器

**新增文件**：`apps/backend/src/utils/data-validator.ts`

```typescript
export class DataValidator {
  static validateQuote(quote: Quote): ValidationResult {
    const errors: string[] = [];

    // 1. 必要字段检查
    if (!quote.code) errors.push('缺少股票代码');
    if (!quote.name) errors.push('缺少股票名称');
    if (quote.currentPrice == null) errors.push('缺少当前价格');

    // 2. 数值范围检查
    if (quote.currentPrice != null && quote.currentPrice < 0) {
      errors.push('当前价格不能为负');
    }

    if (quote.changePercent != null && Math.abs(quote.changePercent) > 1) {
      errors.push('涨跌幅超出合理范围');
    }

    // 3. 逻辑一致性检查
    if (quote.changePercent != null && quote.changeAmount != null) {
      const expectedChange = quote.currentPrice - (quote.prevClosePrice || 0);
      if (Math.abs(quote.changeAmount - expectedChange) > 0.01) {
        errors.push('涨跌额计算不一致');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      cleaned: this.cleanQuote(quote),
    };
  }

  static cleanQuote(quote: Quote): Quote {
    const cleaned = { ...quote };

    // 清理异常值
    if (cleaned.currentPrice < 0) cleaned.currentPrice = 0;
    if (cleaned.volume < 0) cleaned.volume = 0;
    if (cleaned.turnover < 0) cleaned.turnover = 0;

    // 补全默认值
    cleaned.volume ??= 0;
    cleaned.turnover ??= 0;
    cleaned.prevClosePrice ??= cleaned.currentPrice;

    return cleaned;
  }
}
```

#### Day 18-19: 集成验证器

**修改文件**：`apps/backend/src/services/tencentApi.ts`

```typescript
export async function fetchQuote(code: string): Promise<Quote | null> {
  try {
    const response = await axios.get(`https://qt.gtimg.cn/q=${code}`);
    const rawQuote = parseQuoteFromResponse(response.data);

    // 验证并清理数据
    const validation = DataValidator.validateQuote(rawQuote);
    if (!validation.valid) {
      console.warn(
        `[fetchQuote] 数据验证失败: ${validation.errors.join(', ')}`
      );
      return null;
    }

    return validation.cleaned;
  } catch (error) {
    console.error(`[fetchQuote] 获取 ${code} 失败:`, error);
    return null;
  }
}
```

### Week 4: 重试机制实现

#### Day 22-24: 添加重试逻辑

**新增文件**：`apps/backend/src/utils/retry.ts`

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    backoffFactor?: number;
    maxDelay?: number;
  } = {}
): Promise<T> {
  const {
    retries = 3,
    delay = 1000,
    backoffFactor = 2,
    maxDelay = 10000,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === retries) {
        throw error;
      }

      // 计算延迟时间（指数退避）
      const currentDelay = Math.min(
        delay * Math.pow(backoffFactor, attempt),
        maxDelay
      );

      console.warn(
        `[withRetry] 第${attempt + 1}次尝试失败，${currentDelay}ms后重试: ${error.message}`
      );

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
    }
  }

  throw lastError!;
}
```

**修改文件**：`apps/backend/src/services/tencentApi.ts`

```typescript
import { withRetry } from '../utils/retry';

export async function fetchQuote(code: string): Promise<Quote | null> {
  return withRetry(
    async () => {
      const response = await axios.get(`https://qt.gtimg.cn/q=${code}`, {
        timeout: 5000,
      });
      return parseQuoteFromResponse(response.data);
    },
    {
      retries: 3,
      delay: 1000,
      maxDelay: 5000,
    }
  );
}
```

---

## Phase 3: 性能优化 (Week 5-6)

### Week 5: FIFO算法优化

#### Day 29-31: 实现平衡树LotTracker

**修改文件**：`apps/backend/src/services/portfolioReplay.ts`

```typescript
interface Lot {
  quantity: number;
  unitCost: number;
  commission: number;
  timestamp: number;
}

class OptimizedLotTracker {
  private lots: Map<string, Lot[]> = new Map();

  applyBuy(tx: Transaction): void {
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

    const codeLots = this.lots.get(code)!;

    // 尝试与最后一个批次合并（如果价格相近）
    const lastLot = codeLots[codeLots.length - 1];
    if (
      lastLot &&
      Math.abs(lastLot.unitCost - lot.unitCost) / lastLot.unitCost < 0.01
    ) {
      // 合并批次
      const totalQuantity = lastLot.quantity + lot.quantity;
      lastLot.unitCost =
        (lastLot.quantity * lastLot.unitCost + lot.quantity * lot.unitCost) /
        totalQuantity;
      lastLot.commission += lot.commission;
      lastLot.quantity = totalQuantity;
    } else {
      codeLots.push(lot);
    }
  }

  applySell(tx: Transaction): SellResult {
    const code = tx.assetCode!;
    const sellQuantity = Number(tx.quantity || 0);
    const sellPrice = Number(tx.price || 0);
    let remaining = sellQuantity;
    let totalCostRemoved = 0;

    const codeLots = this.lots.get(code) || [];

    // FIFO：按时间顺序卖出
    for (let i = 0; i < codeLots.length && remaining > 0; i++) {
      const lot = codeLots[i];
      if (lot.quantity <= 0) continue;

      const matched = Math.min(lot.quantity, remaining);
      totalCostRemoved +=
        matched * (lot.unitCost + lot.commission / lot.quantity);
      lot.quantity -= matched;
      remaining -= matched;
    }

    // 清理空批次
    this.lots.set(
      code,
      codeLots.filter((lot) => lot.quantity > 0)
    );

    return {
      matchedQuantity: sellQuantity - remaining,
      costRemovedCny: totalCostRemoved,
    };
  }
}
```

**性能测试**：

```typescript
// 性能测试脚本
async function benchmarkLotTracker(): Promise<void> {
  const transactionCount = 1000;
  const tracker = new OptimizedLotTracker();

  // 生成测试数据
  const testTransactions = generateTestTransactions(transactionCount);

  // 测试执行时间
  const start = Date.now();
  for (const tx of testTransactions) {
    if (tx.type === 'BUY') {
      tracker.applyBuy(tx);
    } else if (tx.type === 'SELL') {
      tracker.applySell(tx);
    }
  }
  const duration = Date.now() - start;

  console.log(`处理${transactionCount}笔交易耗时: ${duration}ms`);
  console.log(`平均每笔: ${duration / transactionCount}ms`);

  // 目标: < 0.5ms/笔
  const avgPerTx = duration / transactionCount;
  if (avgPerTx > 0.5) {
    console.warn(`性能未达标: ${avgPerTx}ms/笔 (目标: <0.5ms/笔)`);
  } else {
    console.log(`✅ 性能达标`);
  }
}
```

### Week 6: 批量API优化

#### Day 36-38: 实现并发控制

**修改文件**：`apps/backend/src/services/tencentApi.ts`

```typescript
export async function fetchBatchQuotes(
  codes: string[],
  options: { concurrency?: number; batchSize?: number } = {}
): Promise<Record<string, Quote>> {
  const concurrency = options.concurrency ?? 5;
  const batchSize = options.batchSize ?? 50;

  const results: Record<string, Quote> = {};
  const errors: Array<{ code: string; error: string }> = [];

  // 分批处理
  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const batchResults = await processBatchWithConcurrency(batch, concurrency);

    // 合并结果
    Object.assign(results, batchResults.success);

    // 记录错误
    errors.push(...batchResults.errors);
  }

  if (errors.length > 0) {
    console.warn(`批量获取完成，${errors.length}个失败:`, errors);
  }

  return results;
}

async function processBatchWithConcurrency(
  batch: string[],
  concurrency: number
): Promise<{
  success: Record<string, Quote>;
  errors: Array<{ code: string; error: string }>;
}> {
  const results: Record<string, Quote> = {};
  const errors: Array<{ code: string; error: string }> = [];

  // 控制并发数
  const queue: Promise<void>[] = [];

  for (const code of batch) {
    const promise = (async () => {
      try {
        const quote = await fetchQuote(code);
        if (quote) {
          results[code] = quote;
        } else {
          errors.push({ code, error: '获取失败' });
        }
      } catch (error) {
        errors.push({ code, error: (error as Error).message });
      }
    })();

    queue.push(promise);

    // 等待并发槽位
    if (queue.length >= concurrency) {
      await Promise.all(queue);
      queue.length = 0;
    }
  }

  // 等待剩余任务
  await Promise.all(queue);

  return { success: results, errors };
}
```

---

## Phase 4: 监控与测试 (Week 7-8)

### Week 7: 监控体系

#### Day 43-45: 实现数据质量监控

**新增文件**：`apps/backend/src/monitoring/data-quality-monitor.ts`

```typescript
export class DataQualityMonitor {
  private metrics = {
    totalRequests: 0,
    successRequests: 0,
    formatErrors: 0,
    missingFields: 0,
    responseTimes: [] as number[],
  };

  async checkTencentAPI(): Promise<APICheckResult> {
    const start = Date.now();
    try {
      const response = await withRetry(
        () => axios.get('https://qt.gtimg.cn/q=sh600519', { timeout: 5000 }),
        { retries: 2 }
      );

      const duration = Date.now() - start;
      this.metrics.totalRequests++;
      this.metrics.successRequests++;
      this.metrics.responseTimes.push(duration);

      return {
        status: 'ok',
        responseTime: duration,
        timestamp: new Date(),
      };
    } catch (error) {
      const duration = Date.now() - start;
      this.metrics.totalRequests++;
      this.metrics.formatErrors++;

      return {
        status: 'error',
        error: (error as Error).message,
        responseTime: duration,
        timestamp: new Date(),
      };
    }
  }

  getReport(): QualityReport {
    const avgResponseTime =
      this.metrics.responseTimes.reduce((a, b) => a + b, 0) /
      this.metrics.responseTimes.length;

    return {
      successRate: this.metrics.successRequests / this.metrics.totalRequests,
      errorRate: this.metrics.formatErrors / this.metrics.totalRequests,
      avgResponseTime,
      dataCompleteness:
        (this.metrics.successRequests - this.metrics.missingFields) /
        this.metrics.totalRequests,
    };
  }
}

// 定时监控
setInterval(async () => {
  const monitor = new DataQualityMonitor();
  const report = await monitor.checkTencentAPI();

  if (report.status === 'error') {
    console.error('[API监控] 异常:', report);
    // 发送告警
    await sendAlert('腾讯API异常', report);
  }
}, 60000); // 每分钟检查
```

### Week 8: 完整测试

#### Day 50-52: 集成测试

**新增文件**：`apps/backend/src/tests/integration/period-stats.integration.test.ts`

```typescript
describe('Period Stats Integration Tests', () => {
  let portfolioRepository: PortfolioRepository;
  let marketDataProvider: MarketDataProvider;

  beforeAll(async () => {
    portfolioRepository = new PrismaPortfolioRepository(prisma);
    marketDataProvider = new TencentMarketDataProvider();
  });

  test('should calculate accurate period return for real portfolio', async () => {
    // 使用真实投资组合数据测试
    const portfolio = await portfolioRepository.findById('test-portfolio-id');
    expect(portfolio).toBeDefined();

    const result = await calculatePeriodStats(portfolio, 'monthly', {
      quotes: await marketDataProvider.getBatchQuotes(['sh600519', 'sz000001']),
    });

    // 验证结果合理性
    expect(result.periodReturnPercent).toBeGreaterThan(-1);
    expect(result.periodReturnPercent).toBeLessThan(10);
    expect(result.baseDate).toBeDefined();
  });

  test('should handle edge cases gracefully', async () => {
    // 测试各种边界条件
    const edgeCases = [
      { name: 'zero positions', portfolio: createPortfolioWithZeroPositions() },
      {
        name: 'single transaction',
        portfolio: createPortfolioWithSingleTransaction(),
      },
      {
        name: 'large cash flow',
        portfolio: createPortfolioWithLargeCashFlow(),
      },
    ];

    for (const tc of edgeCases) {
      const result = await calculatePeriodStats(tc.portfolio, 'monthly');
      expect(result).toBeDefined();
      expect(result.periodReturnPercent).not.toBeNaN();
    }
  });
});
```

#### Day 53-54: 性能测试

**新增文件**：`apps/backend/src/tests/performance/calculation.performance.test.ts`

```typescript
describe('Calculation Performance Tests', () => {
  test('should calculate large portfolio within 500ms', async () => {
    const largePortfolio = createLargePortfolio({
      transactions: 5000,
      positions: 100,
    });

    const start = Date.now();
    const result = await calculatePeriodStats(largePortfolio, 'total');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(500);
    console.log(`大投资组合计算耗时: ${duration}ms`);

    // 验证结果正确性
    expect(result.periodReturnPercent).not.toBeNaN();
  });

  test('should handle concurrent requests', async () => {
    const portfolios = Array.from({ length: 10 }, (_, i) =>
      createTestPortfolio(`portfolio-${i}`)
    );

    const start = Date.now();
    await Promise.all(
      portfolios.map((p) => calculatePeriodStats(p, 'monthly'))
    );
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(2000);
    console.log(`10个并发请求耗时: ${duration}ms`);
  });
});
```

---

## 验收标准

### Phase 1 验收

- [ ] 所有测试用例通过（包括手工验证）
- [ ] 现金流权重计算精度提升至0.001%
- [ ] 基准价格获取成功率 > 99%
- [ ] 性能无明显下降（<10%）

### Phase 2 验收

- [ ] 数据验证覆盖率 > 95%
- [ ] API错误率 < 1%
- [ ] 重试机制工作正常
- [ ] 数据质量告警正常

### Phase 3 验收

- [ ] FIFO算法性能提升 > 50%
- [ ] 批量API成功率 > 98%
- [ ] 并发处理能力提升 > 100%
- [ ] 无内存泄漏

### Phase 4 验收

- [ ] 监控指标完整
- [ ] 集成测试通过率 = 100%
- [ ] 性能测试达标
- [ ] 文档完整

---

## 风险控制

### 回滚策略

1. **代码分支管理**

   ```bash
   git checkout -b feature/period-stats-optimization
   # 开发和测试
   git merge --no-ff main  # 合并时保留分支历史
   ```

2. **功能开关**

   ```typescript
   const FEATURE_FLAGS = {
     USE_DECIMAL_CALCULATION: process.env.USE_DECIMAL === 'true',
     ENHANCED_BASE_PRICE: process.env.ENHANCED_BASE_PRICE === 'true',
   };
   ```

3. **数据备份**
   - 修复前备份数据库
   - 保留旧算法实现作为参考

### 测试策略

1. **单元测试**：覆盖所有修改的代码
2. **集成测试**：端到端验证
3. **性能测试**：确保性能不下降
4. **回归测试**：验证现有功能

### 发布策略

1. **灰度发布**
   - 先发布给10%用户
   - 监控24小时无异常后扩大范围
   - 逐步推广至100%

2. **快速回滚**
   - 保留一键回滚脚本
   - 监控关键指标
   - 异常时立即回滚

---

## 总结

本重构路线图分4个阶段，总计8周时间，从算法优化到监控完善，系统性解决已识别的问题。每个阶段都有明确的验收标准和风险控制措施，确保重构成功。

**关键成功因素**：

1. 充分测试
2. 渐进式重构
3. 持续监控
4. 快速响应

**预期收益**：

- 收益计算精度提升至0.001%
- 系统性能提升50%+
- 数据质量显著改善
- 可维护性增强

---

## 参考文献

- [重构指南](https://refactoring.com/)
- [渐进式重构策略](https://martinfowler.com/articles/is-quality-worth-cost.html)
- [性能优化最佳实践](https://web.dev/performance/)
- [监控与告警设计](https://sre.google/sre-book/monitoring-distributed-systems/)
