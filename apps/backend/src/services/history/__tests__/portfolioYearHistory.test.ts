import {
  buildPortfolioYearHistory,
  PortfolioYearHistorySnapshotRow,
} from '../portfolioYearHistory';

function snapshot(
  overrides: Partial<PortfolioYearHistorySnapshotRow> & { date: string }
): PortfolioYearHistorySnapshotRow {
  return {
    date: overrides.date,
    totalMarketValue: overrides.totalMarketValue ?? 800,
    netAssets: overrides.netAssets ?? 1000,
    totalPnl: overrides.totalPnl ?? 100,
    dailyPnl: overrides.dailyPnl ?? 10,
    cash: overrides.cash ?? 200,
    realizedPnl: overrides.realizedPnl ?? 20,
    unrealizedPnl: overrides.unrealizedPnl ?? 80,
    netDepositedCash: overrides.netDepositedCash ?? 900,
    totalCommission: overrides.totalCommission ?? 5,
    totalDividendIncome: overrides.totalDividendIncome ?? 3,
    leverageUsed: overrides.leverageUsed ?? 0,
    leverageTotal: overrides.leverageTotal ?? 2000,
    leverageCostRate: overrides.leverageCostRate ?? 0.05,
    leverageCumulativeCost: overrides.leverageCumulativeCost ?? 12,
    dailyPnlPercent: overrides.dailyPnlPercent ?? 1,
    totalPnlPercent: overrides.totalPnlPercent ?? 10,
    weeklyReturnPercent: overrides.weeklyReturnPercent ?? 2,
    weeklyReturnValue: overrides.weeklyReturnValue ?? 20,
    weeklyBaseDate: overrides.weeklyBaseDate ?? '2026-04-20',
    monthlyReturnPercent: overrides.monthlyReturnPercent ?? 3,
    monthlyReturnValue: overrides.monthlyReturnValue ?? 30,
    monthlyBaseDate: overrides.monthlyBaseDate ?? '2026-04-01',
    yearlyReturnPercent: overrides.yearlyReturnPercent ?? 4,
    yearlyReturnValue: overrides.yearlyReturnValue ?? 40,
    yearlyBaseDate: overrides.yearlyBaseDate ?? '2026-01-01',
    usdCny: overrides.usdCny ?? 7.2,
    hkdCny: overrides.hkdCny ?? 0.92,
  };
}

describe('buildPortfolioYearHistory', () => {
  it('builds a same-year portfolio series, cashflows, and positions without crossing years', () => {
    const result = buildPortfolioYearHistory({
      portfolio: { id: 'p2026', createdAt: '2026-02-20T09:00:00.000Z' },
      year: 2026,
      requestedDate: '2026-04-25',
      transactions: [
        {
          id: 'outside-previous-year',
          date: '2025-12-31',
          type: 'DEPOSIT',
          amount: 999,
          currency: 'CNY',
        },
        {
          id: 'first-business-fact',
          date: '2026-02-01',
          type: 'DEPOSIT',
          amount: 1000,
          currency: 'CNY',
        },
        {
          id: 'inside-withdraw',
          date: '2026-04-01',
          type: 'WITHDRAW',
          amount: 10,
          currency: 'HKD',
          exchangeRate: 0.92,
        },
      ],
      portfolioSnapshots: [
        snapshot({ date: '2025-12-31', netAssets: 5000 }),
        snapshot({ date: '2026-02-25', netAssets: 1000 }),
        snapshot({ date: '2026-04-24', netAssets: 1100, dailyPnl: -5 }),
      ],
      positionSnapshots: [
        {
          date: '2025-12-31',
          assetCode: 'hk00005',
          quantity: 1,
          currentPrice: 60,
          marketValue: 60,
          asset: { name: 'Ignored Previous Year', market: 'HK' },
        },
        {
          date: '2026-04-24',
          assetCode: 'hk00700',
          quantity: 100,
          currentPrice: 493.4,
          marketValue: 45000,
          dailyPnl: -100,
          totalPnl: 1000,
          dailyPct: -0.2,
          totalPnlPercent: 2.5,
          asset: { name: 'Tencent', market: 'HK' },
        },
      ],
    });

    expect(result.portfolio_year_window).toMatchObject({
      year: 2026,
      planned_start: '2026-01-01',
      business_start: '2026-02-01',
      effective_start: '2026-02-01',
      requested_end: '2026-04-25',
      resolved_end: '2026-04-24',
      latest_available_date: '2026-04-24',
      snapshot_days: 2,
    });
    expect(result.portfolio_year_window.missing_days).toEqual([
      '2026-01-01..2026-02-24',
      '2026-02-26..2026-04-23',
    ]);
    expect(result.portfolio.series.map((point) => point.date)).toEqual([
      '2026-02-25',
      '2026-04-24',
    ]);
    expect(result.portfolio.series[1]).toEqual(
      expect.objectContaining({
        date: '2026-04-24',
        net_assets: 1100,
        cash: 200,
        total_market_value: 800,
        daily_pnl: -5,
        ytd_return_percent: 4,
        ytd_base_date: '2026-01-01',
      })
    );
    expect(result.portfolio.cashflows).toEqual([
      expect.objectContaining({
        transaction_id: 'first-business-fact',
        date: '2026-02-01',
        type: 'DEPOSIT',
        amount_cny: 1000,
      }),
      expect.objectContaining({
        transaction_id: 'inside-withdraw',
        date: '2026-04-01',
        type: 'WITHDRAW',
        amount_cny: 9.200000000000001,
        currency: 'HKD',
        exchange_rate: 0.92,
      }),
    ]);
    expect(result.portfolio.positions_by_date).toEqual([
      {
        date: '2026-04-24',
        positions: [
          expect.objectContaining({
            asset_code: 'hk00700',
            asset_name: 'Tencent',
            market: 'HK',
            currency: 'HKD',
            market_value_cny: 45000,
          }),
        ],
      },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'created_at_not_business_start',
        'resolved_end_before_requested_end',
        'position_snapshot_missing',
      ])
    );
  });

  it('warns when createdAt is only import time and a prior-year annual window has transactions but no snapshots', () => {
    const result = buildPortfolioYearHistory({
      portfolio: { id: 'p2025', createdAt: '2026-02-10T08:00:00.000Z' },
      year: 2025,
      requestedDate: '2025-12-31',
      transactions: [
        {
          id: 'deposit-2025',
          date: '2025-01-10T12:00:00+08:00',
          type: 'DEPOSIT',
          amount: 10000,
          currency: 'CNY',
        },
        {
          id: 'buy-2025',
          date: '2025-03-01',
          type: 'BUY',
          quantity: 100,
          price: 10,
          currency: 'CNY',
        },
      ],
      portfolioSnapshots: [snapshot({ date: '2026-02-25', netAssets: 12000 })],
      positionSnapshots: [
        {
          date: '2026-02-25',
          assetCode: 'sh600000',
          quantity: 100,
          currentPrice: 12,
          marketValue: 1200,
        },
      ],
    });

    expect(result.portfolio_year_window).toMatchObject({
      planned_start: '2025-01-01',
      business_start: '2025-01-10',
      effective_start: '2025-01-10',
      requested_end: '2025-12-31',
      resolved_end: null,
      latest_available_date: null,
      snapshot_days: 0,
      missing_days: ['2025-01-01..2025-12-31'],
    });
    expect(result.portfolio.series).toEqual([]);
    expect(result.portfolio.positions_by_date).toEqual([]);
    expect(result.portfolio.cashflows).toEqual([
      expect.objectContaining({
        transaction_id: 'deposit-2025',
        date: '2025-01-10',
        amount_cny: 10000,
      }),
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'portfolio_snapshot_missing',
        'transactions_without_snapshots',
        'created_at_not_business_start',
      ])
    );
  });

  it('starts later than year start when both createdAt and first facts are later', () => {
    const result = buildPortfolioYearHistory({
      portfolio: { id: 'new-year', createdAt: '2026-01-20T00:00:00.000Z' },
      year: 2026,
      requestedDate: '2026-01-31',
      transactions: [],
      portfolioSnapshots: [snapshot({ date: '2026-01-20' })],
      positionSnapshots: [
        {
          date: '2026-01-20',
          assetCode: 'usAAPL',
          quantity: 5,
          currentPrice: 190,
          marketValue: 950,
          asset: { name: 'Apple', market: 'US' },
        },
      ],
    });

    expect(result.portfolio_year_window).toMatchObject({
      planned_start: '2026-01-01',
      business_start: '2026-01-20',
      effective_start: '2026-01-20',
      resolved_end: '2026-01-20',
      latest_available_date: '2026-01-20',
    });
    expect(result.portfolio_year_window.missing_days).toEqual([
      '2026-01-01..2026-01-19',
    ]);
    expect(result.portfolio.positions_by_date[0].positions[0]).toEqual(
      expect.objectContaining({
        asset_code: 'usAAPL',
        currency: 'USD',
      })
    );
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'portfolio_started_after_year_start',
        'resolved_end_before_requested_end',
      ])
    );
  });

  it('warns when portfolio snapshots exist but matching position snapshots are missing', () => {
    const result = buildPortfolioYearHistory({
      portfolio: { id: 'missing-positions', createdAt: '2026-01-01' },
      year: 2026,
      requestedDate: '2026-04-24',
      transactions: [],
      portfolioSnapshots: [snapshot({ date: '2026-04-24' })],
      positionSnapshots: [],
    });

    expect(result.portfolio.series).toHaveLength(1);
    expect(result.portfolio.positions_by_date).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'position_snapshot_missing',
          details: { dates: ['2026-04-24'] },
        }),
      ])
    );
  });
});
