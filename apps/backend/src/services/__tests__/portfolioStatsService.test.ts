import { portfolioStatsService } from '../portfolioStatsService';
import { Portfolio, TransactionType } from '../../types';
import { fetchQuotes } from '../tencentApi';
import {
  calculatePeriodStats,
  calculateTotalCommission,
  calculateTotalPnlV2,
} from '../calculation';

jest.mock('../tencentApi', () => ({
  fetchQuotes: jest.fn(),
}));

jest.mock('../calculation', () => {
  const actual = jest.requireActual('../calculation');
  return {
    ...actual,
    calculateRealtimePnl: jest.fn(
      (positions: any[], quotes: Record<string, any>) =>
        positions.map((pos) => ({
          ...pos,
          marketValue:
            (quotes[pos.asset.code]?.currentPrice ?? pos.costPrice ?? 0) *
            pos.quantity,
          dailyChange:
            (quotes[pos.asset.code]?.changeAmount ?? 0) * pos.quantity,
          totalPnl: 100,
        }))
    ),
    calculatePeriodStats: jest.fn(async () => ({
      periodReturnPercent: 0.12,
      periodPnl: 120,
    })),
    calculateTotalCommission: jest.fn(async () => 5),
    calculateLeverageCostByDay: jest.fn(() => 1.5),
    calculateTotalDividendIncome: jest.fn(() => 3),
    calculateTotalPnlV2: jest.fn(async () => ({
      realizedPnl: 10,
      unrealizedPnl: 20,
      totalPnl: 30,
    })),
  };
});

const mockedFetchQuotes = fetchQuotes as jest.MockedFunction<
  typeof fetchQuotes
>;
const mockedPeriodStats = calculatePeriodStats as jest.MockedFunction<
  typeof calculatePeriodStats
>;
const mockedTotalCommission = calculateTotalCommission as jest.MockedFunction<
  typeof calculateTotalCommission
>;
const mockedTotalPnlV2 = calculateTotalPnlV2 as jest.MockedFunction<
  typeof calculateTotalPnlV2
>;

const basePortfolio: Portfolio = {
  id: 'test-portfolio',
  name: '测试组合',
  cash: 10000,
  initialCash: 10000,
  leverage: { totalAmount: 0, usedAmount: 0, availableAmount: 0, costRate: 0 },
  transactions: [
    {
      id: 'tx-1',
      portfolioId: 'test-portfolio',
      type: TransactionType.BUY,
      date: new Date('2024-01-01').toISOString(),
      assetCode: 'sh600000',
      quantity: 100,
      price: 10,
      amount: 1000,
      commission: 5,
      currency: 'CNY',
    },
  ],
};

describe('portfolioStatsService', () => {
  beforeEach(() => {
    portfolioStatsService.clearAllCache();
    jest.clearAllMocks();
    mockedFetchQuotes.mockResolvedValue([
      {
        code: 'sh600000',
        name: '平安银行',
        currentPrice: 12,
        changeAmount: 0.5,
        timestamp: Date.now(),
      } as any,
    ]);
  });

  it('should compute stats and reuse cache', async () => {
    const stats1 = await portfolioStatsService.getFullStats(basePortfolio, {
      includePeriods: ['weekly', 'monthly'],
    });

    expect(stats1.cached).toBe(false);
    expect(stats1.positions).toHaveLength(1);
    expect(stats1.totalCommission).toBe(5);
    expect(stats1.totalPnl).toBe(30);
    expect(mockedPeriodStats).toHaveBeenCalled();
    expect(mockedFetchQuotes).toHaveBeenCalledTimes(1);

    const stats2 = await portfolioStatsService.getFullStats(basePortfolio, {
      includePeriods: ['weekly', 'monthly'],
    });
    expect(stats2.cached).toBe(true);
    expect(mockedFetchQuotes).toHaveBeenCalledTimes(1);
  });

  it('should clear cache for a portfolio', async () => {
    await portfolioStatsService.getFullStats(basePortfolio);
    expect(mockedTotalCommission).toHaveBeenCalledTimes(1);

    portfolioStatsService.clearCache(basePortfolio.id);
    mockedTotalCommission.mockClear();
    mockedFetchQuotes.mockClear();

    const refreshed = await portfolioStatsService.getFullStats(basePortfolio);
    expect(refreshed.cached).toBe(false);
    expect(mockedFetchQuotes).toHaveBeenCalledTimes(1);
    expect(mockedTotalCommission).toHaveBeenCalledTimes(1);
  });

  it('should recompute when includePeriods changes', async () => {
    await portfolioStatsService.getFullStats(basePortfolio, {
      includePeriods: ['weekly'],
    });
    mockedPeriodStats.mockClear();

    await portfolioStatsService.getFullStats(basePortfolio, {
      includePeriods: ['daily'],
    });
    expect(mockedPeriodStats).toHaveBeenCalled();
  });
});
