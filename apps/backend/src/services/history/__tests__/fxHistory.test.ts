import {
  buildFxHistoryWindow,
  DEFAULT_FX_HISTORY_PAIRS,
  normalizeFxHistoryPair,
} from '../fxHistory';

describe('buildFxHistoryWindow', () => {
  it('normalizes compact FX pair aliases and calculates annual-window changes', () => {
    const result = buildFxHistoryWindow(
      [
        { date: '2026-01-01', pair: 'USD-CNY', rate: 7, source: 'standard' },
        { date: '2026-03-25', pair: 'USDCNY', rate: '7.1', source: 'legacy' },
        { date: '2026-04-17', pair: 'USD-CNY', rate: 7.14 },
        { date: '2026-04-24', pair: 'USDCNY', rate: 7.21 },
        { date: '2026-01-01', pair: 'HKDCNY', rate: 0.9 },
        { date: '2026-03-25', pair: 'HKD-CNY', rate: 0.91 },
        { date: '2026-04-17', pair: 'HKDCNY', rate: 0.92 },
        { date: '2026-04-24', pair: 'HKD-CNY', rate: 0.93 },
        { date: '2025-12-31', pair: 'USDCNY', rate: 6.99 },
      ],
      { year: 2026, endDate: '2026-04-24' }
    );

    const usd = result.pairs.find(
      (pairWindow) => pairWindow.pair === 'USD-CNY'
    );
    const hkd = result.pairs.find(
      (pairWindow) => pairWindow.pair === 'HKD-CNY'
    );

    expect(result.window).toEqual({
      year: 2026,
      start: '2026-01-01',
      end: '2026-04-24',
    });
    expect(result.pairs.map((pairWindow) => pairWindow.pair)).toEqual([
      'USD-CNY',
      'HKD-CNY',
    ]);
    expect(usd?.points.map((point) => point.pair)).toEqual([
      'USD-CNY',
      'USD-CNY',
      'USD-CNY',
      'USD-CNY',
    ]);
    expect(usd).toMatchObject({
      current_date: '2026-04-24',
      current_rate: 7.21,
      change_7d_percent: 0.980392,
      change_30d_percent: 1.549296,
      change_ytd_percent: 3,
    });
    expect(hkd).toMatchObject({
      current_rate: 0.93,
      change_7d_percent: 1.086957,
      change_30d_percent: 2.197802,
      change_ytd_percent: 3.333333,
    });
    expect(result.warnings).toEqual([]);
  });

  it('returns null changes and fx_history_incomplete warnings when baselines are missing', () => {
    const result = buildFxHistoryWindow(
      [
        { date: '2026-04-24', pair: 'USDCNY', rate: 7.21 },
        { date: '2026-04-24', pair: 'HKDCNY', rate: 0.93 },
      ],
      { year: '2026', endDate: '2026-04-24' }
    );

    expect(result.pairs).toEqual([
      expect.objectContaining({
        pair: 'USD-CNY',
        change_7d_percent: null,
        change_30d_percent: null,
        change_ytd_percent: null,
      }),
      expect.objectContaining({
        pair: 'HKD-CNY',
        change_7d_percent: null,
        change_30d_percent: null,
        change_ytd_percent: null,
      }),
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'fx_history_incomplete',
          details: {
            pair: 'USD-CNY',
            window: '7d',
            baseline_date: '2026-04-17',
          },
        }),
        expect.objectContaining({
          code: 'fx_history_incomplete',
          details: {
            pair: 'HKD-CNY',
            window: 'ytd',
            baseline_date: '2026-01-01',
          },
        }),
      ])
    );
  });

  it('keeps USD-HKD as an explicit extension point without adding it to defaults', () => {
    const defaultResult = buildFxHistoryWindow(
      [{ date: '2026-04-24', pair: 'USDHKD', rate: 7.78 }],
      { year: 2026, endDate: '2026-04-24' }
    );
    const requestedResult = buildFxHistoryWindow(
      [
        { date: '2026-01-01', pair: 'USDHKD', rate: 7.76 },
        { date: '2026-04-24', pair: 'USD-HKD', rate: 7.78 },
      ],
      { year: 2026, endDate: '2026-04-24', pairs: ['USD-HKD'] }
    );

    expect(DEFAULT_FX_HISTORY_PAIRS).toEqual(['USD-CNY', 'HKD-CNY']);
    expect(defaultResult.pairs.map((pairWindow) => pairWindow.pair)).toEqual([
      'USD-CNY',
      'HKD-CNY',
    ]);
    expect(requestedResult.pairs).toEqual([
      expect.objectContaining({
        pair: 'USD-HKD',
        current_rate: 7.78,
        change_ytd_percent: 0.257732,
      }),
    ]);
  });

  it('deduplicates same-day alias rows by preferring canonical pair names', () => {
    const result = buildFxHistoryWindow(
      [
        { date: '2026-01-01', pair: 'USDCNY', rate: 7 },
        { date: '2026-04-24', pair: 'USDCNY', rate: 7.2, source: 'legacy' },
        {
          date: '2026-04-24',
          pair: 'USD-CNY',
          rate: 7.21,
          source: 'canonical',
        },
      ],
      { year: 2026, endDate: '2026-04-24', pairs: ['USDCNY'] }
    );

    expect(result.pairs[0].points).toEqual([
      { date: '2026-01-01', pair: 'USD-CNY', rate: 7, source: null },
      { date: '2026-04-24', pair: 'USD-CNY', rate: 7.21, source: 'canonical' },
    ]);
  });
});

describe('normalizeFxHistoryPair', () => {
  it('maps supported aliases to canonical pair names', () => {
    expect(normalizeFxHistoryPair('USDCNY')).toBe('USD-CNY');
    expect(normalizeFxHistoryPair('USD-CNY')).toBe('USD-CNY');
    expect(normalizeFxHistoryPair('HKDCNY')).toBe('HKD-CNY');
    expect(normalizeFxHistoryPair('HKD-CNY')).toBe('HKD-CNY');
    expect(normalizeFxHistoryPair('USDHKD')).toBe('USD-HKD');
    expect(normalizeFxHistoryPair('EURCNY')).toBeNull();
  });
});
