import {
  MacroCatalogResponseEntry,
  MacroIndicatorDefinition,
  MacroIndicatorId,
} from './types';

export const MACRO_INDICATOR_IDS = [
  'DXY',
  'US_CPI',
  'US_PMI',
  'US_POLICY_RATE',
] as const satisfies readonly MacroIndicatorId[];

export const MACRO_FACT_DATE_SEMANTICS = 'FRED_OBSERVATION_DATE' as const;
export const MACRO_SOURCE_TIME_SEMANTICS =
  'FRED_REALTIME_END_THEN_START' as const;

const MACRO_RELEASE_DATE_FIELD = null;

// 月度序列按期初日期计龄：9 月 CPI 记为 09-01、10 月中旬才发布，
// 下一期发布前最长约 75 天，阈值须覆盖「一个周期 + 发布滞后」。
const MONTHLY_PERIOD_START_MAX_STALE_DAYS = 80;
// DTWEXBGS 每周一发布截至上周五的日度值，节假日顺延时会超过 10 天。
const WEEKLY_RELEASED_DAILY_MAX_STALE_DAYS = 14;

export const MACRO_INDICATORS: Record<
  MacroIndicatorId,
  MacroIndicatorDefinition
> = Object.freeze({
  DXY: Object.freeze({
    indicatorId: 'DXY',
    source: 'FRED',
    sourceSeriesId: 'DTWEXBGS',
    unit: 'index',
    label: 'Trade Weighted U.S. Dollar Index',
    frequency: 'DAILY',
    observationDateSemantics: 'OBSERVATION_DATE',
    releaseCadence: 'WEEKLY',
    defaultMaxStaleDays: WEEKLY_RELEASED_DAILY_MAX_STALE_DAYS,
  }),
  US_CPI: Object.freeze({
    indicatorId: 'US_CPI',
    source: 'FRED',
    sourceSeriesId: 'CPIAUCSL',
    unit: 'index_1982_1984_100',
    label: 'U.S. Consumer Price Index',
    frequency: 'MONTHLY',
    observationDateSemantics: 'PERIOD_START_DATE',
    releaseCadence: 'MONTHLY',
    defaultMaxStaleDays: MONTHLY_PERIOD_START_MAX_STALE_DAYS,
  }),
  // FRED 的 NAPM 已下架；东方财富「美国:供应管理协会(ISM):PMI:季调」
  // REPORT_DATE 同为期初日期，PUBLISH_DATE 为发布日。
  US_PMI: Object.freeze({
    indicatorId: 'US_PMI',
    source: 'EASTMONEY',
    sourceSeriesId: 'EMG00002790',
    unit: 'index',
    label: 'ISM Manufacturing PMI',
    frequency: 'MONTHLY',
    observationDateSemantics: 'PERIOD_START_DATE',
    releaseCadence: 'MONTHLY',
    defaultMaxStaleDays: MONTHLY_PERIOD_START_MAX_STALE_DAYS,
  }),
  US_POLICY_RATE: Object.freeze({
    indicatorId: 'US_POLICY_RATE',
    source: 'FRED',
    sourceSeriesId: 'FEDFUNDS',
    unit: 'percent',
    label: 'U.S. Federal Funds Effective Rate',
    frequency: 'MONTHLY',
    observationDateSemantics: 'PERIOD_START_DATE',
    releaseCadence: 'MONTHLY',
    defaultMaxStaleDays: MONTHLY_PERIOD_START_MAX_STALE_DAYS,
  }),
});

export function getMacroIndicatorDefinition(
  indicatorId: MacroIndicatorId
): MacroIndicatorDefinition {
  return MACRO_INDICATORS[indicatorId];
}

export function getFrozenMacroIndicatorIds(
  indicatorIds?: readonly MacroIndicatorId[]
): MacroIndicatorId[] {
  if (!indicatorIds || indicatorIds.length === 0) {
    return [...MACRO_INDICATOR_IDS];
  }

  const requested = new Set(indicatorIds);
  return MACRO_INDICATOR_IDS.filter((indicatorId) =>
    requested.has(indicatorId)
  );
}

export function getFrozenMacroIndicatorCatalog(
  indicatorIds?: readonly MacroIndicatorId[]
): MacroIndicatorDefinition[] {
  return getFrozenMacroIndicatorIds(indicatorIds).map(
    (indicatorId) => MACRO_INDICATORS[indicatorId]
  );
}

export function getMacroCatalogResponse(
  indicatorIds?: readonly MacroIndicatorId[]
): MacroCatalogResponseEntry[] {
  return getFrozenMacroIndicatorCatalog(indicatorIds).map((definition) => ({
    ...definition,
    factDateField: 'date',
    factDateSemantics: MACRO_FACT_DATE_SEMANTICS,
    releaseDateField: MACRO_RELEASE_DATE_FIELD,
    sourceTimeField: 'sourceTime',
    sourceTimeSemantics: MACRO_SOURCE_TIME_SEMANTICS,
  }));
}

export function isFredMacroConfigured(apiKey?: string): boolean {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}
