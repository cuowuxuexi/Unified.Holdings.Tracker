# Modified Dietz 数学公式推导与验证

> 最后更新：2025-12-30
> 分析文件：`apps/backend/src/services/calculation/period-stats.ts:486-526`

---

## 1. 算法原理

### 1.1 背景

Modified Dietz 是一种**时间加权收益率**（Time-Weighted Rate of Return, TWRR）计算方法，用于消除外部现金流（存款/取款）对收益率的影响。相比简单收益率，它能更准确地反映投资管理的实际水平。

### 1.2 核心思想

- **简单收益率**：`R = (期末价值 - 期初价值) / 期初价值`
  - 问题：期初存入10万，期末变成11万，简单收益率 = 10%
  - 实际：投资本身可能亏损了，但存入的10万让总额看起来增长

- **Modified Dietz**：
  - 考虑每笔现金流发生的时间
  - 早期发生的现金流权重更高
  - 晚期发生的现金流权重更低
  - 更接近投资本身的真实收益

---

## 2. 数学公式推导

### 2.1 符号定义

| 符号  | 含义                | 示例           |
| ----- | ------------------- | -------------- |
| `V₀`  | 期初净值            | 100,000 CNY    |
| `V₁`  | 期末净值            | 110,000 CNY    |
| `CFᵢ` | 第i笔现金流         | 入金10,000 CNY |
| `tᵢ`  | 第i笔现金流发生时间 | 2025-06-15     |
| `T`   | 周期总时长          | 90天           |
| `wᵢ`  | 第i笔现金流权重     | 0.5            |
| `n`   | 现金流总笔数        | 3笔            |

### 2.2 权重计算公式

```
wᵢ = (T - tᵢ) / T
```

其中：

- `T`：周期总时长（秒）
- `tᵢ`：现金流发生时间距离周期开始的时间（秒）
- 结果范围：`0 ≤ wᵢ ≤ 1`

**示例**：

- 周期：2025-01-01 到 2025-03-31（T = 90天 = 7,776,000秒）
- 现金流1：2025-01-15 入金 10,000 CNY
  - `t₁ = 14天 = 1,209,600秒`
  - `w₁ = (7,776,000 - 1,209,600) / 7,776,000 = 0.844`
- 现金流2：2025-03-01 出金 5,000 CNY
  - `t₂ = 59天 = 5,097,600秒`
  - `w₂ = (7,776,000 - 5,099,600) / 7,776,000 = 0.344`

### 2.3 加权现金流公式

```
CF_weighted = Σ(CFᵢ × wᵢ)
```

**示例计算**：

```
CF₁ = +10,000 × 0.844 = +8,440
CF₂ = -5,000 × 0.344 = -1,720
CF_weighted = 8,440 - 1,720 = +6,720 CNY
```

### 2.4 Modified Dietz 收益率公式

```
R = (V₁ - V₀ - CF_total) / (V₀ + CF_weighted)
```

其中：

- `CF_total = Σ(CFᵢ)`：所有现金流总和（不加权）
- 分母：`V₀ + CF_weighted` 是"调整后的期初价值"

**完整示例**：

```
V₀ = 100,000      // 期初净值
V₁ = 110,000      // 期末净值
CF_total = 10,000 - 5,000 = +5,000  // 总现金流
CF_weighted = +6,720                // 加权现金流

R = (110,000 - 100,000 - 5,000) / (100,000 + 6,720)
  = 5,000 / 106,720
  = 4.68%
```

### 2.5 与简单收益率对比

| 指标           | 计算结果                              | 说明           |
| -------------- | ------------------------------------- | -------------- |
| 简单收益率     | `(110,000 - 100,000) / 100,000 = 10%` | 包含存取款影响 |
| Modified Dietz | `4.68%`                               | 排除存取款影响 |

---

## 3. 代码实现分析

### 3.1 关键代码段

**文件**：`apps/backend/src/services/calculation/period-stats.ts`

```typescript
// 第486-526行：Modified Dietz算法核心实现
const periodDurationSeconds = exclusiveEndTimestamp - startTimestamp;
let weightedCashFlows = 0;
let totalCashFlows = 0;

cashFlowsWithTime.forEach((cf) => {
  // 计算该现金流在周期内剩余的时间（秒）
  const remainingSeconds = exclusiveEndTimestamp - cf.timestamp;
  // 计算权重（0-1之间）
  const weight =
    periodDurationSeconds > 0 ? remainingSeconds / periodDurationSeconds : 0;
  // 累加加权现金流
  weightedCashFlows += cf.amount * weight;
  totalCashFlows += cf.amount;
});

let periodReturnPercent: number | null = null;
if (startValue > 0) {
  const denominator = startValue + weightedCashFlows;
  if (Math.abs(denominator) > 1e-9) {
    periodReturnPercent =
      (endValue - startValue - totalCashFlows) / denominator;
  }
}
```

### 3.2 变量映射

| 代码变量                | 数学符号      | 含义                 |
| ----------------------- | ------------- | -------------------- |
| `startValue`            | `V₀`          | 期初净值             |
| `endValue`              | `V₁`          | 期末净值             |
| `totalCashFlows`        | `CF_total`    | 总现金流             |
| `weightedCashFlows`     | `CF_weighted` | 加权现金流           |
| `periodDurationSeconds` | `T`           | 周期总时长（秒）     |
| `cf.timestamp`          | `tᵢ`          | 现金流发生时间戳     |
| `weight`                | `wᵢ`          | 现金流权重           |
| `periodReturnPercent`   | `R`           | Modified Dietz收益率 |

### 3.3 关键逻辑解析

#### 3.3.1 时间戳转换

```typescript
const startTimestamp = getUnixTime(startDate); // 期初时间戳
const exclusiveEndDate = startOfDay(subDays(endDate, -1)); // 期末+1天
const exclusiveEndTimestamp = getUnixTime(exclusiveEndDate); // 期末时间戳

const periodDurationSeconds = exclusiveEndTimestamp - startTimestamp;
```

**关键点**：

- 使用 `getUnixTime()` 将日期转换为秒级时间戳
- 使用 `exclusiveEndDate` 实现**半开区间**：`[start, end)`
- 周期时长计算：`T = end_timestamp - start_timestamp`

#### 3.3.2 现金流权重计算

```typescript
cashFlowsWithTime.forEach((cf) => {
  const remainingSeconds = exclusiveEndTimestamp - cf.timestamp;
  const weight =
    periodDurationSeconds > 0 ? remainingSeconds / periodDurationSeconds : 0;
  weightedCashFlows += cf.amount * weight;
});
```

**关键点**：

- `remainingSeconds`：现金流到期末的剩余时间
- `weight`：0-1之间的权重，期初现金流权重高，期末现金流权重低
- `weightedCashFlows`：累加加权现金流

#### 3.3.3 分母处理

```typescript
const denominator = startValue + weightedCashFlows;
if (Math.abs(denominator) > 1e-9) {
  periodReturnPercent = (endValue - startValue - totalCashFlows) / denominator;
}
```

**关键点**：

- 分母不能为0或接近0（`1e-9` 是容差）
- 分母 = 期初净值 + 加权现金流
- 使用 `Math.abs()` 处理负数分母情况

---

## 4. 边界条件分析

### 4.1 期初价值为0

```typescript
if (startValue > 0) {
  // 只有期初价值 > 0 时才计算收益率
}
```

**场景**：新投资组合，初始现金为0，然后立即入金投资

**处理**：无法计算收益率（分母为0），返回 `null`

### 4.2 分母接近0

```typescript
if (Math.abs(denominator) > 1e-9) {
  // 容差：1e-9（约0.000000001）
}
```

**场景**：期初价值很小，且有大量现金流

**处理**：避免除以极小数导致的收益率异常

### 4.3 周期时长为0

```typescript
const weight =
  periodDurationSeconds > 0 ? remainingSeconds / periodDurationSeconds : 0;
```

**场景**：期初和期末是同一天

**处理**：所有权重设为0，不计算收益率

### 4.4 现金流发生在期末

```typescript
const remainingSeconds = exclusiveEndTimestamp - cf.timestamp;
```

**场景**：最后一天入金

**计算**：

- `remainingSeconds = end_timestamp - end_timestamp = 0`
- `weight = 0 / T = 0`
- 结论：期末现金流对收益率无影响（合理）

---

## 5. 双指标系统

项目中实现了**两套收益率指标**：

### 5.1 净值变化率（含存取款）

```typescript
const totalValueChange = endValue - startValue;
const totalValueChangePercent =
  startValue > 0 ? totalValueChange / startValue : null;
```

**含义**：包含所有现金流影响的简单收益率

**用途**：反映投资组合账面价值的变化

### 5.2 投资收益率（Modified Dietz）

```typescript
const periodReturnPercent =
  (endValue - startValue - totalCashFlows) / (startValue + weightedCashFlows);
```

**含义**：排除现金流影响的真实投资收益率

**用途**：反映投资管理的真实水平

### 5.3 对比示例

| 场景           | 净值变化率 | 投资收益率 | 说明                   |
| -------------- | ---------- | ---------- | ---------------------- |
| 入金后投资亏损 | +5%        | -2%        | 账面增值但实际投资失败 |
| 出金后投资盈利 | -3%        | +8%        | 账面缩水但实际投资成功 |
| 纯投资无存取款 | +10%       | +10%       | 两种指标相同           |

---

## 6. 潜在问题识别

### 6.1 浮点精度问题

**问题**：JavaScript浮点数计算存在精度损失

**位置**：第497-500行

```typescript
const weight = remainingSeconds / periodDurationSeconds;
weightedCashFlows += cf.amount * weight;
```

**风险**：

- 权重计算可能略有偏差
- 多次累加后误差放大

**影响**：收益率计算可能有0.01%-0.1%的偏差

**验证方法**：

```javascript
// 使用固定精度的十进制库（如decimal.js）
// 或使用整数计算（将金额转换为分、厘）
```

### 6.2 时间戳时区问题

**问题**：使用 `getUnixTime()` 可能受时区影响

**位置**：第115-118行

```typescript
const startTimestamp = getUnixTime(startDate);
const exclusiveEndTimestamp = getUnixTime(exclusiveEndDate);
```

**风险**：

- 如果日期对象包含时区信息，计算可能不准确
- 夏令时切换可能导致时长计算错误

**建议**：

```typescript
// 确保使用UTC时间戳
const startTimestamp = Math.floor(startDate.getTime() / 1000);
```

### 6.3 现金流筛选边界

**问题**：现金流时间范围筛选逻辑

**位置**：第134-140行

```typescript
const periodTransactions = sortedTransactions.filter((tx) => {
  const txTimestamp = getUnixTime(new Date(tx.date));
  return txTimestamp >= startTimestamp && txTimestamp < exclusiveEndTimestamp;
});
```

**分析**：

- 使用半开区间 `[start, end)` 是正确的
- 确保期初现金流被包含（`>= startTimestamp`）
- 确保期末现金流不被包含（`< exclusiveEndTimestamp`）

---

## 7. 验证方法

### 7.1 手工验证步骤

1. **准备测试数据**

   ```
   期初：2025-01-01，净值 100,000 CNY
   期末：2025-03-31，净值 105,000 CNY
   现金流1：2025-01-15 入金 10,000 CNY
   现金流2：2025-02-15 入金 10,000 CNY
   ```

2. **计算权重**

   ```
   T = 90天 = 7,776,000秒
   CF1: w = (7,776,000 - 1,209,600) / 7,776,000 = 0.844
   CF2: w = (7,776,000 - 3,801,600) / 7,776,000 = 0.511
   CF_weighted = 10,000×0.844 + 10,000×0.511 = 13,550
   ```

3. **计算收益率**
   ```
   R = (105,000 - 100,000 - 20,000) / (100,000 + 13,550)
     = -15,000 / 113,550
     = -13.21%
   ```

### 7.2 代码验证

对比手工计算与代码计算结果：

```typescript
// 在calculatePeriodStats中添加调试日志
console.log('手工验证:', {
  startValue: 100000,
  endValue: 105000,
  totalCashFlows: 20000,
  weightedCashFlows: 13550,
  periodReturnPercent: -0.1321,
});

// 对比代码计算的periodReturnPercent
```

---

## 8. 改进建议

### 8.1 高优先级

1. **添加浮点精度控制**

   ```typescript
   // 使用toFixed控制输出精度
   periodReturnPercent = parseFloat(
     ((endValue - startValue - totalCashFlows) / denominator).toFixed(6)
   );
   ```

2. **增强边界条件处理**
   ```typescript
   if (startValue <= 0 && Math.abs(totalCashFlows) < 1e-6) {
     // 期初为0且无现金流，返回0%而不是null
     return { periodReturnPercent: 0, periodPnl: 0 };
   }
   ```

### 8.2 中优先级

3. **添加单元测试**
   - 测试各种现金流场景
   - 测试边界条件
   - 对比手工计算结果

4. **优化性能**
   - 缓存现金流权重计算结果
   - 避免重复遍历现金流数组

### 8.3 低优先级

5. **添加收益率年化**
   ```typescript
   // 将周期收益率年化
   const annualizedReturn =
     Math.pow(1 + periodReturnPercent, 252 / tradingDays) - 1;
   ```

---

## 9. 总结

Modified Dietz算法实现基本正确，核心逻辑符合数学原理。需要注意的关键点：

1. **权重计算**：正确使用了时间加权方法
2. **双指标系统**：区分了净值变化和投资收益率
3. **边界条件**：处理了分母为0等异常情况
4. **潜在问题**：浮点精度和时间戳时区

**建议优先修复**：

- 浮点精度控制
- 边界条件优化
- 增加单元测试

---

## 参考文献

- [Modified Dietz Method - Wikipedia](https://en.wikipedia.org/wiki/Dietz_method)
- [CFA Institute - Time-Weighted Rate of Return](https://www.cfainstitute.org/en/programs/cfa/curriculum)
- [GIPS Standards - Time-Weighted Return](https://www.gipsstandards.org/)
