import {
  buildMarketHistory,
  CORE_BENCHMARK_INDEX_CODES,
  IndexSnapshotLikeRow,
  QuoteSnapshotLikeRow,
} from '../marketHistory';

const quoteRows: QuoteSnapshotLikeRow[] = [
  {
    assetCode: 'hk00700',
    date: '2026-01-02',
    timestamp: new Date('2026-01-02T08:00:00.000Z'),
    currentPrice: 300,
    changePercent: 1,
    changeAmount: 3,
    prevClosePrice: 297,
  },
  {
    assetCode: 'hk00700',
    date: '2026-04-24',
    timestamp: '2026-04-24T08:00:00.000Z',
    currentPrice: 360,
    changePercent: 2,
    changeAmount: 7,
    prevClosePrice: 353,
    weeklyChangePercent: 3,
    monthlyChangePercent: 8,
    yearlyChangePercent: 20,
  },
  {
    assetCode: 'sh601318',
    date: '2026-01-02',
    currentPrice: 40,
  },
  {
    assetCode: 'sh601318',
    date: '2026-04-24',
    currentPrice: 44,
  },
  {
    assetCode: 'hk00700',
    date: '2025-12-31',
    currentPrice: 280,
  },
];

const indexRows: IndexSnapshotLikeRow[] = CORE_BENCHMARK_INDEX_CODES.flatMap(
  (indexCode, offset) => [
    {
      indexCode,
      name: `index-${indexCode}`,
      date: '2026-01-02',
      currentPrice: 1000 + offset * 100,
    },
    {
      indexCode,
      name: `index-${indexCode}`,
      date: '2026-04-24',
      currentPrice: 1100 + offset * 100,
      changePercent: 1 + offset,
    },
  ]
);

describe('marketHistory', () => {
  it('builds annual holding quote points and fixed core benchmark index points', () => {
    const result = buildMarketHistory({
      assetCodes: ['hk00700', 'sh601318', 'hk00700'],
      startDate: '2026-01-02',
      endDate: '2026-04-24',
      quoteRows,
      indexRows: [
        ...indexRows,
        {
          indexCode: 'usNDX',
          name: 'Nasdaq 100',
          date: '2026-01-02',
          currentPrice: 20000,
        },
      ],
    });

    expect(result.requested_assets).toEqual(['hk00700', 'sh601318']);
    expect(result.quote_coverage).toEqual({
      requested: ['hk00700', 'sh601318'],
      found: ['hk00700', 'sh601318'],
      missing: [],
    });
    expect(result.quote_points[0]).toEqual(
      expect.objectContaining({
        asset_code: 'hk00700',
        baseline_date: '2026-01-02',
        baseline_price: 300,
      })
    );
    expect(result.quote_points[0].points).toEqual([
      expect.objectContaining({
        date: '2026-01-02',
        timestamp: '2026-01-02T08:00:00.000Z',
        current_price: 300,
        change_from_baseline_percent: 0,
      }),
      expect.objectContaining({
        date: '2026-04-24',
        current_price: 360,
        change_from_baseline_percent: 20,
        weekly_change_percent: 3,
        monthly_change_percent: 8,
        yearly_change_percent: 20,
      }),
    ]);
    expect(result.requested_benchmark_indices).toEqual([
      'sh000001',
      'sz399001',
      'hkHSI',
      'usDJI',
      'usIXIC',
      'usINX',
    ]);
    expect(result.requested_benchmark_indices).not.toContain('usNDX');
    expect(result.benchmark_index_coverage.missing).toEqual([]);
    expect(result.benchmark_index_points).toHaveLength(6);
    expect(result.benchmark_index_points[0]).toEqual(
      expect.objectContaining({
        index_code: 'sh000001',
        name: 'index-sh000001',
        baseline_date: '2026-01-02',
        baseline_price: 1000,
        points: [
          expect.objectContaining({
            date: '2026-01-02',
            change_from_baseline_percent: 0,
          }),
          expect.objectContaining({
            date: '2026-04-24',
            change_from_baseline_percent: 10,
          }),
        ],
      })
    );
    expect(result.warnings).toEqual([]);
  });

  it('falls back to first available trading day as quote baseline; assets without rows stay missing', () => {
    const result = buildMarketHistory({
      assetCodes: ['hk00700', 'usAAPL'],
      startDate: '2026-01-02',
      endDate: '2026-04-24',
      quoteRows: [
        {
          assetCode: 'hk00700',
          date: '2026-04-24',
          currentPrice: 360,
        },
      ],
      indexRows,
    });

    expect(result.quote_coverage).toEqual({
      requested: ['hk00700', 'usAAPL'],
      found: ['hk00700'],
      missing: ['usAAPL'],
    });
    // startDate（可能是非交易日）无行时，回退到窗口内第一个可用交易日
    expect(result.quote_points[0]).toEqual(
      expect.objectContaining({
        asset_code: 'hk00700',
        baseline_date: '2026-04-24',
        baseline_price: 360,
      })
    );
    expect(result.quote_points[0].points).toEqual([
      expect.objectContaining({
        date: '2026-04-24',
        change_from_baseline_percent: 0,
      }),
    ]);
    // 完全无数据的资产仍视为缺失
    expect(result.quote_points[1]).toEqual({
      asset_code: 'usAAPL',
      baseline_date: null,
      baseline_price: null,
      points: null,
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quote_history_incomplete',
          details: expect.objectContaining({
            missing_assets: ['usAAPL'],
            baseline_missing_assets: ['usAAPL'],
          }),
        }),
      ])
    );
  });

  it('falls back to first available trading day as index baseline; indices without rows stay missing', () => {
    const result = buildMarketHistory({
      assetCodes: ['hk00700'],
      startDate: '2026-01-02',
      endDate: '2026-04-24',
      quoteRows: [quoteRows[0], quoteRows[1]],
      indexRows: [
        {
          indexCode: 'sh000001',
          name: '上证指数',
          date: '2026-04-24',
          currentPrice: 3100,
        },
      ],
    });

    expect(result.benchmark_index_coverage).toEqual({
      requested: ['sh000001', 'sz399001', 'hkHSI', 'usDJI', 'usIXIC', 'usINX'],
      found: ['sh000001'],
      missing: ['sz399001', 'hkHSI', 'usDJI', 'usIXIC', 'usINX'],
    });
    // startDate 无行时回退到窗口内第一个可用交易日
    expect(result.benchmark_index_points[0]).toEqual(
      expect.objectContaining({
        index_code: 'sh000001',
        name: '上证指数',
        baseline_date: '2026-04-24',
        baseline_price: 3100,
        points: [
          expect.objectContaining({
            date: '2026-04-24',
            change_from_baseline_percent: 0,
          }),
        ],
      })
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'benchmark_history_missing',
          details: expect.objectContaining({
            missing_indices: ['sz399001', 'hkHSI', 'usDJI', 'usIXIC', 'usINX'],
            baseline_missing_indices: [
              'sz399001',
              'hkHSI',
              'usDJI',
              'usIXIC',
              'usINX',
            ],
          }),
        }),
      ])
    );
  });
});
