# Change: 优化周涨幅算法

## Why

当前周涨幅计算存在以下问题：
1. **数据缺失**：周涨幅显示为 0.00%，处于不可用状态
2. **回溯天数不足**：当前仅回溯 5 天查找本周一的基准价格，如果遇到长假期（如春节、国庆）或停牌，无法获取有效数据
3. **基准日期不合理**：使用本周一作为基准，但周一可能是假期或停牌日，更合理的是使用上周最后一个交易日
4. **用户体验差**：周涨幅是重要的短期收益指标，无法显示会影响投资决策

## What Changes

- 改进周线基准价格获取逻辑：
  - 将基准日期从"本周一"改为"上周最后一个交易日"
  - 增加回溯天数从 5 天扩展到 15 天（覆盖大部分长假期）
  - 增加缓存机制，避免重复计算
  - 添加详细的日志记录，便于排查问题
  
- 同时优化月涨幅和年涨幅的回溯逻辑：
  - 月涨幅回溯从 10 天增加到 20 天
  - 年涨幅回溯从 30 天增加到 60 天
  
- 添加降级策略：
  - 如果无法获取 K 线数据，尝试使用交易记录计算
  - 提供友好的错误提示

## Impact

### Affected specs
- 目前项目无正式 specs，此提案涉及以下功能模块：
  - 市场行情服务（Market Quote Service）
  - 计算服务（Calculation Service）
  - 前端持仓展示（Position Display）

### Affected code
- `apps/backend/src/services/calculationService.ts`:
  - 修改 `getWeekBasePrice()` 函数
  - 修改 `getMonthBasePrice()` 函数
  - 修改 `getYearBasePrice()` 函数
  - 修改 `getBasePrice()` 函数（增加缓存）
  
- `apps/backend/src/services/tencentApi.ts`:
  - 优化周期变动计算的错误处理
  - 增加更详细的日志输出
  
- `frontend/src/components/MarketAssetsPanel.tsx`:
  - 改进周涨幅为空时的显示逻辑
  - 添加加载状态提示

### Breaking Changes
- **无破坏性变更**：仅改进现有功能，不影响 API 接口和数据结构

