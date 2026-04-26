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

export const MACRO_INDICATORS: Record<
  MacroIndicatorId,
  MacroIndicatorDefinition
> = Object.freeze({
  DXY: Object.freeze({
    indicatorId: 'DXY',
    sourceSeriesId: 'DTWEXBGS',
    unit: 'index',
    label: 'Trade Weighted U.S. Dollar Index',
    frequency: 'DAILY',
    observationDateSemantics: 'OBSERVATION_DATE',
    releaseCadence: 'WEEKLY',
    defaultMaxStaleDays: 10,
  }),
  US_CPI: Object.freeze({
    indicatorId: 'US_CPI',
    sourceSeriesId: 'CPIAUCSL',
    unit: 'index_1982_1984_100',
    label: 'U.S. Consumer Price Index',
    frequency: 'MONTHLY',
    observationDateSemantics: 'PERIOD_START_DATE',
    releaseCadence: 'MONTHLY',
    defaultMaxStaleDays: 45,
  }),
  US_PMI: Object.freeze({
    indicatorId: 'US_PMI',
    sourceSeriesId: 'NAPM',
    unit: 'index',
    label: 'ISM Manufacturing PMI',
    frequency: 'MONTHLY',
    observationDateSemantics: 'PERIOD_START_DATE',
    releaseCadence: 'MONTHLY',
    defaultMaxStaleDays: 45,
  }),
  US_POLICY_RATE: Object.freeze({
    indicatorId: 'US_POLICY_RATE',
    sourceSeriesId: 'FEDFUNDS',
    unit: 'percent',
    label: 'U.S. Federal Funds Effective Rate',
    frequency: 'MONTHLY',
    observationDateSemantics: 'PERIOD_START_DATE',
    releaseCadence: 'MONTHLY',
    defaultMaxStaleDays: 45,
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
