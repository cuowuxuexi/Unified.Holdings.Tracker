import { getPortfolioHistoryContext } from '../portfolioHistoryContextService';

function createDependencies(
  overrides: Partial<ReturnType<typeof baseRows>> = {}
) {
  const rows = { ...baseRows(), ...overrides };

  return {
    prisma: {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue(rows.portfolio),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue(rows.transactions),
      },
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue(rows.portfolioSnapshots),
      },
      positionSnapshot: {
        findMany: jest.fn().mockResolvedValue(rows.positionSnapshots),
      },
      exchangeRateSnapshot: {
        findMany: jest.fn().mockResolvedValue(rows.exchangeRates),
      },
      quoteSnapshot: {
        findMany: jest.fn().mockResolvedValue(rows.quoteRows),
      },
      indexSnapshot: {
        findMany: jest.fn().mockResolvedValue(rows.indexRows),
      },
      sourceRun: {
        findMany: jest.fn().mockResolvedValue(rows.sourceRuns),
      },
    },
    m2Repository: {
      listSourceHealth: jest.fn().mockResolvedValue(rows.sourceHealth),
      listYieldCurveSnapshots: jest.fn().mockResolvedValue(rows.yieldRows),
      listMacroIndicatorSnapshots: jest.fn().mockResolvedValue(rows.macroRows),
    },
    now: () => new Date('2026-04-25T10:00:00.000Z'),
  };
}

function baseRows() {
  return {
    portfolio: {
      id: 'p1',
      name: '2026投资组合',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    },
    transactions: [
      {
        id: 't1',
        date: new Date('2026-02-25T00:00:00.000Z'),
        type: 'DEPOSIT',
        amount: 1000,
        currency: 'CNY',
        exchangeRate: 1,
      },
    ],
    portfolioSnapshots: [
      snapshot('2026-04-20', 1000),
      snapshot('2026-04-24', 1200),
    ],
    positionSnapshots: [
      {
        date: '2026-04-24',
        assetCode: 'hk00700',
        quantity: 10,
        currentPrice: 400,
        marketValue: 4000,
        costPrice: 390,
        totalPnl: 100,
        dailyPnl: 10,
        dailyPct: 0.2,
        totalPnlPercent: 2.5,
        floatingPnl: 100,
        floatingPnlPercent: 2.5,
        asset: { name: '腾讯控股', market: 'HK' },
      },
    ],
    exchangeRates: [
      { date: '2026-04-17', pair: 'USD-CNY', rate: 7.1, source: 'fixture' },
      { date: '2026-04-24', pair: 'USD-CNY', rate: 7.2, source: 'fixture' },
      { date: '2026-04-24', pair: 'HKD-CNY', rate: 0.92, source: 'fixture' },
    ],
    quoteRows: [
      {
        assetCode: 'hk00700',
        date: '2026-04-24',
        timestamp: new Date('2026-04-24T08:00:00.000Z'),
        currentPrice: 400,
        changePercent: 1,
        changeAmount: 4,
        prevClosePrice: 396,
        weeklyChangePercent: 2,
        monthlyChangePercent: 3,
        yearlyChangePercent: 4,
      },
    ],
    indexRows: [
      {
        indexCode: 'sh000001',
        date: '2026-04-24',
        name: '上证指数',
        currentPrice: 3000,
        changePercent: 1,
        changeAmount: 30,
        weeklyChangePercent: 2,
        monthlyChangePercent: 3,
        yearlyChangePercent: 4,
      },
    ],
    yieldRows: [],
    macroRows: [],
    sourceRuns: [],
    sourceHealth: [],
  };
}

function snapshot(date: string, netAssets: number) {
  return {
    date,
    totalMarketValue: netAssets,
    netAssets,
    totalPnl: netAssets - 1000,
    dailyPnl: 10,
    cash: 100,
    leverageUsed: 0,
    leverageTotal: 0,
    leverageCostRate: 0,
    leverageCumulativeCost: 0,
    realizedPnl: 0,
    unrealizedPnl: netAssets - 1000,
    totalCommission: 1,
    netDepositedCash: 1000,
    totalDividendIncome: 0,
    totalPnlPercent: 20,
    dailyPnlPercent: 1,
    weeklyReturnPercent: 2,
    weeklyReturnValue: 20,
    weeklyBaseDate: '2026-04-17',
    monthlyReturnPercent: 3,
    monthlyReturnValue: 30,
    monthlyBaseDate: '2026-04-01',
    yearlyReturnPercent: 20,
    yearlyReturnValue: 200,
    yearlyBaseDate: '2026-01-01',
    usdCny: 7.2,
    hkdCny: 0.92,
  };
}

describe('portfolio history-context service', () => {
  it('returns annual portfolio and external windows with date fallback warning', async () => {
    const dependencies = createDependencies();

    const result = await getPortfolioHistoryContext(
      { portfolioId: 'p1', year: '2026', requestedDate: '2026-04-25' },
      dependencies as any
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.meta).toEqual(
      expect.objectContaining({
        source: 'uht.history-context',
        contract_version: 'm7.v0.1',
        requested_date: '2026-04-25',
        resolved_date: '2026-04-24',
        latest_available_date: '2026-04-24',
      })
    );
    expect(result.body.data?.portfolio_year_window).toEqual(
      expect.objectContaining({
        year: 2026,
        planned_start: '2026-01-01',
        requested_end: '2026-04-25',
        resolved_end: '2026-04-24',
      })
    );
    expect(result.body.data?.external_data_window).toEqual({
      start: '2026-01-01',
      end: '2026-04-24',
      first_phase_min_start: '2024-01-01',
    });
    expect(result.body.warnings.map((warning) => warning.code)).toContain(
      'date_resolved_to_latest_available'
    );
  });

  it('uses the latest same-year snapshot when date is omitted', async () => {
    const dependencies = createDependencies();

    const result = await getPortfolioHistoryContext(
      { portfolioId: 'p1', year: 2026 },
      dependencies as any
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.meta.requested_date).toBe('2026-04-24');
    expect(result.body.meta.resolved_date).toBe('2026-04-24');
  });

  it('rejects invalid year and invalid dates without querying dependencies', async () => {
    const dependencies = createDependencies();

    const invalidYear = await getPortfolioHistoryContext(
      { portfolioId: 'p1', year: '26' },
      dependencies as any
    );
    const invalidDate = await getPortfolioHistoryContext(
      { portfolioId: 'p1', year: 2026, requestedDate: '2026-99-99' },
      dependencies as any
    );

    expect(invalidYear.statusCode).toBe(400);
    expect(invalidYear.body.errors[0].code).toBe('invalid_year');
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.body.errors[0].code).toBe('invalid_date');
    expect(dependencies.prisma.portfolio.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty optional blocks plus warnings when yield macro and source health facts are absent', async () => {
    const dependencies = createDependencies();

    const result = await getPortfolioHistoryContext(
      { portfolioId: 'p1', year: 2026, requestedDate: '2026-04-24' },
      dependencies as any
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.data?.yield.records).toEqual([]);
    expect(result.body.data?.yield.spreads).toEqual({
      us_10y_2y_bp: null,
      cn_10y_2y_bp: null,
      cn_us_10y_bp: null,
    });
    expect(result.body.data?.macro.records).toEqual([]);
    expect(result.body.data?.source_health.current).toEqual([]);
    expect(result.body.data?.source_health.runs).toEqual([]);
    expect(result.body.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'yield_curve_missing',
        'macro_indicators_missing',
        'source_health_not_recorded',
      ])
    );
  });
});
