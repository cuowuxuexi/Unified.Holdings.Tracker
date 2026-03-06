import { prisma } from '../../lib/prisma';
import { container } from '../../container';
import { portfolioStatsService } from '../portfolioStatsService';
import { takeSnapshotForPortfolio } from '../snapshotService';
import { fetchKline } from '../tencentApi';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    portfolio: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../container', () => ({
  container: {
    getPortfolioUseCase: {
      execute: jest.fn(),
    },
    listPortfoliosUseCase: {
      execute: jest.fn(),
    },
  },
}));

jest.mock('../portfolioStatsService', () => ({
  portfolioStatsService: {
    getFullStats: jest.fn(),
  },
}));

jest.mock('../tencentApi', () => ({
  fetchKline: jest.fn(),
}));

jest.mock('../currencyService', () => ({
  getExchangeRateForAssetToCNY: jest.fn(async () => 1),
}));

describe('snapshotService - P0 snapshotDate kline backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (container.getPortfolioUseCase.execute as jest.Mock).mockResolvedValue({
      id: 'p1',
      name: '组合1',
      cash: 1000,
      initialCash: 1000,
      leverage: {
        totalAmount: 0,
        usedAmount: 0,
        availableAmount: 0,
        costRate: 0,
      },
      transactions: [],
    });

    (portfolioStatsService.getFullStats as jest.Mock).mockResolvedValue({
      totalMarketValue: 100,
      netAssets: 1100,
      totalPnl: 10,
      dailyPnl: 5,
      cash: 1000,
      positions: [
        {
          asset: { code: 'sh600519', name: '贵州茅台' },
          quantity: 2,
          currentPrice: 50,
          marketValue: 100,
        },
      ],
    });

    // 1) 查询 PortfolioSnapshot
    // 2) 查询 PositionSnapshot
    (prisma.$queryRawUnsafe as jest.Mock)
      .mockResolvedValueOnce([
        {
          cash: 1000,
          totalMarketValue: 100,
          netAssets: 1100,
        },
      ])
      .mockResolvedValueOnce([
        {
          assetCode: 'sh600519',
          quantity: 2,
          marketValue: 100,
        },
      ]);
  });

  it('使用 snapshotDate 的K线收盘价回填，并重算组合汇总', async () => {
    (fetchKline as jest.Mock).mockResolvedValue([
      {
        date: '2026-03-04',
        open: 50,
        close: 60,
        high: 61,
        low: 49,
        volume: 1000,
      },
    ]);

    await takeSnapshotForPortfolio('p1', '2026-03-04');

    const updatePositionCall = (
      prisma.$executeRawUnsafe as jest.Mock
    ).mock.calls.find(
      (args) =>
        typeof args[0] === 'string' &&
        (args[0] as string).includes('UPDATE "PositionSnapshot"')
    );

    expect(updatePositionCall).toBeDefined();
    expect(updatePositionCall?.[1]).toBe(60); // currentPrice
    expect(updatePositionCall?.[2]).toBe(120); // marketValue = 60 * 2

    const updatePortfolioCall = (
      prisma.$executeRawUnsafe as jest.Mock
    ).mock.calls.find(
      (args) =>
        typeof args[0] === 'string' &&
        (args[0] as string).includes('UPDATE "PortfolioSnapshot"')
    );

    expect(updatePortfolioCall).toBeDefined();
    expect(updatePortfolioCall?.[1]).toBe(120); // totalMarketValue
    expect(updatePortfolioCall?.[2]).toBe(1120); // netAssets = 120 + 1000 - 0
  });
});
