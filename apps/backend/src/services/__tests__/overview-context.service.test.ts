import {
  getPortfolioOverviewContext,
  PortfolioOverviewContextResponse,
} from '../overviewContextService';

function createDependencies() {
  return {
    prisma: {
      portfolioSnapshot: {
        findFirst: jest.fn(),
      },
      positionSnapshot: {
        findMany: jest.fn(),
      },
      quoteSnapshot: {
        findMany: jest.fn(),
      },
      exchangeRateSnapshot: {
        findMany: jest.fn(),
      },
    },
    m2Repository: {
      listSourceHealth: jest.fn(),
      listYieldCurveSnapshots: jest.fn(),
      listMacroIndicatorSnapshots: jest.fn(),
    },
    now: () => new Date('2026-04-25T10:00:00.000Z'),
  };
}

const snapshot = {
  portfolioId: 'p1',
  date: '2026-04-24',
  totalMarketValue: 800,
  netAssets: 1000,
  totalPnl: 120,
  dailyPnl: 10,
  cash: 200,
  yearlyReturnPercent: 12,
  yearlyReturnValue: 110,
  yearlyBaseDate: '2026-01-01',
  usdCny: 7.2,
  hkdCny: 0.92,
  createdAt: new Date('2026-04-24T08:00:00.000Z'),
};

describe('overviewContextService', () => {
  it('resolves a requested empty date to the latest available snapshot', async () => {
    const deps = createDependencies();
    deps.prisma.portfolioSnapshot.findFirst
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot);
    deps.prisma.positionSnapshot.findMany.mockResolvedValue([
      {
        assetCode: 'hk00700',
        quantity: 100,
        currentPrice: 300,
        marketValue: 300,
        totalPnl: 20,
        dailyPnl: 5,
        dailyPct: 1.2,
        asset: { name: 'Tencent', market: 'HK' },
      },
    ]);
    deps.prisma.quoteSnapshot.findMany.mockResolvedValue([
      {
        assetCode: 'hk00700',
        currentPrice: 300,
        weeklyChangePercent: 2,
      },
    ]);
    deps.prisma.exchangeRateSnapshot.findMany.mockResolvedValue([
      { pair: 'USD-CNY', date: '2026-01-01', rate: 7 },
      { pair: 'USD-CNY', date: '2026-04-24', rate: 7.2 },
      { pair: 'HKD-CNY', date: '2026-01-01', rate: 0.9 },
      { pair: 'HKD-CNY', date: '2026-04-24', rate: 0.92 },
    ]);
    deps.m2Repository.listYieldCurveSnapshots.mockResolvedValue([
      {
        date: '2026-04-24',
        country: 'US',
        tenor: '2Y',
        yieldPercent: 4,
        sourceId: 'akshare-yield',
        status: 'SUCCESS',
        createdAt: new Date('2026-04-24T01:00:00.000Z'),
        updatedAt: new Date('2026-04-24T01:00:00.000Z'),
      },
      {
        date: '2026-04-24',
        country: 'US',
        tenor: '10Y',
        yieldPercent: 4.5,
        sourceId: 'akshare-yield',
        status: 'SUCCESS',
        createdAt: new Date('2026-04-24T01:00:00.000Z'),
        updatedAt: new Date('2026-04-24T01:00:00.000Z'),
      },
    ]);
    deps.m2Repository.listMacroIndicatorSnapshots.mockResolvedValue([
      {
        date: '2026-04-24',
        indicatorId: 'DXY',
        value: 106,
        unit: 'index',
        sourceId: 'fred-macro',
        status: 'SUCCESS',
        createdAt: new Date('2026-04-24T01:00:00.000Z'),
        updatedAt: new Date('2026-04-24T01:00:00.000Z'),
      },
    ]);
    deps.m2Repository.listSourceHealth.mockResolvedValue([
      {
        id: 1,
        sourceId: 'fred-macro',
        domain: 'macro',
        status: 'HEALTHY',
        checkedAt: new Date('2026-04-24T01:00:00.000Z'),
        consecutiveFailures: 0,
        createdAt: new Date('2026-04-24T01:00:00.000Z'),
        updatedAt: new Date('2026-04-24T01:00:00.000Z'),
      },
    ]);

    const result = (await getPortfolioOverviewContext(
      {
        portfolioId: 'p1',
        requestedDate: '2026-04-25',
      },
      deps
    )) as PortfolioOverviewContextResponse;

    expect(result.statusCode).toBe(200);
    expect(result.body.meta).toEqual(
      expect.objectContaining({
        requested_date: '2026-04-25',
        resolved_date: '2026-04-24',
        latest_available_date: '2026-04-24',
      })
    );
    expect(result.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'date_resolved_to_latest_available' }),
      ])
    );
    expect(result.body.data?.portfolio.returns).toEqual(
      expect.objectContaining({
        ytd: expect.objectContaining({ percent: 12 }),
      })
    );
    expect(result.body.data?.market).toEqual(
      expect.objectContaining({
        requested: ['hk00700'],
        found: ['hk00700'],
        missing: [],
      })
    );
    expect(result.body.data?.yield).toEqual(
      expect.objectContaining({
        spreads: expect.objectContaining({ us_10y_2y_bp: 50 }),
      })
    );
  });

  it('keeps the envelope successful and warns when optional facts are missing', async () => {
    const deps = createDependencies();
    deps.prisma.portfolioSnapshot.findFirst.mockResolvedValue(snapshot);
    deps.prisma.positionSnapshot.findMany.mockResolvedValue([
      {
        assetCode: 'usAAPL',
        quantity: 10,
        currentPrice: 190,
        marketValue: 1900,
        asset: { name: 'Apple', market: 'US' },
      },
    ]);
    deps.prisma.quoteSnapshot.findMany.mockResolvedValue([]);
    deps.prisma.exchangeRateSnapshot.findMany.mockResolvedValue([]);
    deps.m2Repository.listYieldCurveSnapshots.mockResolvedValue([]);
    deps.m2Repository.listMacroIndicatorSnapshots.mockResolvedValue([]);
    deps.m2Repository.listSourceHealth.mockResolvedValue([]);

    const result = await getPortfolioOverviewContext(
      { portfolioId: 'p1' },
      deps
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.data?.yield).toBeNull();
    expect(result.body.data?.macro).toBeNull();
    expect(result.body.data?.market.missing).toEqual(['usAAPL']);
    expect(result.body.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'quote_snapshot_missing',
        'yield_curve_missing',
        'macro_indicators_missing',
        'source_health_missing',
      ])
    );
  });

  it('returns a no-data envelope when no portfolio snapshot can be resolved', async () => {
    const deps = createDependencies();
    deps.prisma.portfolioSnapshot.findFirst.mockResolvedValue(null);

    const result = await getPortfolioOverviewContext(
      { portfolioId: 'p1', requestedDate: '2026-01-01' },
      deps
    );

    expect(result.statusCode).toBe(404);
    expect(result.body.data).toBeNull();
    expect(result.body.errors[0]).toMatchObject({
      code: 'overview_context_not_found',
    });
    expect(deps.prisma.positionSnapshot.findMany).not.toHaveBeenCalled();
  });
});
