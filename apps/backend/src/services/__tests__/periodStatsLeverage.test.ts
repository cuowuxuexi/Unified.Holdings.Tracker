import { calculatePeriodStats } from '../calculation/period-stats';
import { fetchKline } from '../tencentApi';
import { Portfolio, TransactionType, Transaction, KlinePoint } from '../../types';

jest.mock('../tencentApi', () => ({
  fetchKline: jest.fn(),
}));

const mockedFetchKline = fetchKline as jest.MockedFunction<typeof fetchKline>;

const createKline = (dates: string[], prices: number[]): KlinePoint[] =>
  dates.map((date, idx) => ({
    date,
    open: prices[idx],
    close: prices[idx],
    high: prices[idx],
    low: prices[idx],
    volume: 1000,
  }));

describe('calculatePeriodStats - leverage aware cash reconstruction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('treats cash shortfall on BUY as leverage when portfolio has credit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-04-15T00:00:00.000Z'));

    const transactions: Transaction[] = [
      {
        id: 'buy-with-shortfall',
        date: '2024-04-10T00:00:00.000Z',
        type: TransactionType.BUY,
        assetCode: 'sh600519',
        quantity: 100,
        price: 20,
        commission: 0,
        currency: 'CNY',
        exchangeRate: 1,
      },
    ];

    const portfolio: Portfolio = {
      id: 'leveraged-period',
      name: 'Leveraged Period',
      cash: 0,
      initialCash: 1000,
      leverage: {
        totalAmount: 2000,
        usedAmount: 0,
        availableAmount: 2000,
        costRate: 0,
      },
      transactions,
    };

    mockedFetchKline.mockResolvedValue(
      // 覆盖不同时区下 startOfDay/toISOString 可能导致的日期偏移
      createKline(['2024-04-12', '2024-04-14', '2024-04-15'], [20, 22, 22])
    );

    const stats = await calculatePeriodStats(portfolio, 'weekly', {
      useRealtimeEndValue: false,
    });

    expect(stats.totalValueChange).toBeCloseTo(200, 6);
    expect(stats.totalValueChangePercent).toBeCloseTo(0.2, 6);
    expect(stats.periodReturnPercent).toBeCloseTo(0.2, 6);
  });
});
