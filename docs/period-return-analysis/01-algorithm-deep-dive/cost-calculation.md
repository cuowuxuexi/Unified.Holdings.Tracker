# 摊薄成本法详解

> 最后更新：2025-12-30
> 分析文件：`apps/backend/src/services/calculation/realtime-pnl.ts`

---

## 1. 摊薄成本法概述

### 1.1 定义

摊薄成本法（Diluted Cost Method）是一种计算持仓成本的会计方法，通过将所有买入和卖出交易的影响综合起来，计算出当前的**摊薄成本**。

### 1.2 核心公式

```
摊薄成本 = 累计买入成本 - 累计卖出收入
         = Σ(买入价格 × 买入数量) - Σ(卖出价格 × 卖出数量)
```

### 1.3 特点

- **可负性**：摊薄成本可能为负数（卖出收入超过买入成本）
- **累计性**：包含所有历史交易的影响
- **简单性**：计算逻辑简单，易于理解

---

## 2. 相关概念对比

### 2.1 三种成本概念

| 概念             | 计算方式            | 用途         | 可为负？ |
| ---------------- | ------------------- | ------------ | -------- |
| **摊薄成本**     | 累计买入 - 累计卖出 | 总盈亏计算   | ✅ 是    |
| **累计买入成本** | 仅累加买入          | 收益率分母   | ❌ 否    |
| **成本价**       | 摊薄成本 / 持仓数量 | 浮动盈亏参考 | ✅ 是    |

### 2.2 为什么要用三种成本？

**摊薄成本**：

- 用于计算总盈亏：`总盈亏 = 市值 - 摊薄成本`
- 优点：包含所有交易，能准确反映当前盈亏
- 问题：可能为负，导致收益率计算异常

**累计买入成本**：

- 用于计算收益率：`收益率 = 盈亏 / 累计买入成本`
- 优点：永远为正，避免除零或负数
- 问题：不反映真实盈亏，只用于百分比计算

**成本价**：

- 用于计算浮动盈亏：`浮动盈亏 = (现价 - 成本价) × 数量`
- 优点：直观显示每只股票的盈亏情况
- 问题：受卖出入影响，可能不准确

---

## 3. 代码实现分析

### 3.1 函数签名

```typescript
export function calculateRealtimePnl(
  positions: Position[],
  quotes: Record<string, Quote>
): Position[];
```

**分析**：

- ✅ 输入：持仓数组 + 行情映射
- ✅ 输出：更新后的持仓数组（包含盈亏信息）
- ✅ 纯函数：无副作用，返回新对象

### 3.2 核心变量初始化（第24-31行）

```typescript
return positions.map((position) => {
  const quote = quotes[position.asset.code];
  const currency =
    position.currency || getCurrencyForAsset(position.asset.code);
  const updatedPosition: Position = {
    ...position,
    currency,
  }; // 创建副本避免修改原对象

  // ... 计算逻辑
});
```

**分析**：

- ✅ 使用 `map` 遍历，确保返回新数组
- ✅ 使用扩展运算符创建对象副本（不可变）
- ✅ 获取货币类型（支持多币种）

### 3.3 市值计算（第33-46行）

```typescript
if (quote && quote.currentPrice != null) {
  updatedPosition.currentPrice = quote.currentPrice;
  // Update asset name from the quote if available
  if (quote.name) {
    updatedPosition.asset = { ...updatedPosition.asset, name: quote.name };
  }

  const exchangeRate = getExchangeRateForAssetToCNY(position.asset.code);
  const marketValueLocal = quote.currentPrice * position.quantity;
  const marketValueCny = marketValueLocal * exchangeRate;

  updatedPosition.marketValueLocal = marketValueLocal;
  updatedPosition.marketValue = marketValueCny;
  updatedPosition.marketValueCNY = marketValueCny;
}
```

**分析**：

- ✅ 检查 `quote` 存在且 `currentPrice` 不为 null
- ✅ 更新资产名称（从行情数据获取）
- ✅ 计算原币种市值和CNY市值
- ✅ 三种字段都设置：兼容性考虑

---

## 4. 摊薄成本法实现（第48-78行）

### 4.1 总盈亏计算

```typescript
// 总盈亏 = 市值 - 摊薄成本（摊薄成本可为负数）
updatedPosition.totalPnl = marketValueCny - (position.totalCost || 0);
if (typeof position.totalCostLocal === 'number') {
  updatedPosition.totalPnlLocal = marketValueLocal - position.totalCostLocal;
}
```

**分析**：

- ✅ 核心公式：`totalPnl = 市值 - 摊薄成本`
- ✅ 同时计算原币种和CNY的盈亏
- ✅ 使用 `position.totalCost || 0` 处理 undefined
- ⚠️ 摊薄成本可能为负，导致总盈亏异常大

### 4.2 浮动盈亏计算

```typescript
// 浮动盈亏（与雪球一致）= (现价 - 成本价) × 数量
// 必须在同一币种下计算：原币种计算后转CNY，避免币种混淆
if (typeof position.costPriceLocal === 'number') {
  // 港股/美股：使用原币种成本价计算
  const floatingPnlLocal =
    (quote.currentPrice - position.costPriceLocal) * position.quantity;
  updatedPosition.floatingPnlLocal = floatingPnlLocal;
  updatedPosition.floatingPnl = floatingPnlLocal * exchangeRate;
} else {
  // A股：CNY直接计算
  const costPrice = position.costPrice || 0;
  updatedPosition.floatingPnl =
    (quote.currentPrice - costPrice) * position.quantity;
  updatedPosition.floatingPnlLocal = updatedPosition.floatingPnl;
}
```

**分析**：

- ✅ 区分A股和港股/美股的计算方式
- ✅ A股：直接用CNY计算
- ✅ 港股/美股：先算原币种，再转CNY
- ⚠️ `costPriceLocal` 可能为 undefined，需要检查

### 4.3 盈亏百分比计算

```typescript
// 计算盈亏百分比：使用 totalBuyCost（累计买入成本）作为分母
// 这样即使摊薄成本为负数，收益率计算也不会出错
// 公式：totalPnlPercent = totalPnl / totalBuyCost
const denominator = position.totalBuyCost ?? position.totalCost ?? 0;
updatedPosition.totalPnlPercent =
  denominator !== 0 ? updatedPosition.totalPnl / denominator : 0;
updatedPosition.floatingPnlPercent =
  denominator !== 0 ? updatedPosition.floatingPnl / denominator : 0;
```

**分析**：

- ✅ 使用 `totalBuyCost`（累计买入成本）作为分母
- ✅ 优先使用 `totalBuyCost`，备用 `totalCost`
- ✅ 检查分母不为0，避免除零错误
- ✅ 同时计算总盈亏百分比和浮动盈亏百分比

### 4.4 当日盈亏计算

```typescript
// Calculate daily PnL based on changeAmount if available
if (quote.changeAmount != null) {
  const dailyChangeLocal = quote.changeAmount * position.quantity;
  updatedPosition.dailyChangeLocal = dailyChangeLocal;
  updatedPosition.dailyChange = dailyChangeLocal * exchangeRate;
} else {
  updatedPosition.dailyChange = undefined;
  updatedPosition.dailyChangeLocal = undefined;
}
updatedPosition.dailyChangePercent = quote.changePercent ?? undefined;
updatedPosition.weeklyChangePercent = quote.weekChangePercent ?? undefined;
updatedPosition.monthlyChangePercent = quote.monthChangePercent ?? undefined;
updatedPosition.yearlyChangePercent = quote.yearlyChangePercent ?? undefined;
```

**分析**：

- ✅ 使用 `changeAmount` 计算当日盈亏
- ✅ 赋值多种周期涨跌幅
- ✅ 使用空值合并操作符处理 undefined

---

## 5. 摊薄成本示例分析

### 5.1 基础示例

**交易记录**：

```
2025-01-01: 买入 100股 @ 10元 = 1000元
2025-01-15: 买入 100股 @ 12元 = 1200元
2025-02-01: 卖出 50股 @ 15元 = 750元
2025-02-15: 当前价 = 13元
```

**成本计算**：

```
累计买入成本 = 1000 + 1200 = 2200元
累计卖出收入 = 750元
摊薄成本 = 2200 - 750 = 1450元

当前持仓 = 100 + 100 - 50 = 150股
成本价 = 1450 / 150 = 9.67元
```

**盈亏计算**：

```
市值 = 150 × 13 = 1950元
总盈亏 = 1950 - 1450 = 500元
浮动盈亏 = (13 - 9.67) × 150 = 500元

总盈亏百分比 = 500 / 2200 = 22.73%
浮动盈亏百分比 = 500 / 2200 = 22.73%
```

### 5.2 摊薄成本为负示例

**交易记录**：

```
2025-01-01: 买入 100股 @ 10元 = 1000元
2025-01-15: 卖出 150股 @ 20元 = 3000元  // 超额卖出
2025-02-15: 当前价 = 15元
```

**成本计算**：

```
累计买入成本 = 1000元
累计卖出收入 = 3000元
摊薄成本 = 1000 - 3000 = -2000元  // 为负！

当前持仓 = 100 - 150 = -50股  // 异常情况
```

**问题**：

- 摊薄成本为负 -2000元
- 如果计算总盈亏：市值 - (-2000) = 市值 + 2000
- 收益率：(市值 + 2000) / 2200 = 100%+
- **结论**：摊薄成本为负时，收益率计算异常

**解决方案**：

- 使用累计买入成本作为分母：500 / 1000 = 50%
- 这样即使摊薄成本为负，收益率也正常

---

## 6. 多币种处理

### 6.1 港股示例

**交易记录**（港币）：

```
2025-01-01: 买入 1000股 @ 10 HKD = 10,000 HKD
2025-02-15: 当前价 = 12 HKD
汇率: 1 HKD = 0.9 CNY
```

**成本计算**：

```
原币种市值 = 1000 × 12 = 12,000 HKD
CNY市值 = 12,000 × 0.9 = 10,800 CNY

原币种成本价 = 10 HKD
CNY成本价 = 10 × 0.9 = 9 CNY

浮动盈亏（原币种）= (12 - 10) × 1000 = 2,000 HKD
浮动盈亏（CNY）= 2,000 × 0.9 = 1,800 CNY
```

**代码逻辑**：

```typescript
// 第57-62行
if (typeof position.costPriceLocal === 'number') {
  const floatingPnlLocal =
    (quote.currentPrice - position.costPriceLocal) * position.quantity;
  updatedPosition.floatingPnlLocal = floatingPnlLocal;
  updatedPosition.floatingPnl = floatingPnlLocal * exchangeRate;
}
```

**分析**：

- ✅ 先计算原币种盈亏
- ✅ 再乘以汇率转CNY
- ✅ 避免币种混淆

### 6.2 美股示例

**交易记录**（美元）：

```
2025-01-01: 买入 10股 @ 100 USD = 1,000 USD
2025-02-15: 当前价 = 120 USD
汇率: 1 USD = 7.2 CNY
```

**成本计算**：

```
原币种市值 = 10 × 120 = 1,200 USD
CNY市值 = 1,200 × 7.2 = 8,640 CNY

浮动盈亏（USD）= (120 - 100) × 10 = 200 USD
浮动盈亏（CNY）= 200 × 7.2 = 1,440 CNY
```

---

## 7. 边界条件分析

### 7.1 成本价为0

```typescript
const costPrice = position.costPrice || 0;
updatedPosition.floatingPnl =
  (quote.currentPrice - costPrice) * position.quantity;
```

**场景**：新买入的股票，成本价为0

**处理**：

- 浮动盈亏 = 现价 × 数量
- 收益率 = 100%+
- **结论**：合理，因为刚买入就涨

### 7.2 数量为0

```typescript
if (posState.quantity <= 0) continue; // 在 calcValue 中
```

**场景**：已全部卖出的股票

**处理**：

- 跳过计算（不计算盈亏）
- **结论**：合理，因为无持仓

### 7.3 行情数据缺失

```typescript
if (quote && quote.currentPrice != null) {
  // 计算盈亏
} else {
  console.warn(
    `Quote not found or invalid for ${position.asset.code}, cannot calculate real-time PnL.`
  );
  // 不计算盈亏，保持原值
}
```

**场景**：无法获取行情数据

**处理**：

- 记录警告日志
- 不更新盈亏字段
- **结论**：合理，避免使用错误数据

---

## 8. 潜在问题识别

### 8.1 摊薄成本为负问题

**问题**：摊薄成本可能为负数，导致总盈亏计算异常

**位置**：第49行

```typescript
updatedPosition.totalPnl = marketValueCny - (position.totalCost || 0);
```

**示例**：

```
摊薄成本 = -2000元
市值 = 1500元
总盈亏 = 1500 - (-2000) = 3500元  // 异常大
```

**影响**：

- 总盈亏虚高
- 收益率计算错误
- 用户看到异常数据

**解决方案**：

- ✅ 已解决：使用 `totalBuyCost` 作为分母
- ⚠️ 但 `totalPnl` 字段仍有负数问题

### 8.2 汇率转换时机问题

**问题**：汇率转换时机可能导致误差

**位置**：第40行

```typescript
const exchangeRate = getExchangeRateForAssetToCNY(position.asset.code);
```

**分析**：

- 使用当前汇率计算市值
- 如果成本价使用历史汇率，会产生误差
- **建议**：记录买入时的汇率，用于精确计算

### 8.3 成本价未更新问题

**问题**：卖出后成本价未及时更新

**场景**：

```
买入 100股 @ 10元
卖出 50股 @ 15元
当前价 12元

期望成本价 = 10元（因为还有50股）
实际成本价 = ?（需要看实现）
```

**分析**：

- 浮动盈亏应使用当前持仓的成本价
- 总盈亏应使用摊薄成本
- **代码实现**：使用 `position.costPriceLocal`，这是正确的

---

## 9. 与雪球对比

### 9.1 雪球的盈亏计算

雪球使用**加权平均成本法**：

```
成本价 = 总成本 / 总数量
浮动盈亏 = (现价 - 成本价) × 数量
```

### 9.2 本项目的实现

本项目使用**摊薄成本法**：

```
摊薄成本 = 累计买入 - 累计卖出
总盈亏 = 市值 - 摊薄成本
浮动盈亏 = (现价 - 成本价) × 数量
```

### 9.3 差异对比

| 指标     | 雪球             | 本项目          | 说明           |
| -------- | ---------------- | --------------- | -------------- |
| 总盈亏   | 使用加权平均成本 | 使用摊薄成本    | 本项目更准确   |
| 浮动盈亏 | 一致             | 一致            | 都用成本价计算 |
| 收益率   | 总盈亏/成本      | 总盈亏/累计买入 | 本项目避免负数 |

---

## 10. 验证方法

### 10.1 手工验证步骤

1. **准备测试数据**

   ```
   持仓：100股，成本价10元，市价12元
   ```

2. **计算市值**

   ```
   市值 = 100 × 12 = 1200元
   ```

3. **计算摊薄成本**

   ```
   摊薄成本 = 100 × 10 = 1000元
   ```

4. **计算盈亏**
   ```
   总盈亏 = 1200 - 1000 = 200元
   浮动盈亏 = (12 - 10) × 100 = 200元
   盈亏百分比 = 200 / 1000 = 20%
   ```

### 10.2 代码验证

```typescript
const position = {
  asset: { code: '000001', name: '平安银行' },
  quantity: 100,
  totalCost: 1000,
  totalCostLocal: 1000,
  totalBuyCost: 1000,
  costPrice: 10,
  costPriceLocal: 10,
};

const quote = {
  currentPrice: 12,
  changePercent: 0.2,
};

const result = calculateRealtimePnl([position], { '000001': quote });
console.log(result[0]);
```

**期望输出**：

```typescript
{
  marketValue: 1200,
  totalPnl: 200,
  floatingPnl: 200,
  totalPnlPercent: 0.2,
  floatingPnlPercent: 0.2,
  // ...
}
```

---

## 11. 改进建议

### 11.1 高优先级

1. **添加摊薄成本为负的检测**

   ```typescript
   if (position.totalCost < 0) {
     console.warn(
       `摊薄成本为负：${position.asset.code}, totalCost=${position.totalCost}`
     );
   }
   ```

2. **增强边界条件处理**
   ```typescript
   if (position.quantity === 0) {
     // 跳过盈亏计算
     return updatedPosition;
   }
   ```

### 11.2 中优先级

3. **记录历史汇率**

   ```typescript
   interface Position {
     // ...
     historicalRates?: Record<string, number>; // 日期->汇率
   }
   ```

4. **添加单元测试**
   ```typescript
   describe('calculateRealtimePnl', () => {
     it('should calculate PnL correctly', () => {
       // 测试用例
     });
   });
   ```

### 11.3 低优先级

5. **性能优化**
   ```typescript
   // 缓存汇率查询结果
   const exchangeRates = new Map<string, number>();
   const getExchangeRate = (code: string) => {
     if (!exchangeRates.has(code)) {
       exchangeRates.set(code, getExchangeRateForAssetToCNY(code));
     }
     return exchangeRates.get(code)!;
   };
   ```

---

## 12. 总结

摊薄成本法是本项目计算盈亏的核心方法，优点是准确反映当前盈亏状况，缺点是可能为负导致收益率计算异常。项目巧妙地使用累计买入成本作为分母，既保证了准确性，又避免了计算异常。

**关键指标**：

- ✅ 算法正确性：9/10
- ✅ 多币种支持：8/10
- ⚠️ 边界条件处理：7/10
- ✅ 代码可读性：8/10

**需改进**：

- 摊薄成本为负的检测和提示
- 历史汇率记录
- 单元测试覆盖

---

## 参考文献

- [会计中的成本法 - Investopedia](https://www.investopedia.com/terms/c/costmethod.asp)
- [加权平均成本法 vs 先进先出法](https://www.investopedia.com/ask/answers/ weighted-average-cost-flow-assumption-vs-fifo/)
- [雪球盈亏计算原理](https://xueqiu.com/)
