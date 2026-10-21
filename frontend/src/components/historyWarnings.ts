import type { ApiContractWarning } from '../store/types';

/** 不代表数据缺失、只是口径说明的告警 */
const NOTE_CODES = new Set([
  'created_at_not_business_start',
  'date_resolved_to_latest_available',
  'resolved_end_before_requested_end',
  'portfolio_started_after_year_start',
  'include_unsupported',
  'macro_indicator_unsupported',
]);

/** 信封里已归一的同义码 */
const CODE_ALIASES: Record<string, string> = {
  macro_indicator_missing: 'macro_indicators_missing',
  macro_indicator_unavailable: 'macro_indicators_missing',
  portfolio_snapshot_missing: 'portfolio_history_missing',
  position_snapshot_missing: 'position_history_missing',
  resolved_end_before_requested_end: 'date_resolved_to_latest_available',
};

const MACRO_NAMES: Record<string, string> = {
  DXY: '美元指数',
  US_CPI: '美国 CPI',
  US_PMI: '美国 PMI',
  US_POLICY_RATE: '美国政策利率',
};

export function formatMacroIndicatorName(indicator: string): string {
  return MACRO_NAMES[indicator] ?? indicator;
}

export interface DisplayWarning {
  key: string;
  code: string;
  text: string;
}

function detail(warning: ApiContractWarning, name: string): string | null {
  const value = warning.details?.[name];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

export function describeHistoryWarning(warning: ApiContractWarning): string {
  const code = CODE_ALIASES[warning.code] ?? warning.code;
  const indicator = detail(warning, 'indicator_id');
  const indicatorName = indicator ? formatMacroIndicatorName(indicator) : '';
  switch (code) {
    case 'macro_indicator_stale':
      return `${indicatorName} 最新一期为 ${detail(warning, 'latest_date') ?? '未知'}，已 ${detail(warning, 'stale_days') ?? '?'} 天未更新（阈值 ${detail(warning, 'max_stale_days') ?? '?'} 天）`;
    case 'macro_indicators_missing':
      return `${indicatorName || '宏观指标'} 在本年度没有可用数据`;
    case 'created_at_not_business_start':
      return `组合记录创建于 ${detail(warning, 'created_at') ?? '?'}，最早交易在 ${detail(warning, 'business_start') ?? '?'}；统计以交易日期为准`;
    case 'date_resolved_to_latest_available':
      return `所选日期暂无数据，已按最新可用日期展示`;
    case 'portfolio_started_after_year_start':
      return '组合在年中开始，年初至首笔交易之间没有数据';
    case 'portfolio_history_missing':
      return '部分日期缺少组合快照';
    case 'position_history_missing':
      return '部分日期缺少持仓明细快照';
    case 'transactions_without_snapshots':
      return '部分有交易的日期没有对应快照';
    case 'fx_history_incomplete':
      return `汇率历史不完整${detail(warning, 'pair') ? `（${detail(warning, 'pair')}）` : ''}`;
    case 'yield_curve_missing':
      return '收益率曲线数据缺失';
    case 'quote_history_incomplete':
      return '部分持仓的历史行情不完整';
    case 'benchmark_history_missing':
      return '部分基准指数的历史行情缺失';
    case 'source_health_not_recorded':
      return '本年度没有数据源运行记录';
    default:
      return warning.message;
  }
}

function dedupeKey(warning: ApiContractWarning): string {
  const code = CODE_ALIASES[warning.code] ?? warning.code;
  const identity =
    detail(warning, 'indicator_id') ??
    detail(warning, 'pair') ??
    detail(warning, 'asset_code') ??
    '';
  return `${code}:${identity}`;
}

/**
 * 信封 warnings 已汇总各分区，前端再与分区 warnings 相加会重复计数；
 * 按「归一码 + 指标/币对」去重，并把口径说明与真正的数据缺口分开。
 */
export function classifyHistoryWarnings(warnings: ApiContractWarning[]): {
  gaps: DisplayWarning[];
  notes: DisplayWarning[];
} {
  const seen = new Set<string>();
  const gaps: DisplayWarning[] = [];
  const notes: DisplayWarning[] = [];
  for (const warning of warnings) {
    const key = dedupeKey(warning);
    if (seen.has(key)) continue;
    seen.add(key);
    const code = CODE_ALIASES[warning.code] ?? warning.code;
    const item = { key, code, text: describeHistoryWarning(warning) };
    if (NOTE_CODES.has(warning.code) || NOTE_CODES.has(code)) {
      notes.push(item);
    } else {
      gaps.push(item);
    }
  }
  return { gaps, notes };
}
