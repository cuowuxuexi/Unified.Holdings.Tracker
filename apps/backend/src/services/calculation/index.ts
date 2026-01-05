/**
 * 计算服务统一导出
 *
 * 该模块将原本的 calculationService.ts (1259行) 拆分为多个子模块：
 * - realtime-pnl.ts: 实时盈亏计算和持仓数据验证
 * - period-stats.ts: 周期统计和指数周期变化计算
 * - base-price.ts: 基准价格获取（周/月/年）
 * - realized-pnl.ts: 已实现/未实现盈亏计算
 * - financial-metrics.ts: 财务指标计算（净入金、手续费、融资成本、股息）
 * - utils.ts: 工具函数（日期格式化、交易哈希等）
 * - types.ts: 类型定义
 *
 * 修复内容：
 * - 问题1：拆分大文件，提高代码可维护性
 * - 问题4：修复缓存哈希函数，使用内容哈希代替交易数量
 */

// ============================================================================
// 类型定义
// ============================================================================
export type {
  PriceSource,
  PeriodStatsOptions,
  PeriodStatsResult,
  ValueMetadata,
  ValueComputationResult,
} from './types';

// ============================================================================
// 实时盈亏计算
// ============================================================================
export { calculateRealtimePnl, validatePositionData } from './realtime-pnl';

// ============================================================================
// 周期统计
// ============================================================================
export {
  calculatePeriodStats,
  calculateIndexPeriodChanges,
} from './period-stats';

// ============================================================================
// 基准价格获取
// ============================================================================
export {
  getBasePrice,
  getYearBasePrice,
  getMonthBasePrice,
  getWeekBasePrice,
} from './base-price';

// ============================================================================
// 已实现/未实现盈亏
// ============================================================================
export {
  calculateRealizedPnl,
  calculateUnrealizedPnl,
  calculateTotalPnlV2,
} from './realized-pnl';

// ============================================================================
// 财务指标
// ============================================================================
export {
  calculateNetDepositedCash,
  calculateTotalCommission,
  calculateLeverageCostByDay,
  calculateTotalDividendIncome,
} from './financial-metrics';

// ============================================================================
// 工具函数（内部使用，不对外导出）
// ============================================================================
// 注意：工具函数已被各模块内部使用，通常不需要对外导出
// 如果需要导出，可以取消下面的注释：
// export {
//   formatDate,
//   getLastWeekSaturdayDate,
//   getLastDayOfPreviousMonth,
//   getLastDayOfPreviousYear,
//   findClosestKlinePoint,
//   hashTransactions,
// } from './utils';
