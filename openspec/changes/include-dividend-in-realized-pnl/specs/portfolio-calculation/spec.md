# Delta Spec: Portfolio Calculation - Include Dividend in Realized PnL

## MODIFIED Requirements

### Requirement: 已实现盈亏计算
系统 **SHALL** 计算投资组合的已实现盈亏（Realized Profit and Loss），包括：
1. **买卖价差**：所有卖出收入减去对应的买入成本（使用加权平均成本法）
2. **股息收入**：所有 DIVIDEND 类型交易的金额（已换算为 CNY）

已实现盈亏反映所有已经"落袋为安"的收益，包括通过卖出股票实现的资本利得和收到的股息现金收入。

**计算公式**：
```
已实现盈亏 = 交易盈亏 + 股息收入
交易盈亏 = Σ(卖出收入 - 对应的买入成本)
股息收入 = Σ(DIVIDEND 交易的 amount 字段)
```

**成本计算方法**：
- 使用加权平均成本法（Weighted Average Cost）
- 每次买入：累加成本 = 价格 × 数量 + 手续费（换算为 CNY）
- 每次卖出：平均成本 = 累计买入成本 / 累计买入数量
- 已实现盈亏 += 卖出收入 - 平均成本 × 卖出数量

**汇率处理**：
- 所有金额换算为投资组合基础货币（CNY）
- DIVIDEND 交易的 amount 字段已在存储时换算为 CNY
- 买卖交易的价格根据资产代码推断币种并换算

#### Scenario: 仅有买卖交易，无股息
- **GIVEN** 投资组合有以下交易：
  - 买入 sh600000 数量 100，价格 10.00 CNY，手续费 5 CNY
  - 卖出 sh600000 数量 100，价格 12.00 CNY，手续费 5 CNY
- **WHEN** 调用 `calculateRealizedPnl(portfolio)`
- **THEN** 返回：
  - 买入成本 = 100 × 10.00 + 5 = 1005 CNY
  - 卖出收入 = 100 × 12.00 - 5 = 1195 CNY
  - 交易盈亏 = 1195 - 1005 = 190 CNY
  - 股息收入 = 0 CNY
  - **已实现盈亏 = 190 CNY**

#### Scenario: 有买卖交易和股息收入
- **GIVEN** 投资组合有以下交易：
  - 买入 sh600000 数量 100，价格 10.00 CNY，手续费 5 CNY
  - DIVIDEND 交易，amount = 50 CNY（已换算）
  - 卖出 sh600000 数量 100，价格 12.00 CNY，手续费 5 CNY
- **WHEN** 调用 `calculateRealizedPnl(portfolio)`
- **THEN** 返回：
  - 交易盈亏 = 190 CNY（同上）
  - 股息收入 = 50 CNY
  - **已实现盈亏 = 190 + 50 = 240 CNY**

#### Scenario: 多笔股息收入
- **GIVEN** 投资组合有以下交易：
  - DIVIDEND 交易 #1，amount = 30 CNY
  - DIVIDEND 交易 #2，amount = 20 CNY
  - DIVIDEND 交易 #3，amount = 50 CNY
- **WHEN** 调用 `calculateRealizedPnl(portfolio)`
- **THEN** 返回：
  - 交易盈亏 = 0 CNY（无买卖交易）
  - 股息收入 = 30 + 20 + 50 = 100 CNY
  - **已实现盈亏 = 100 CNY**

#### Scenario: 外币股息收入（港股）
- **GIVEN** 投资组合有以下交易：
  - 买入 hk00700 数量 100，价格 400.00 HKD，手续费 50 HKD
  - DIVIDEND 交易，assetCode = hk00700，amount = 500 CNY（已按汇率换算）
  - 卖出 hk00700 数量 100，价格 450.00 HKD，手续费 50 HKD
- **WHEN** 调用 `calculateRealizedPnl(portfolio)`
- **THEN** 返回：
  - 交易盈亏 = （按当前汇率计算，例如 HKD to CNY = 0.9）
  - 股息收入 = 500 CNY（已换算，直接使用）
  - **已实现盈亏 = 交易盈亏 + 500 CNY**

#### Scenario: 部分卖出，剩余持仓
- **GIVEN** 投资组合有以下交易：
  - 买入 sh600000 数量 200，价格 10.00 CNY，手续费 10 CNY
  - DIVIDEND 交易，amount = 50 CNY
  - 卖出 sh600000 数量 100，价格 12.00 CNY，手续费 5 CNY
- **WHEN** 调用 `calculateRealizedPnl(portfolio)`
- **THEN** 返回：
  - 总买入成本 = 200 × 10.00 + 10 = 2010 CNY
  - 平均成本 = 2010 / 200 = 10.05 CNY/股
  - 卖出 100 股对应成本 = 100 × 10.05 = 1005 CNY
  - 卖出收入 = 100 × 12.00 - 5 = 1195 CNY
  - 交易盈亏 = 1195 - 1005 = 190 CNY
  - 股息收入 = 50 CNY
  - **已实现盈亏 = 190 + 50 = 240 CNY**
  - 剩余持仓：100 股，剩余成本 = 1005 CNY

#### Scenario: 日志输出
- **GIVEN** 投资组合有买卖交易和股息交易
- **WHEN** 调用 `calculateRealizedPnl(portfolio)`
- **THEN** 控制台输出应包含：
  ```
  [calculateRealizedPnl] 股息收入: {amount} CNY (资产: {assetCode})
  [calculateRealizedPnl] 交易盈亏: {tradingPnl} CNY, 股息收入: {totalDividendIncome} CNY, 总已实现盈亏: {totalRealizedPnl} CNY
  ```

## ADDED Requirements

### Requirement: 股息收入独立查询
系统 **SHALL** 继续提供 `calculateTotalDividendIncome` 函数，用于单独查询股息收入总额。

此函数的返回值不受 `calculateRealizedPnl` 修改的影响，用于前端单独显示"股息收入"指标。

#### Scenario: 查询股息收入总额
- **GIVEN** 投资组合有以下交易：
  - DIVIDEND 交易 #1，amount = 30 CNY
  - DIVIDEND 交易 #2，amount = 20 CNY
  - BUY 交易（不影响股息统计）
- **WHEN** 调用 `calculateTotalDividendIncome(portfolio)`
- **THEN** 返回 50 CNY

## MODIFIED Requirements

### Requirement: 累计盈亏计算
系统 **SHALL** 计算投资组合的累计盈亏（Total Profit and Loss），包括：
1. **已实现盈亏**：所有买卖价差 + 股息收入（修改后自动包含股息）
2. **未实现盈亏**：当前持仓市值 - 当前持仓成本

**计算公式**：
```
累计盈亏 = 已实现盈亏 + 未实现盈亏
```

修改后，累计盈亏将自动包含股息收入，无需额外调整。

#### Scenario: 累计盈亏包含股息
- **GIVEN** 投资组合有以下数据：
  - 已实现盈亏（包括股息）= 240 CNY
  - 未实现盈亏 = 100 CNY
- **WHEN** 调用 `calculateTotalPnlV2(portfolio, positions)`
- **THEN** 返回：
  - realizedPnl = 240 CNY
  - unrealizedPnl = 100 CNY
  - **totalPnl = 340 CNY**

#### Scenario: 数据一致性验证
- **GIVEN** 投资组合有以下数据：
  - 净入金 = 10000 CNY
  - 现金余额 = 5000 CNY
  - 持仓市值 = 6000 CNY
  - 累计盈亏 = 1000 CNY（包括股息）
- **WHEN** 验证数据一致性
- **THEN** 应满足：
  - 总资产 = 现金 + 持仓市值 = 5000 + 6000 = 11000 CNY
  - 总资产 = 净入金 + 累计盈亏 = 10000 + 1000 = 11000 CNY ✅

## Implementation Notes

### 代码位置
- 📁 `apps/backend/src/services/calculationService.ts`
- 函数：`calculateRealizedPnl`（第782-899行）

### 关键修改点
1. 第813行：添加 `let totalDividendIncome = 0;`
2. 第821-829行：处理 DIVIDEND 类型交易
3. 第885-892行：计算总已实现盈亏 = 交易盈亏 + 股息收入
4. 第894-896行：输出详细日志

### 向后兼容性
- ✅ API 接口不变
- ✅ 返回字段结构不变
- ✅ 数据库无需迁移
- ✅ 前端无需修改
- ✅ 历史数据自动按新算法重新计算

### 测试建议
- 测试无股息交易：结果与修改前一致
- 测试有股息交易：结果 = 修改前 + 股息总额
- 测试外币股息：验证汇率换算正确
- 测试数据一致性：总资产 = 净入金 + 累计盈亏

