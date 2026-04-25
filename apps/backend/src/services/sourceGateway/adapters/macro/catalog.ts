import { MacroIndicatorDefinition, MacroIndicatorId } from './types';

export const MACRO_INDICATORS: Record<
  MacroIndicatorId,
  MacroIndicatorDefinition
> = {
  DXY: {
    indicatorId: 'DXY',
    sourceSeriesId: 'DTWEXBGS',
    unit: 'index',
    label: 'Trade Weighted U.S. Dollar Index',
  },
  US_CPI: {
    indicatorId: 'US_CPI',
    sourceSeriesId: 'CPIAUCSL',
    unit: 'index_1982_1984_100',
    label: 'U.S. Consumer Price Index',
  },
  US_PMI: {
    indicatorId: 'US_PMI',
    sourceSeriesId: 'NAPM',
    unit: 'index',
    label: 'ISM Manufacturing PMI',
  },
  US_POLICY_RATE: {
    indicatorId: 'US_POLICY_RATE',
    sourceSeriesId: 'FEDFUNDS',
    unit: 'percent',
    label: 'U.S. Federal Funds Effective Rate',
  },
};

export function getMacroIndicatorDefinition(
  indicatorId: MacroIndicatorId
): MacroIndicatorDefinition {
  return MACRO_INDICATORS[indicatorId];
}
