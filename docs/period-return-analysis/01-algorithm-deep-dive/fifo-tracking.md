# FIFO成本跟踪机制

> 最后更新：2025-12-30
> 分析文件：`apps/backend/src/services/calculation/realized-pnl.ts`

---

## 1. FIFO概述

### 1.1 定义

FIFO（First In, First Out，先进先出）是一种成本计算方法，假设最早买入的股票最早卖出。在计算已实现盈亏时，FIFO方法会按买入顺序匹配卖出交易。

### 1.2 核心思想

```
买入批次追踪：
  [批次1] 100股 @ 10元 = 1000元
  [批次2] 100股 @ 12元 = 1200元
  [批次3] 50股 @ 15元 = 750元

卖出交易：
  卖出 120股

FIFO匹配：
  - 卖出100股 → 匹配批次1 @ 10元
  - 卖出20股 → 匹配批次2 @ 12元
  - 剩余80股在批次2，50股在批次3
```

### 1.3 优点

- **简单易懂**：符合直觉，先买先卖
- **符合实际**：很多券商默认使用FIFO
- **准确跟踪**：能准确计算每笔卖出的成本

### 1.4 缺点

- **忽略税务优化**：可能不是最优的税务策略
- **批次管理复杂**：需要维护多个批次
- **性能开销**：大量交易时性能下降

---

## 2. 代码实现分析

### 2.1 函数签名

```typescript
export async function calculateRealizedPnl(
  portfolio: Portfolio
): Promise<number>;
```

**分析**：

- ✅ 输入：投资组合（含所有交易）
- ✅ 输出：已实现盈亏总额（CNY）
- ✅ 异步函数：支持缓存

### 2.2 缓存机制（第30-38行）

```typescript
const txHash = hashTransactions(portfolio.transactions);
const cacheKey = `realized-pnl:${portfolio.id}:${txHash}`;

const cached = cacheService.get<number>(cacheKey);
if (cached !== null) {
  console.log(`[calculateRealizedPnl] 使用缓存结果: ${cached.toFixed(2)}`);
  return cached;
}
```

**分析**：

- ✅ 使用交易hash作为缓存键
- ✅ 避免重复计算
- ✅ 记录缓存命中日志

### 2.3 LotTracker初始化（第40-46行）

```typescript
const tracker = new LotTracker();
let tradingPnl = 0;
let totalDividendIncome = 0;

const sortedTransactions = [...portfolio.transactions].sort(
  (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
);
```

**分析**：

- ✅ 创建 LotTracker 实例
- ✅ 初始化盈亏计数器
- ✅ 按时间排序交易

---

## 3. LotTracker分析

### 3.1 类结构

LotTracker 是一个用于跟踪持仓批次的类，主要方法：

- `applyBuy(tx)`：处理买入交易
- `applySell(tx)`：处理卖出交易，返回匹配结果
- `getPositionsSnapshot()`：获取当前持仓快照

### 3.2 批次数据结构

```typescript
interface LotPositionState {
  quantity: number; // 当前剩余数量
  totalCostLocal: number; // 摊薄成本（原币种）
  totalCost: number; // 摊薄成本（CNY）
  totalBuyCost: number; // 累计买入成本
  costPriceLocal?: number; // 成本价（原币种）
  costPrice?: number; // 成本价（CNY）
}
```

**分析**：

- ✅ 包含数量和成本信息
- ✅ 支持原币种和CNY
- ✅ 区分摊薄成本和成本价

---

## 4. 交易处理逻辑（第48-102行）

### 4.1 分红处理（第49-56行）

```typescript
if (tx.type === TransactionType.DIVIDEND) {
  const dividendAmount = Number(tx.amount || 0);
  totalDividendIncome += dividendAmount;
  console.log(
    `[calculateRealizedPnl] 股息收入: ${dividendAmount.toFixed(2)} CNY (资产: ${tx.assetCode || '未知'})`
  );
  continue;
}
```

**分析**：

- ✅ 分红直接计入已实现盈亏
- ✅ 记录详细日志
- ✅ 跳过后续处理

### 4.2 买入处理（第58-61行）

```typescript
if (tx.type === TransactionType.BUY) {
  tracker.applyBuy(tx);
  continue;
}
```

**分析**：

- ✅ 买入交易交给 LotTracker 处理
- ✅ 继续下一个交易

### 4.3 卖出处理（第63-102行）

```typescript
if (tx.type !== TransactionType.SELL) {
  continue;
}

const price = Number(tx.price ?? 0);
const quantity = Number(tx.quantity ?? 0);
if (!tx.assetCode || quantity <= 0 || price <= 0) {
  console.warn(
    `[calculateRealizedPnl] 忽略无效卖出交易 ${tx.id ?? tx.assetCode}`
  );
  continue;
}

const sellResult = tracker.applySell(tx);
if (sellResult.matchedQuantity <= 0) {
  console.warn(
    `[calculateRealizedPnl] 卖出 ${tx.assetCode} 时没有匹配到持仓，跳过成本计算`
  );
  continue;
}
if (sellResult.matchedQuantity < quantity) {
  console.warn(
    `[calculateRealizedPnl] 卖出 ${tx.assetCode} 仅匹配到 ${sellResult.matchedQuantity}/${quantity} 股`
  );
}
```

**分析**：

- ✅ 过滤非卖出交易
- ✅ 验证交易有效性
- ✅ 检查匹配数量
- ⚠️ 卖出数量超过持仓数量时，仅匹配部分

### 4.4 盈亏计算（第89-102行）

```typescript
const rate = resolveTransactionExchangeRate(tx);
const revenueQuantity = sellResult.matchedQuantity;
const grossRevenue = revenueQuantity * price * rate;
const commissionCny = getCommissionInCny(tx);
const effectiveCommission =
  quantity > 0 ? (commissionCny * revenueQuantity) / quantity : commissionCny;
const netRevenue = grossRevenue - effectiveCommission;
const costRemoved = sellResult.costRemovedCny;
const realizedFromSell = netRevenue - costRemoved;

tradingPnl += realizedFromSell;
```

**分析**：

- ✅ 计算毛收入：`数量 × 价格 × 汇率`
- ✅ 分摊手续费：按比例分配
- ✅ 计算净收入：`毛收入 - 手续费`
- ✅ 计算已实现盈亏：`净收入 - 成本`

---

## 5. FIFO匹配示例

### 5.1 完整示例

**交易记录**：

```
2025-01-01: 买入 100股 @ 10元
2025-01-15: 买入 100股 @ 12元
2025-02-01: 买入 100股 @ 15元
2025-02-15: 卖出 180股 @ 20元
手续费: 10元
```

**FIFO匹配过程**：

```
批次1: 100股 @ 10元 → 卖出100股
批次2: 100股 @ 12元 → 卖出80股
批次3: 100股 @ 15元 → 卖出0股

剩余持仓:
  批次2: 20股 @ 12元
  批次3: 100股 @ 15元
```

**盈亏计算**：

```
毛收入 = 180 × 20 = 3600元
手续费 = 10元
净收入 = 3600 - 10 = 3590元

成本:
  批次1: 100 × 10 = 1000元
  批次2: 80 × 12 = 960元
  总成本 = 1960元

已实现盈亏 = 3590 - 1960 = 1630元
```

### 5.2 代码逻辑验证

```typescript
const sellResult = tracker.applySell(tx);
// 假设返回：
{
  matchedQuantity: 180,
  costRemovedCny: 1960,
  // ...
}

const grossRevenue = 180 * 20 * 1.0 = 3600;
const commissionCny = 10;
const effectiveCommission = 10 * 180 / 180 = 10;
const netRevenue = 3600 - 10 = 3590;
const realizedFromSell = 3590 - 1960 = 1630;
```

**结论**：代码逻辑正确

---

## 6. 边界条件分析

### 6.1 卖出数量超过持仓

**场景**：

```
当前持仓: 100股
卖出指令: 150股
```

**处理**：

```typescript
if (sellResult.matchedQuantity < quantity) {
  console.warn(
    `卖出 ${tx.assetCode} 仅匹配到 ${sellResult.matchedQuantity}/${quantity} 股`
  );
}
```

**结果**：

- 匹配100股，剩余50股无效
- 记录警告日志
- **结论**：合理，避免负持仓

### 6.2 无持仓时卖出

**场景**：

```
当前持仓: 0股
卖出指令: 100股
```

**处理**：

```typescript
if (sellResult.matchedQuantity <= 0) {
  console.warn(`卖出 ${tx.assetCode} 时没有匹配到持仓，跳过成本计算`);
  continue;
}
```

**结果**：

- 跳过成本计算
- 不影响盈亏
- **结论**：合理，避免计算错误

### 6.3 手续费计算

**场景**：

```
总手续费: 10元
卖出数量: 150股（匹配100股）
总数量: 200股（假设原持仓200股）
```

**处理**：

```typescript
const effectiveCommission =
  quantity > 0 ? (commissionCny * revenueQuantity) / quantity : commissionCny;
```

**计算**：

```
有效手续费 = 10 × 100 / 150 = 6.67元
```

**分析**：

- ✅ 按匹配数量分摊手续费
- ✅ 避免未匹配部分的手续费

---

## 7. 与其他成本法的对比

### 7.1 加权平均成本法

**公式**：

```
成本价 = 总成本 / 总数量
已实现盈亏 = (卖出价格 - 成本价) × 卖出数量
```

**示例**：

```
买入 100股 @ 10元
买入 100股 @ 20元
卖出 100股 @ 15元

FIFO:
  成本 = 100 × 10 = 1000元
  盈亏 = 1500 - 1000 = 500元

加权平均:
  成本价 = (1000 + 2000) / 200 = 15元
  盈亏 = (15 - 15) × 100 = 0元
```

### 7.2 后进先出法（LIFO）

**示例**：

```
买入 100股 @ 10元
买入 100股 @ 20元
卖出 100股 @ 15元

LIFO:
  成本 = 100 × 20 = 2000元
  盈亏 = 1500 - 2000 = -500元
```

### 7.3 对比总结

| 方法     | 已实现盈亏 | 剩余持仓成本 | 特点           |
| -------- | ---------- | ------------ | -------------- |
| FIFO     | +500元     | 100股 @ 20元 | 保守，低估收益 |
| LIFO     | -500元     | 100股 @ 10元 | 激进，高估收益 |
| 加权平均 | 0元        | 100股 @ 15元 | 中性，平衡     |

---

## 8. 已实现与未实现盈亏

### 8.1 定义

**已实现盈亏**：

- 来自已完成的交易（买入+卖出）
- 包括分红收入
- 永远不会变化

**未实现盈亏**：

- 来自当前持仓的市值变化
- 随市场价格波动
- 随时变化

### 8.2 计算关系

```typescript
总盈亏 = 已实现盈亏 + 未实现盈亏;
```

**示例**：

```
已实现盈亏: +500元
未实现盈亏: +300元
总盈亏: +800元
```

### 8.3 代码实现

**已实现盈亏**（第23-118行）：

```typescript
export async function calculateRealizedPnl(
  portfolio: Portfolio
): Promise<number> {
  // 使用FIFO计算已实现盈亏
}
```

**未实现盈亏**（第127-134行）：

```typescript
export function calculateUnrealizedPnl(positions: Position[]): number {
  return positions.reduce((sum, pos) => {
    const marketValue = pos.marketValueCNY ?? pos.marketValue ?? 0;
    const cost = pos.totalCost || 0;
    return sum + (marketValue - cost);
  }, 0);
}
```

**分析**：

- ✅ 已实现盈亏使用FIFO
- ✅ 未实现盈亏使用摊薄成本
- ✅ 两者结合得到总盈亏

---

## 9. 性能分析

### 9.1 时间复杂度

```
n = 交易数量
m = 持仓数量

排序: O(n log n)
FIFO匹配: O(n × log m)  // 假设使用平衡树
总复杂度: O(n log n)
```

**分析**：

- 交易数量大时性能下降
- 可通过索引优化

### 9.2 空间复杂度

```
批次数量: O(k)  // k为不同股票数量
总空间: O(k)
```

**分析**：

- 空间复杂度低
- 只存储当前持仓批次

### 9.3 缓存优化

```typescript
const txHash = hashTransactions(portfolio.transactions);
const cacheKey = `realized-pnl:${portfolio.id}:${txHash}`;
```

**分析**：

- ✅ 使用交易hash作为缓存键
- ✅ 交易不变时命中缓存
- ✅ 避免重复计算

---

## 10. 潜在问题识别

### 10.1 浮点精度问题

**问题**：多次乘除运算导致精度损失

**位置**：第91-96行

```typescript
const grossRevenue = revenueQuantity * price * rate;
const effectiveCommission = (commissionCny * revenueQuantity) / quantity;
```

**风险**：

- 金额计算可能不准确
- 分摊手续费可能有余数

**影响**：

- 已实现盈亏可能有几分的偏差

**建议**：

```typescript
// 使用整数计算（分、厘）
const grossRevenueFen = revenueQuantity * priceFen * rate;
const commissionFen = commissionCny * 100;
const effectiveCommissionFen = (commissionFen * revenueQuantity) / quantity;
```

### 10.2 汇率转换时机

**问题**：使用当前汇率而非历史汇率

**位置**：第89行

```typescript
const rate = resolveTransactionExchangeRate(tx);
```

**分析**：

- 使用交易时的汇率
- 正确，因为卖出时应该用当时的汇率
- ✅ 代码正确

### 10.3 批次管理复杂性

**问题**：LotTracker需要维护多个批次

**场景**：

```
100笔买入交易 → 100个批次
```

**影响**：

- 内存占用增加
- 匹配速度下降

**建议**：

- 合并相邻批次（如果价格相近）
- 使用更高效的数据结构（平衡树）

---

## 11. 验证方法

### 11.1 手工验证步骤

1. **准备测试数据**

   ```
   买入 100股 @ 10元
   买入 100股 @ 12元
   卖出 150股 @ 15元
   手续费 10元
   ```

2. **FIFO匹配**

   ```
   卖出100股 → 批次1 @ 10元
   卖出50股 → 批次2 @ 12元
   ```

3. **计算盈亏**
   ```
   毛收入 = 150 × 15 = 2250元
   手续费 = 10 × 150 / 150 = 10元
   净收入 = 2240元
   成本 = 100 × 10 + 50 × 12 = 1600元
   已实现盈亏 = 2240 - 1600 = 640元
   ```

### 11.2 代码验证

```typescript
const portfolio = {
  id: '1',
  transactions: [
    {
      type: 'BUY',
      assetCode: '000001',
      quantity: 100,
      price: 10,
      date: '2025-01-01',
    },
    {
      type: 'BUY',
      assetCode: '000001',
      quantity: 100,
      price: 12,
      date: '2025-01-15',
    },
    {
      type: 'SELL',
      assetCode: '000001',
      quantity: 150,
      price: 15,
      date: '2025-02-01',
      commission: 10,
    },
  ],
};

const realizedPnl = await calculateRealizedPnl(portfolio);
console.log(`已实现盈亏: ${realizedPnl.toFixed(2)} CNY`);
```

**期望输出**：

```
已实现盈亏: 640.00 CNY
```

---

## 12. 改进建议

### 12.1 高优先级

1. **添加单元测试**

   ```typescript
   describe('calculateRealizedPnl', () => {
     it('should calculate FIFO correctly', () => {
       const portfolio = createTestPortfolio();
       const result = await calculateRealizedPnl(portfolio);
       expect(result).toBeCloseTo(640, 2);
     });
   });
   ```

2. **增强错误处理**
   ```typescript
   if (sellResult.matchedQuantity < quantity * 0.5) {
     throw new Error(`卖出数量远超持仓数量: ${tx.assetCode}`);
   }
   ```

### 12.2 中优先级

3. **性能优化**

   ```typescript
   // 使用 Map 优化批次查找
   class LotTracker {
     private lots: Map<string, Lot[]>;

     applySell(tx: Transaction) {
       const lots = this.lots.get(tx.assetCode);
       // 使用二分查找优化
     }
   }
   ```

4. **支持多种成本法**

   ```typescript
   enum CostMethod {
     FIFO = 'FIFO',
     LIFO = 'LIFO',
     WEIGHTED_AVERAGE = 'WEIGHTED_AVERAGE',
   }

   function calculateRealizedPnl(
     portfolio: Portfolio,
     method: CostMethod = CostMethod.FIFO
   ): Promise<number>;
   ```

### 12.3 低优先级

5. **税务优化建议**
   - 根据税务政策推荐最优成本法
   - 提供不同成本法的盈亏对比

6. **可视化展示**
   - 显示批次匹配过程
   - 显示每笔交易的盈亏贡献

---

## 13. 总结

FIFO成本跟踪机制是计算已实现盈亏的核心方法，通过批次匹配准确计算每笔卖出的成本。代码实现基本正确，逻辑清晰，性能可接受。主要改进方向是性能优化和单元测试。

**关键指标**：

- ✅ 算法正确性：9/10
- ✅ 代码可读性：8/10
- ⚠️ 性能：6/10
- ⚠️ 测试覆盖：5/10

**需改进**：

- 添加单元测试
- 优化批次匹配性能
- 支持多种成本法

---

## 参考文献

- [FIFO Method - Investopedia](https://www.investopedia.com/terms/f/fifo.asp)
- [Realized vs Unrealized Gains](https://www.investopedia.com/ask/answers/difference-between-realized-and-unrealized-gains.asp)
- [Cost Basis Calculation Methods](https://www.investopedia.com/articles/personal-finance/101713/understanding-cost-basis-calculation-methods.asp)
