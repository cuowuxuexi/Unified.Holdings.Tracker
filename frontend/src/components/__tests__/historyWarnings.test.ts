import { classifyHistoryWarnings } from '../historyWarnings';

// 2026-10-21 现网 history-context(2026) 信封 + macro 分区 warnings 的真实组合
const envelope = [
  {
    code: 'created_at_not_business_start',
    message: 'Portfolio.createdAt is later than the first account fact.',
    details: { created_at: '2026-02-24', business_start: '2026-01-01' },
  },
  {
    code: 'macro_indicator_stale',
    message: 'US_CPI latest macro fact is stale.',
    details: {
      indicator_id: 'US_CPI',
      latest_date: '2026-09-01',
      stale_days: 49,
      max_stale_days: 70,
    },
  },
  {
    code: 'macro_indicators_missing',
    message: 'No US_PMI macro facts.',
    details: { indicator_id: 'US_PMI' },
  },
];
const macroSection = [
  { ...envelope[1] },
  { ...envelope[2], code: 'macro_indicator_missing' },
];

describe('classifyHistoryWarnings', () => {
  it('counts each gap once and keeps bookkeeping notes out of the gap count', () => {
    const { gaps, notes } = classifyHistoryWarnings([
      ...envelope,
      ...macroSection,
    ]);

    expect(gaps.map((gap) => gap.text)).toEqual([
      '美国 CPI 最新一期为 2026-09-01，已 49 天未更新（阈值 70 天）',
      '美国 PMI 在本年度没有可用数据',
    ]);
    expect(notes.map((note) => note.code)).toEqual([
      'created_at_not_business_start',
    ]);
  });
});
