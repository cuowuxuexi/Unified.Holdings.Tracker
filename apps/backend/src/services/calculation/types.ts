/**
 * 价格来源类型
 */
export type PriceSource = 'realtime' | 'kline' | 'cost';

/**
 * 周期统计选项
 */
export interface PeriodStatsOptions {
  quotes?: Record<string, import('../../types').Quote>;
  /** 期末是否使用实时价格（currentPrice），默认 false */
  useRealtimeEndValue?: boolean;
  /** 期初是否使用昨收价（preClose），默认 false
   *  🔧 修复周度/日度计算：期初用 preClose 而不是 K 线回退
   *  这样可以准确计算"今天开盘以来"的变化
   */
  usePreCloseStartValue?: boolean;
}

/**
 * 周期统计结果
 */
export interface PeriodStatsResult {
  periodReturnPercent: number | null;
  periodPnl: number | null;
  totalValueChange?: number | null; // 净值变化（元，净值=总资产-已用杠杆）
  totalValueChangePercent?: number | null; // 净值变化率（小数形式）
  baseDate?: string | null;
  baseDateSource?: PriceSource;
  endDate?: string | null;
  endDateSource?: PriceSource;
  fallbackDays?: number;
}

/**
 * 估值元数据
 */
export interface ValueMetadata {
  anchorDate: string;
  effectiveDate: string | null;
  source: PriceSource;
  fallbackDays: number;
}

/**
 * 估值计算结果
 */
export interface ValueComputationResult {
  value: number;
  metadata: ValueMetadata;
}
