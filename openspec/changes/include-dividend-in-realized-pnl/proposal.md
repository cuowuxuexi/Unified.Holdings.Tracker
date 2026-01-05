# Change: 将股息收入纳入已实现盈亏计算

## Why

当前系统在计算投资组合的"已实现盈亏"时，**仅包括买卖价差**，不包括股息收入。这导致：

1. **财务逻辑不完整**：股息收入是已经"落袋为安"的真实收益，应该归类为"已实现收益"
2. **累计盈亏不准确**：累计盈亏 = 已实现盈亏 + 未实现盈亏，但股息收入既未计入已实现盈亏，也未计入未实现盈亏
3. **与行业惯例不符**：主流券商和基金系统都将股息算入总收益/已实现收益
4. **用户困惑**：用户看到股息收入单独显示，但不明白为什么累计盈亏没有包含这部分收入

**示例场景**：
- 用户买入股票成本 100,000 CNY，卖出收入 120,000 CNY（盈利 20,000）
- 持有期间收到股息 5,000 CNY
- **修改前**：已实现盈亏 = 20,000 CNY（用户疑惑：我的股息去哪了？）
- **修改后**：已实现盈亏 = 25,000 CNY（买卖价差 + 股息）

## What Changes

### 核心修改
修改 `apps/backend/src/services/calculationService.ts` 中的 `calculateRealizedPnl` 函数：

1. **新增股息统计变量**：
   - 在函数中添加 `totalDividendIncome` 变量
   - 循环处理交易时，单独统计 `DIVIDEND` 类型交易的金额

2. **将股息计入已实现盈亏**：
   - 已实现盈亏 = 交易盈亏（买卖价差）+ 股息收入
   - 原公式：`realizedPnl = sellRevenue - buyCost`
   - 新公式：`totalRealizedPnl = (sellRevenue - buyCost) + totalDividendIncome`

3. **保持股息收入独立显示**：
   - `calculateTotalDividendIncome` 函数继续单独计算股息收入
   - 前端仍然可以单独显示"股息收入"指标
   - 这样既计入累计盈亏，又能单独查看明细

4. **日志增强**：
   - 添加详细日志输出：交易盈亏、股息收入、总已实现盈亏
   - 便于调试和验证计算结果

### 受影响的计算逻辑
- ✅ **已实现盈亏（realizedPnl）**：包括买卖价差 + 股息收入
- ✅ **未实现盈亏（unrealizedPnl）**：保持不变（持仓市值 - 持仓成本）
- ✅ **累计盈亏（totalPnl）**：已实现盈亏 + 未实现盈亏（自动包含股息）
- ✅ **股息收入（totalDividendIncome）**：仍然单独计算和显示

### 数据一致性验证
修改后应满足基本会计等式：
```
总资产 = 净入金 + 累计盈亏
总资产 = 现金 + 持仓市值
累计盈亏 = 已实现盈亏 + 未实现盈亏
已实现盈亏 = 买卖盈亏 + 股息收入
```

## Impact

### Affected specs
- **portfolio-calculation**（投资组合计算模块）
  - 修改 `calculateRealizedPnl` 函数的计算逻辑
  - 影响 `calculateTotalPnlV2` 函数的返回值

### Affected code
- 📁 **apps/backend/src/services/calculationService.ts**
  - `calculateRealizedPnl` 函数（第782-899行）
  - 已实现代码修改，待验证生效

### 向后兼容性
- ✅ **数据库无需迁移**：不涉及数据表结构修改
- ✅ **API无需变更**：返回字段结构不变，仅计算逻辑调整
- ✅ **前端无需修改**：前端仍然从 API 获取 `realizedPnl`、`totalPnl` 等字段
- ✅ **历史数据兼容**：历史交易记录会自动按新算法重新计算

### 用户影响
- **正向影响**：
  - 累计盈亏数值增加（增加股息收入部分）
  - 财务逻辑更准确，符合行业惯例
  - 用户理解更直观（所有收益都被正确统计）

- **潜在困惑**：
  - 老用户可能发现累计盈亏突然增加（实际是修正了之前的遗漏）
  - 建议：在更新日志中说明此变更

### 测试影响
- 需要更新已有的单元测试用例（如果涉及 `calculateRealizedPnl`）
- 添加新测试用例：验证股息收入正确计入已实现盈亏

## Migration Plan

### 部署步骤
1. ✅ 代码修改：已在 `calculationService.ts` 中实现
2. ⏳ 编译验证：
   ```bash
   cd apps/backend && npm run build
   ```
3. ⏳ 重启服务：
   ```bash
   npm run dev  # 开发环境
   npm start    # 生产环境
   ```
4. ⏳ 验证测试：
   - 查看投资组合统计页面
   - 确认累计盈亏 = 之前的累计盈亏 + 股息收入
   - 检查后端日志输出

### 回滚方案
如果出现问题，回滚代码：
```typescript
// 将 calculateRealizedPnl 函数中的返回值改为：
return tradingPnl;  // 不包含股息收入
```

### 验证清单
- [ ] 后端日志显示：`[calculateRealizedPnl] 交易盈亏: XXX CNY, 股息收入: XXX CNY, 总已实现盈亏: XXX CNY`
- [ ] 前端累计盈亏 = 修改前的值 + 股息收入总额
- [ ] 股息收入仍然单独显示（未受影响）
- [ ] 数据一致性验证：总资产 = 净入金 + 累计盈亏

## Related Documents
- 📄 原始文档：`DIVIDEND_IN_REALIZED_PNL.md`
- 📄 外币交易修复提案：`openspec/changes/fix-foreign-currency-exchange-rate/README.md`
- 📄 计算服务源码：`apps/backend/src/services/calculationService.ts`

## Notes
- 此修改是**增强型改动**，不是bug修复
- 修改后的逻辑符合**会计准则**和**行业惯例**
- DIVIDEND 交易的 amount 字段已经按汇率换算为 CNY，无需在此函数中再次换算

