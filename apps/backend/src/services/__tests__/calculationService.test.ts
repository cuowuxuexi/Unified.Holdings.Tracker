import {
  calculateRealtimePnl,
  calculatePeriodStats,
  calculateIndexPeriodChanges,
  calculateRealizedPnl,
  calculateTotalPnlV2,
} from '../calculationService';
import { fetchKline } from '../tencentApi';
import {
  Position,
  Quote,
  Portfolio,
  TransactionType,
  Market,
  Transaction,
  KlinePoint,
} from '../../types';
import { subDays, formatISO } from 'date-fns';

jest.mock('../tencentApi', () => ({
  fetchKline: jest.fn(),
}));

const mockedFetchKline = fetchKline as jest.MockedFunction<typeof fetchKline>;

describe('Calculation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // 清理未完成的异步操作和定时器
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });
  describe('calculateRealtimePnl', () => {
    const basePositions: Position[] = [
      {
        asset: { code: 'sh600519', name: '贵州茅台', market: Market.CN },
        quantity: 100,
        costPrice: 1500,
        totalCost: 150000,
        marketValue: 0,
      },
      {
        asset: { code: 'hk00700', name: '腾讯控股', market: Market.HK },
        quantity: 500,
        costPrice: 350,
        totalCost: 175000,
        marketValue: 0,
      },
    ];

    const quotes: Record<string, Quote> = {
      sh600519: {
        code: 'sh600519',
        name: '贵州茅台',
        currentPrice: 1668,
        changeAmount: -12,
        changePercent: -0.71,
        timestamp: Date.now(),
      },
      hk00700: {
        code: 'hk00700',
        name: '腾讯控股',
        currentPrice: 380,
        changeAmount: -2,
        changePercent: -0.52,
        timestamp: Date.now(),
      },
    };

    it('calculates realtime PnL when quotes exist', () => {
      const positions = JSON.parse(JSON.stringify(basePositions)) as Position[];
      const result = calculateRealtimePnl(positions, quotes);

      expect(result).toHaveLength(2);
      const maotai = result.find((p) => p.asset.code === 'sh600519');
      expect(maotai?.marketValue).toBe(166800);
      expect(maotai?.totalPnl).toBeCloseTo(16800);
    });

    it('gracefully handles missing quote data', () => {
      const positions = JSON.parse(JSON.stringify(basePositions)) as Position[];
      positions.push({
        asset: { code: 'usAAPL', name: '苹果', market: Market.US },
        quantity: 10,
        costPrice: 150,
        totalCost: 1500,
        marketValue: 0,
      });

      const result = calculateRealtimePnl(positions, quotes);
      const apple = result.find((p) => p.asset.code === 'usAAPL');
      expect(apple?.currentPrice).toBeUndefined();
      expect(apple?.marketValue).toBe(0);
    });
  });

  describe('calculatePeriodStats', () => {
    beforeEach(() => {
      mockedFetchKline.mockReset();
    });
    const createPortfolio = (
      transactions: Transaction[],
      initialCash = 200000
    ): Portfolio => ({
      id: 'p1',
      name: 'Test',
      cash: initialCash,
      initialCash,
      leverage: {
        totalAmount: 0,
        usedAmount: 0,
        availableAmount: 0,
        costRate: 0,
      },
      transactions,
    });

    const createKline = (dates: string[], prices: number[]): KlinePoint[] =>
      dates.map((date, idx) => ({
        date,
        open: prices[idx],
        close: prices[idx],
        high: prices[idx],
        low: prices[idx],
        volume: 1000,
      }));

    const today = new Date('2024-04-15T00:00:00.000Z');

    it('returns period stats when historical prices exist', async () => {
      const buyDate = subDays(today, 5);
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: formatISO(buyDate),
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1500,
          amount: 150000,
          commission: 50,
        },
      ];
      const portfolio = createPortfolio(transactions);

      mockedFetchKline.mockResolvedValue(
        createKline(['2024-04-07', '2024-04-14'], [1480, 1668])
      );

      const stats = await calculatePeriodStats(portfolio, 'weekly');

      expect(mockedFetchKline).toHaveBeenCalledTimes(1);
      expect(stats.periodReturnPercent).not.toBeNull();
      expect(stats.periodPnl).not.toBeNull();
    });

    it('returns zero stats when portfolio has no transactions', async () => {
      const portfolio = createPortfolio([], 0);
      const stats = await calculatePeriodStats(portfolio, 'weekly');
      expect(stats).toEqual({ periodReturnPercent: 0, periodPnl: 0 });
      expect(mockedFetchKline).not.toHaveBeenCalled();
    });

    it('returns null stats when K-line data is missing', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: formatISO(subDays(today, 3)),
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 10,
          price: 10,
          amount: 100,
        },
      ];
      const portfolio = createPortfolio(transactions, 1000);

      mockedFetchKline.mockResolvedValue([]);

      const stats = await calculatePeriodStats(portfolio, 'weekly');
      expect(stats).toEqual({ periodReturnPercent: null, periodPnl: null });
    });
  });

  describe('calculateIndexPeriodChanges', () => {
    const baseDate = new Date('2024-01-31T00:00:00.000Z');
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(baseDate);
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    const quote: Quote = {
      code: 'sh000001',
      name: '上证指数',
      currentPrice: 120,
      changePercent: 0,
      changeAmount: 0,
      timestamp: Date.now(),
    };

    it('calculates yearly change when baseline exists', () => {
      const kline: KlinePoint[] = [
        {
          date: '2023-12-29',
          open: 100,
          high: 101,
          low: 99,
          close: 101,
          volume: 1000,
        },
        {
          date: '2024-01-15',
          open: 110,
          high: 112,
          low: 109,
          close: 111,
          volume: 1000,
        },
      ];

      const result = calculateIndexPeriodChanges('sh000001', kline, quote);
      const expected = ((quote.currentPrice! - 101) / 101) * 100;
      expect(result.yearChangePercent).toBeCloseTo(expected, 2);
      expect((result as any).yearChangeBaseDate).toBe('2023-12-29');
    });

    it('returns empty result when data is insufficient', () => {
      const result = calculateIndexPeriodChanges('sh000001', [], quote);
      expect(result).toEqual({});
    });
  });

  describe('calculateRealizedPnl', () => {
    const createPortfolio = (transactions: Transaction[]): Portfolio => ({
      id: 'test-portfolio',
      name: 'Test Portfolio',
      cash: 100000,
      initialCash: 100000,
      leverage: {
        totalAmount: 0,
        usedAmount: 0,
        availableAmount: 0,
        costRate: 0,
      },
      transactions,
    });

    it('calculates realized PnL from buy and sell transactions only', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-01-01',
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1500,
          amount: 150000,
          commission: 50,
        },
        {
          id: 't2',
          date: '2024-02-01',
          type: TransactionType.SELL,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1600,
          amount: 160000,
          commission: 50,
        },
      ];

      const portfolio = createPortfolio(transactions);
      const realizedPnl = await calculateRealizedPnl(portfolio);

      // 已实现盈亏 = 卖出收入 - 买入成本
      // = (1600 * 100 - 50) - (1500 * 100 + 50)
      // = 159950 - 150050 = 9900
      expect(realizedPnl).toBeCloseTo(9900, 2);
    });

    it('includes dividend income in realized PnL', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-01-01',
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1500,
          amount: 150000,
          commission: 50,
        },
        {
          id: 't2',
          date: '2024-01-15',
          type: TransactionType.DIVIDEND,
          assetCode: 'sh600519',
          amount: 5000, // 股息收入 5000 CNY
        },
        {
          id: 't3',
          date: '2024-02-01',
          type: TransactionType.SELL,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1600,
          amount: 160000,
          commission: 50,
        },
      ];

      const portfolio = createPortfolio(transactions);
      const realizedPnl = await calculateRealizedPnl(portfolio);

      // 已实现盈亏 = 交易盈亏 + 股息收入
      // 交易盈亏 = (1600 * 100 - 50) - (1500 * 100 + 50) = 9900
      // 股息收入 = 5000
      // 总已实现盈亏 = 9900 + 5000 = 14900
      expect(realizedPnl).toBeCloseTo(14900, 2);
    });

    it('handles multiple dividend transactions', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-01-01',
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1500,
          amount: 150000,
          commission: 50,
        },
        {
          id: 't2',
          date: '2024-01-15',
          type: TransactionType.DIVIDEND,
          assetCode: 'sh600519',
          amount: 3000,
        },
        {
          id: 't3',
          date: '2024-02-15',
          type: TransactionType.DIVIDEND,
          assetCode: 'sh600519',
          amount: 2000,
        },
        {
          id: 't4',
          date: '2024-03-01',
          type: TransactionType.SELL,
          assetCode: 'sh600519',
          quantity: 50,
          price: 1600,
          amount: 80000,
          commission: 25,
        },
      ];

      const portfolio = createPortfolio(transactions);
      const realizedPnl = await calculateRealizedPnl(portfolio);

      // 交易盈亏 = (1600 * 50 - 25) - (1500 * 50 + 25) = 79975 - 75025 = 4950
      // 股息收入 = 3000 + 2000 = 5000
      // 总已实现盈亏 = 4950 + 5000 = 9950
      expect(realizedPnl).toBeCloseTo(9950, 2);
    });

    it('returns zero for portfolio with no transactions', async () => {
      const portfolio = createPortfolio([]);
      const realizedPnl = await calculateRealizedPnl(portfolio);
      expect(realizedPnl).toBe(0);
    });

    it('handles dividend-only portfolio', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-01-15',
          type: TransactionType.DIVIDEND,
          assetCode: 'sh600519',
          amount: 1000,
        },
        {
          id: 't2',
          date: '2024-02-15',
          type: TransactionType.DIVIDEND,
          assetCode: 'hk00700',
          amount: 500,
        },
      ];

      const portfolio = createPortfolio(transactions);
      const realizedPnl = await calculateRealizedPnl(portfolio);

      // 只有股息收入，没有买卖交易
      expect(realizedPnl).toBeCloseTo(1500, 2);
    });
  });

  describe('calculateTotalPnlV2', () => {
    const createPortfolio = (transactions: Transaction[]): Portfolio => ({
      id: 'test-portfolio',
      name: 'Test Portfolio',
      cash: 100000,
      initialCash: 100000,
      leverage: {
        totalAmount: 0,
        usedAmount: 0,
        availableAmount: 0,
        costRate: 0,
      },
      transactions,
    });

    it('calculates total PnL including dividends', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-01-01',
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 100,
          price: 1500,
          amount: 150000,
          commission: 50,
        },
        {
          id: 't2',
          date: '2024-01-15',
          type: TransactionType.DIVIDEND,
          assetCode: 'sh600519',
          amount: 2000,
        },
      ];

      const portfolio = createPortfolio(transactions);

      // 当前持仓（未卖出）
      const positions: Position[] = [
        {
          asset: { code: 'sh600519', name: '贵州茅台', market: Market.CN },
          quantity: 100,
          costPrice: 1500,
          totalCost: 150050, // 含手续费
          marketValue: 160000, // 假设当前市值
          currentPrice: 1600,
        },
      ];

      const result = await calculateTotalPnlV2(portfolio, positions);

      // 已实现盈亏 = 股息收入 = 2000 (因为没有卖出交易)
      // 未实现盈亏 = 市值 - 成本 = 160000 - 150050 = 9950
      // 总盈亏 = 2000 + 9950 = 11950
      expect(result.realizedPnl).toBeCloseTo(2000, 2);
      expect(result.unrealizedPnl).toBeCloseTo(9950, 2);
      expect(result.totalPnl).toBeCloseTo(11950, 2);
    });
  });
});
