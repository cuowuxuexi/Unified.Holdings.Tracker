# 设计文档：周涨幅算法优化

## Context

当前投资组合跟踪系统支持显示持仓资产的周涨幅、月涨幅和年涨幅，但在实际使用中发现周涨幅长期显示为 0.00%，无法为用户提供有效的短期收益参考。

### 当前实现

**基准日期逻辑**：
- 周涨幅：使用本周一作为基准日期
- 月涨幅：使用本月 1 日作为基准日期
- 年涨幅：使用今年 1 月 1 日作为基准日期

**数据获取流程**：
1. 调用 `getWeekBasePrice(code)` 获取本周一的收盘价
2. 如果本周一无数据，向前回溯最多 5 天
3. 使用基准价格和当前价格计算涨幅：`(currentPrice - basePrice) / basePrice * 100`

**问题根源**：
- 本周一可能是假期、停牌或周末，导致无 K 线数据
- 5 天的回溯窗口不足以覆盖长假期（如春节 7 天、国庆 7 天）
- 没有缓存机制，每次请求都要重新获取 K 线数据
- 基准日期使用"本周一"不符合金融行业惯例（应使用上周最后一个交易日）

### 相关系统

**依赖服务**：
- 腾讯财经 K 线 API (`tencentApi.ts`): 提供历史价格数据
- 缓存服务 (`cacheService`): 用于缓存基准价格结果
- 计算服务 (`calculationService.ts`): 核心计算逻辑

**数据流**：
```
前端请求行情
    ↓
fetchQuotes() - tencentApi.ts
    ↓
getWeekBasePrice() - calculationService.ts
    ↓
getBasePrice() - 获取 K 线数据
    ↓
fetchKline() - 调用腾讯 API
    ↓
返回周涨幅数据到前端
```

## Goals / Non-Goals

### Goals
1. ✅ **提高周涨幅数据可用性**：确保 95% 以上的资产能够正确显示周涨幅
2. ✅ **优化性能**：通过缓存减少 API 调用次数
3. ✅ **改进基准日期逻辑**：使用更合理的基准日期（上周最后一个交易日）
4. ✅ **增强可调试性**：添加详细日志，便于排查问题
5. ✅ **提升用户体验**：在前端明确区分"无数据"和"0 涨幅"

### Non-Goals
- ❌ 不改变 API 接口签名（保持向后兼容）
- ❌ 不引入新的外部依赖或数据源
- ❌ 不重构整个计算服务架构
- ❌ 不处理分钟级或小时级的短期涨幅

## Decisions

### Decision 1: 基准日期改为"上周最后一个交易日"

**选择**：将周涨幅的基准日期从"本周一"改为"上周的最后一个交易日"

**理由**：
- 金融行业通常使用"上周收盘"作为周涨幅基准
- 避免周一假期导致的数据缺失
- 更符合用户的直觉理解（周收益 = 本周收盘 - 上周收盘）

**实现**：
```typescript
export async function getWeekBasePrice(
  code: string
): Promise<{ price: number | null; date: string | null }> {
  const today = new Date();
  const daysAgo = today.getDay() === 0 ? 7 : today.getDay(); // 如果是周日，回溯7天
  const lastWeekFriday = new Date(today);
  lastWeekFriday.setDate(today.getDate() - daysAgo - 2); // 回溯到上周五
  return getBasePrice(code, lastWeekFriday, 15); // 增加回溯天数到15天
}
```

**替代方案考虑**：
- **使用本周一**：当前方案，但在假期场景下失败率高
- **使用固定 7 天前**：简单但不符合金融惯例
- **动态计算上个交易日**：需要交易日历数据，增加复杂度

### Decision 2: 扩大回溯窗口

**选择**：将回溯天数从 5/10/30 天分别扩大到 15/20/60 天

**理由**：
- 覆盖中国长假期（春节 7 天 + 调休、国庆 7 天）
- 处理停牌场景（部分股票可能停牌数周）
- 提高数据可用性

**权衡**：
- **优点**：显著提高数据获取成功率
- **缺点**：回溯太远可能导致基准日期与预期不符（例如停牌股票）
- **缓解措施**：在日志中记录实际使用的基准日期，供用户参考

### Decision 3: 增加缓存机制

**选择**：使用 `cacheService` 缓存基准价格结果，设置不同的过期时间

**缓存策略**：
- **周线基准价格**：缓存 1 小时（交易日内基准价格不变）
- **月线基准价格**：缓存 6 小时（月初几天基准价格不变）
- **年线基准价格**：缓存 24 小时（年初几周基准价格不变）

**缓存键格式**：
```typescript
const cacheKey = `base-price:${period}:${code}:${anchorDate}`;
// 示例: base-price:week:sh600519:2025-11-04
```

**实现**：
```typescript
export async function getBasePrice(
  code: string,
  anchorDate: Date,
  maxLookbackDays: number,
  cacheTTL: number = 3600 // 默认1小时
): Promise<{ price: number | null; date: string | null }> {
  const dateStr = formatDate(anchorDate);
  const cacheKey = `base-price:${code}:${dateStr}`;
  
  // 尝试从缓存获取
  const cached = cacheService.get<{ price: number | null; date: string | null }>(cacheKey);
  if (cached) {
    console.log(`[getBasePrice] Cache hit for ${cacheKey}`);
    return cached;
  }
  
  // 获取 K 线数据并计算
  const result = await fetchAndCalculateBasePrice(code, anchorDate, maxLookbackDays);
  
  // 缓存结果
  if (result.price !== null) {
    cacheService.set(cacheKey, result, cacheTTL);
  }
  
  return result;
}
```

### Decision 4: 改进错误处理和日志

**选择**：添加结构化日志，区分不同类型的错误

**日志级别**：
- **INFO**：正常获取到基准价格，记录代码、日期、价格
- **WARN**：回溯过程中没有找到理想日期，使用了较远的日期
- **ERROR**：完全无法获取基准价格，记录错误原因

**日志示例**：
```typescript
console.log(`[getWeekBasePrice] 成功获取 ${code} 的周线基准价格: ${result.price} (日期: ${result.date})`);
console.warn(`[getWeekBasePrice] ${code} 在 ${idealDate} 无数据，使用 ${result.date} 的价格`);
console.error(`[getWeekBasePrice] ${code} 无法获取基准价格: ${error.message}`);
```

### Decision 5: 前端显示优化

**选择**：在前端明确区分三种状态

**显示逻辑**：
| 后端返回值 | 前端显示 | 说明 |
|-----------|---------|------|
| `undefined` | "N/A" | 数据未加载或加载失败 |
| `null` | "N/A" | 无可用数据（停牌/新股） |
| `0` | "0.00%" | 涨幅确实为 0 |
| 其他数值 | "±X.XX%" | 正常涨幅 |

**Tooltip 提示**：
- "N/A"时显示："周涨幅数据暂不可用，可能因为停牌或假期"
- 加载中显示：骨架屏或加载动画

## Risks / Trade-offs

### Risk 1: 回溯天数过大导致基准日期不准确

**风险描述**：
- 对于长期停牌的股票，可能回溯到停牌前的价格
- 用户可能误解为"一周涨幅"，实际是"几周涨幅"

**缓解措施**：
- 在日志中记录实际使用的基准日期
- 前端 Tooltip 显示实际基准日期
- 文档中说明周涨幅的计算逻辑

**接受度**：✅ 可接受，因为无数据总比错误数据好

### Risk 2: 缓存可能导致数据不够实时

**风险描述**：
- 基准价格缓存 1-24 小时，可能导致数据滞后
- 例如：某股票复牌，但基准价格仍使用停牌前的缓存

**缓解措施**：
- 周线缓存仅 1 小时，实时性影响较小
- 提供手动刷新功能（前端）
- 缓存仅在交易时间内有效，非交易时间可延长缓存

**接受度**：✅ 可接受，性能收益远大于实时性损失

### Risk 3: 腾讯 API 限流或不可用

**风险描述**：
- 腾讯 K 线 API 可能限流或服务不稳定
- 大量资产同时请求可能触发限流

**缓解措施**：
- 利用现有的缓存机制减少 API 调用
- 添加请求失败重试逻辑（最多 3 次）
- 考虑未来引入备用数据源（如新浪财经）

**接受度**：✅ 可接受，当前缓解措施足够

## Migration Plan

### Phase 1: 后端实现（预计 2-3 小时）
1. 修改 `calculationService.ts` 中的基准价格函数
2. 添加缓存逻辑
3. 优化日志输出
4. 本地测试验证

### Phase 2: 前端优化（预计 1-2 小时）
1. 修改 `MarketAssetsPanel.tsx` 显示逻辑
2. 添加 Tooltip 提示
3. 改进加载状态显示

### Phase 3: 测试（预计 1-2 小时）
1. 编写单元测试
2. 手动测试各种场景（假期、停牌、正常交易）
3. 验证性能改进

### Phase 4: 文档和部署（预计 1 小时）
1. 更新技术文档
2. 更新用户指南
3. 部署到生产环境
4. 监控日志和用户反馈

### Rollback Plan

如果新算法出现严重问题，可以快速回滚：
1. 恢复 `calculationService.ts` 到之前版本
2. 清除相关缓存
3. 重启后端服务

回滚风险低，因为没有数据库 Schema 变更。

## Open Questions

1. **Q**: 是否需要为港股和美股使用不同的基准日期逻辑？
   **A**: 暂不需要，统一使用"上周最后一个交易日"逻辑，因为 K 线 API 会自动处理不同市场的交易日

2. **Q**: 是否需要支持自定义周期（如 3 天涨幅、14 天涨幅）？
   **A**: Non-Goal，当前仅优化现有的周/月/年涨幅

3. **Q**: 缓存过期后，如果 API 不可用怎么办？
   **A**: 可以考虑"软过期"机制（stale-while-revalidate），如果新数据获取失败，继续使用过期数据。这个可以作为后续优化。

