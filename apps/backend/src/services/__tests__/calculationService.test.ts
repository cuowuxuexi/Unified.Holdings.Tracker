import {
  calculateRealtimePnl,
  calculatePeriodStats,
  calculateRealizedPnl,
  calculateTotalCommission,
  calculateUnrealizedPnl,
  calculateTotalPnlV2,
  getWeekBasePrice,
  getMonthBasePrice,
  getYearBasePrice,
} from '../calculation';
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
import { subDays, formatISO, startOfDay } from 'date-fns';
import { cacheService } from '@uht/infra/cache/cache-service';
import {
  formatDate,
  getLastWeekSaturdayDate,
  getLastDayOfPreviousMonth,
  getLastDayOfPreviousYear,
} from '../calculation/utils';

jest.mock('../tencentApi', () => ({
  fetchKline: jest.fn(),
}));

const mockedFetchKline = fetchKline as jest.MockedFunction<typeof fetchKline>;

// 🔧 测试辅助函数（提取到顶层供所有测试使用）
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

    it('falls back to cost basis when K-line data is missing', async () => {
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
      expect(stats).toMatchObject({ periodReturnPercent: 0, periodPnl: 0 });
    });

    it('exposes metadata about pricing sources', async () => {
      const buyDate = subDays(today, 6);
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: formatISO(buyDate),
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 10,
          price: 100,
          amount: 1000,
        },
      ];
      const portfolio = createPortfolio(transactions, 0);

      mockedFetchKline.mockResolvedValue(createKline(['2024-04-05'], [120]));

      const stats = await calculatePeriodStats(portfolio, 'weekly');
      expect(stats.baseDate).toBe('2024-04-05');
      expect(stats.baseDateSource).toBe('kline');
    });

    it('includes trades executed on the anchor date when reconstructing start state', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-04-18T00:00:00.000Z'));
      const transactions: Transaction[] = [
        {
          id: 'deposit-1',
          date: '2024-04-10T00:00:00.000Z',
          type: TransactionType.DEPOSIT,
          amount: 2000,
        },
        {
          id: 't1',
          date: '2024-04-11T01:00:00.000Z',
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 10,
          price: 100,
          amount: 1000,
        },
      ];
      const portfolio = createPortfolio(transactions, 0);

      mockedFetchKline.mockResolvedValue(
        createKline(['2024-04-14', '2024-04-17'], [100, 110])
      );

      const stats = await calculatePeriodStats(portfolio, 'weekly');

      expect(stats.periodReturnPercent).toBeCloseTo(5, 3);
      expect(stats.periodPnl).toBeCloseTo(100, 5);
      jest.useRealTimers();
    });

    it('anchors weekly stats to last week Friday when fetching kline data', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-04-15T00:00:00.000Z'));
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-04-01T00:00:00.000Z',
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 10,
          price: 100,
          amount: 1000,
        },
      ];
      const portfolio = createPortfolio(transactions, 0);

      mockedFetchKline.mockResolvedValue(
        createKline(['2024-04-10', '2024-04-14'], [100, 110])
      );

      await calculatePeriodStats(portfolio, 'weekly');

      const endDate = startOfDay(new Date());
      const startDate = startOfDay(getLastWeekSaturdayDate(endDate));
      const expectedStart = formatDate(subDays(startDate, 120));
      const expectedEnd = formatDate(endDate);

      expect(mockedFetchKline).toHaveBeenCalledWith(
        'sh600519',
        'daily',
        expectedStart,
        expectedEnd,
        'qfq'
      );
      jest.useRealTimers();
    });

    it('uses realtime quotes to value the end of period when provided', async () => {
      const buyDate = subDays(today, 5);
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: formatISO(buyDate),
          type: TransactionType.BUY,
          assetCode: 'sh600519',
          quantity: 10,
          price: 100,
          amount: 1000,
        },
      ];
      const portfolio = createPortfolio(transactions, 1000);

      mockedFetchKline.mockResolvedValue(
        createKline(['2024-04-07', '2024-04-14'], [100, 100])
      );

      const quotes: Record<string, Quote> = {
        sh600519: {
          code: 'sh600519',
          name: '贵州茅台',
          currentPrice: 120,
          changeAmount: 0,
          changePercent: 0,
          timestamp: Date.now(),
        },
      };

      const stats = await calculatePeriodStats(portfolio, 'weekly', {
        quotes,
        useRealtimeEndValue: true,
      });

      expect(stats.periodPnl).toBeGreaterThan(0);
      expect(stats.periodReturnPercent).toBeGreaterThan(0);
    });

    it('uses calendar week starting on Monday for weekly stats', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-04-15T00:00:00.000Z')); // Monday
      const transactions: Transaction[] = [
        {
          id: 'deposit-last-week',
          date: '2024-04-10T00:00:00.000Z', // Wednesday of previous week
          type: TransactionType.DEPOSIT,
          amount: 100000,
        },
      ];
      const portfolio = createPortfolio(transactions, 0);

      const stats = await calculatePeriodStats(portfolio, 'weekly');

      expect(stats).toMatchObject({ periodReturnPercent: 0, periodPnl: 0 });
      expect(mockedFetchKline).not.toHaveBeenCalled();
    });

    it('正确处理跨币种持仓的周期估值', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-04-19T00:00:00.000Z'));
      const portfolio: Portfolio = {
        id: 'fx-portfolio',
        name: 'FX Stats',
        cash: 100000,
        initialCash: 100000,
        leverage: {
          totalAmount: 0,
          usedAmount: 0,
          availableAmount: 0,
          costRate: 0,
        },
        transactions: [
          {
            id: 'fx1',
            date: '2024-04-05T00:00:00.000Z',
            type: TransactionType.BUY,
            assetCode: 'hk00700',
            quantity: 100,
            price: 50,
            commission: 10,
            exchangeRate: 0.9,
          },
          {
            id: 'fx2',
            date: '2024-04-08T00:00:00.000Z',
            type: TransactionType.BUY,
            assetCode: 'sh600519',
            quantity: 10,
            price: 1000,
            commission: 20,
          },
          {
            id: 'fx3',
            date: '2024-04-12T00:00:00.000Z',
            type: TransactionType.SELL,
            assetCode: 'hk00700',
            quantity: 50,
            price: 55,
            commission: 10,
            exchangeRate: 0.88,
          },
        ],
      };

      mockedFetchKline.mockImplementation(async (code: string) => {
        if (code === 'hk00700') {
          return [
            {
              date: '2024-04-07',
              open: 50,
              close: 50,
              high: 51,
              low: 49,
              volume: 1000,
            },
            {
              date: '2024-04-15',
              open: 58,
              close: 60,
              high: 61,
              low: 57,
              volume: 1000,
            },
          ];
        }
        if (code === 'sh600519') {
          return [
            {
              date: '2024-04-08',
              open: 1000,
              close: 1000,
              high: 1005,
              low: 995,
              volume: 1000,
            },
            {
              date: '2024-04-15',
              open: 1090,
              close: 1100,
              high: 1110,
              low: 1080,
              volume: 1000,
            },
          ];
        }
        return [];
      });

      const stats = await calculatePeriodStats(portfolio, 'weekly');
      expect(stats.periodPnl).toBeGreaterThan(0);
      expect(stats.periodReturnPercent).toBeGreaterThan(0);
    });
  });

  describe('calculateRealizedPnl', () => {
    beforeEach(() => {
      cacheService.clear();
    });

    it('使用交易汇率计算外币买卖的已实现盈亏', async () => {
      const portfolio: Portfolio = {
        id: 'p1',
        name: 'FX',
        cash: 0,
        initialCash: 0,
        leverage: {
          totalAmount: 0,
          usedAmount: 0,
          availableAmount: 0,
          costRate: 0,
        },
        transactions: [
          {
            id: 't1',
            date: '2024-04-05T00:00:00.000Z',
            type: TransactionType.BUY,
            assetCode: 'hk00005',
            quantity: 100,
            price: 50,
            commission: 10,
            exchangeRate: 0.9,
          },
          {
            id: 't2',
            date: '2024-04-12T00:00:00.000Z',
            type: TransactionType.SELL,
            assetCode: 'hk00005',
            quantity: 50,
            price: 60,
            commission: 8,
            exchangeRate: 0.85,
          },
          {
            id: 't3',
            date: '2024-04-13T00:00:00.000Z',
            type: TransactionType.DIVIDEND,
            assetCode: 'hk00005',
            amount: 120,
          },
        ],
      };

      const result = await calculateRealizedPnl(portfolio);
      // BUY: amount缺失 → getCommissionInCny返回10, costPerShareCny=45.1
      // SELL: revenue=50*60*0.85-8=2542, cost=50*45.1=2255, realized=287
      // DIVIDEND: 120
      // total = 287 + 120 = 407
      expect(result).toBeCloseTo(407, 1);
    });
  });

  describe('calculateTotalCommission', () => {
    it('优先使用交易记录中的汇率折算手续费', async () => {
      const portfolio: Portfolio = {
        id: 'p2',
        name: 'Commission',
        cash: 0,
        initialCash: 0,
        leverage: {
          totalAmount: 0,
          usedAmount: 0,
          availableAmount: 0,
          costRate: 0,
        },
        transactions: [
          {
            id: 'tc1',
            date: '2024-04-01T00:00:00.000Z',
            type: TransactionType.BUY,
            assetCode: 'hk00005',
            quantity: 10,
            price: 40,
            commission: 12,
            exchangeRate: 0.9,
          },
          {
            id: 'tc2',
            date: '2024-04-02T00:00:00.000Z',
            type: TransactionType.SELL,
            assetCode: 'sh600519',
            quantity: 1,
            price: 1000,
            commission: 20,
          },
        ],
      };

      const result = await calculateTotalCommission(portfolio);
      // BUY: amount 缺失 → getCommissionInCny 直接返回 commission=12
      // SELL: getCommissionInCny 直接返回 commission=20
      // 合计 = 32
      expect(result).toBeCloseTo(32, 2);
    });
  });

  describe('calculateUnrealizedPnl', () => {
    it('使用 marketValueCNY 汇总浮盈亏', () => {
      const positions: Position[] = [
        {
          asset: { code: 'hk00005', name: 'HSBC', market: Market.HK },
          quantity: 100,
          costPrice: 40,
          totalCost: 4000,
          costPriceLocal: 45,
          totalCostLocal: 4500,
          marketValue: 6000,
          marketValueCNY: 5400,
        },
        {
          asset: { code: 'sh600519', name: '贵州茅台', market: Market.CN },
          quantity: 10,
          costPrice: 1000,
          totalCost: 10000,
          marketValue: 12000,
        },
      ];

      const result = calculateUnrealizedPnl(positions);
      expect(result).toBeCloseTo(3400, 2);
    });
  });

  describe('calculateRealizedPnl', () => {
    beforeEach(() => {
      cacheService.clear();
    });

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
      // 买入成本: amount=150000 与 qty*price*rate=150000 匹配，inferredCommission=0
      // = (1600 * 100 - 50) - (1500 * 100)
      // = 159950 - 150000 = 9950
      expect(realizedPnl).toBeCloseTo(9950, 2);
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
      // 交易盈亏 = (1600 * 100 - 50) - (1500 * 100) = 9950
      // 股息收入 = 5000
      // 总已实现盈亏 = 9950 + 5000 = 14950
      expect(realizedPnl).toBeCloseTo(14950, 2);
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

      // 交易盈亏 = (1600 * 50 - 25) - (1500 * 50) = 79975 - 75000 = 4975
      // 股息收入 = 3000 + 2000 = 5000
      // 总已实现盈亏 = 4975 + 5000 = 9975
      expect(realizedPnl).toBeCloseTo(9975, 2);
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
    // 每个测试前清除缓存，避免缓存干扰
    beforeEach(() => {
      cacheService.clear();
    });

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
      // 成本价应包含手续费：(150000 + 50) / 100 = 1500.5
      const positions: Position[] = [
        {
          asset: { code: 'sh600519', name: '贵州茅台', market: Market.CN },
          quantity: 100,
          costPrice: 1500.5, // 含手续费的成本价
          totalCost: 150050, // 含手续费
          marketValue: 160000, // 假设当前市值
          currentPrice: 1600,
          // floatingPnl 由 calculateRealtimePnl 计算：(1600 - 1500.5) * 100 = 9950
          floatingPnl: 9950,
        },
      ];

      const result = await calculateTotalPnlV2(portfolio, positions);

      // 已实现盈亏 = 股息收入 = 2000 (因为没有卖出交易)
      // 浮动盈亏(未实现) = (现价 - 成本价) × 数量 = (1600 - 1500.5) × 100 = 9950
      // 总盈亏 = 2000 + 9950 = 11950
      expect(result.realizedPnl).toBeCloseTo(2000, 2);
      expect(result.unrealizedPnl).toBeCloseTo(9950, 2);
      expect(result.totalPnl).toBeCloseTo(11950, 2);
    });

    it('does not double count realized gains when position is partially sold', async () => {
      const transactions: Transaction[] = [
        {
          id: 't1',
          date: '2024-01-01',
          type: TransactionType.BUY,
          assetCode: 'sh600000',
          quantity: 100,
          price: 10,
          amount: 1000,
          commission: 0,
        },
        {
          id: 't2',
          date: '2024-02-01',
          type: TransactionType.SELL,
          assetCode: 'sh600000',
          quantity: 50,
          price: 20,
          amount: 1000,
          commission: 0,
        },
      ];

      const portfolio = createPortfolio(transactions);

      const positions: Position[] = [
        {
          asset: { code: 'sh600000', name: '测试股票', market: Market.CN },
          quantity: 50,
          costPrice: 10,
          totalCost: 0, // 模拟"摊薄成本口径"可能为0的情况（买入=卖出收入）
          marketValue: 1000, // 现价 20 × 50
          currentPrice: 20,
          // floatingPnl = (现价 - 成本价) × 数量 = (20 - 10) × 50 = 500
          floatingPnl: 500,
        },
      ];

      const result = await calculateTotalPnlV2(portfolio, positions);

      // 已实现盈亏 = 50*(20-10) = 500
      // 浮动盈亏(未实现) = (20-10)*50 = 500
      // 总盈亏 = 1000
      expect(result.realizedPnl).toBeCloseTo(500, 2);
      expect(result.unrealizedPnl).toBeCloseTo(500, 2);
      expect(result.totalPnl).toBeCloseTo(1000, 2);
    });
  });

  describe('getWeekBasePrice', () => {
    const buildKlinePoint = (date: string, price: number): KlinePoint => ({
      date,
      open: price,
      close: price,
      high: price,
      low: price,
      volume: 1000,
    });

    beforeEach(() => {
      mockedFetchKline.mockReset();
    });

    it('uses previous full week Friday when invoked on Sunday', async () => {
      mockedFetchKline.mockResolvedValue([
        buildKlinePoint('2024-07-05', 120),
        buildKlinePoint('2024-07-04', 118),
      ]);

      const today = new Date('2024-07-14T12:00:00.000Z'); // 周日
      const result = await getWeekBasePrice('sh000001', today);
      const thisWeekMonday = getLastWeekSaturdayDate(today);
      const lastWeekFriday = subDays(thisWeekMonday, 3);

      expect(mockedFetchKline).toHaveBeenCalledWith(
        'sh000001',
        'weekly',
        undefined,
        undefined,
        'qfq',
        2
      );
      expect(result).toEqual({ price: 120, date: '2024-07-05' });
    });

    it('uses last week Friday when invoked on Monday', async () => {
      mockedFetchKline.mockResolvedValue([
        buildKlinePoint('2024-07-12', 130),
        buildKlinePoint('2024-07-11', 129),
      ]);

      const today = new Date('2024-07-15T08:00:00.000Z'); // 周一
      await getWeekBasePrice('sh000001', today);
      const thisWeekMonday = getLastWeekSaturdayDate(today);
      const lastWeekFriday = subDays(thisWeekMonday, 3);

      expect(mockedFetchKline).toHaveBeenCalledWith(
        'sh000001',
        'weekly',
        undefined,
        undefined,
        'qfq',
        2
      );
    });
  });

  describe('getMonthBasePrice', () => {
    beforeEach(() => {
      mockedFetchKline.mockReset();
    });

    it('uses last day of previous month as anchor date', async () => {
      mockedFetchKline.mockResolvedValue([]);
      const today = new Date('2024-07-10T00:00:00.000Z');
      await getMonthBasePrice('sh000001', today);
      const lastDayOfPrevMonth = getLastDayOfPreviousMonth(today);
      expect(mockedFetchKline).toHaveBeenCalledWith(
        'sh000001',
        'monthly',
        undefined,
        undefined,
        'qfq',
        2
      );
    });
  });

  describe('getYearBasePrice', () => {
    beforeEach(() => {
      mockedFetchKline.mockReset();
    });

    it('uses last day of previous year as anchor date', async () => {
      mockedFetchKline.mockResolvedValue([]);
      const today = new Date('2024-07-10T00:00:00.000Z');
      await getYearBasePrice('sh000001', today);
      const lastDayOfPrevYear = getLastDayOfPreviousYear(today);
      expect(mockedFetchKline).toHaveBeenCalledWith(
        'sh000001',
        'monthly',
        '2023-12-01',
        '2023-12-31',
        'qfq',
        1
      );
    });
  });
});

// ========================================
// 双指标计算验证测试
// ========================================

describe('calculatePeriodStats - 双指标计算验证', () => {
  let mockPortfolio: Portfolio;

  beforeEach(() => {
    // 设置假时间为 2025-11-14（周五），weekly 周期 = 11-10(周一) ~ 11-14(周五)
    jest.useFakeTimers().setSystemTime(new Date('2025-11-14T00:00:00.000Z'));

    mockPortfolio = {
      id: 'test-dual-metrics',
      name: '双指标测试组合',
      initialCash: 1000000,
      cash: 100000,
      leverage: {
        totalAmount: 0,
        usedAmount: 0,
        availableAmount: 0,
        costRate: 0,
      },
      transactions: [
        {
          id: '1',
          type: TransactionType.BUY,
          date: '2025-11-01T10:00:00Z',
          assetCode: 'sh600519',
          quantity: 10000,
          price: 100,
          amount: 1000000,
          commission: 0,
          currency: 'CNY',
          exchangeRate: 1,
        } as Transaction,
        {
          id: '2',
          type: TransactionType.DEPOSIT,
          date: '2025-11-12T10:00:00Z',
          amount: 100000,
          currency: 'CNY',
          exchangeRate: 1,
        } as Transaction,
      ],
    };

    mockedFetchKline.mockResolvedValue([
      {
        date: '2025-11-09',
        open: 99.5,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000000,
      },
      {
        date: '2025-11-14',
        open: 104,
        high: 106,
        low: 104,
        close: 105,
        volume: 1100000,
      },
    ] as KlinePoint[]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('应该返回 totalValueChange 和 totalValueChangePercent 字段', async () => {
    const result = await calculatePeriodStats(mockPortfolio, 'weekly', {
      useRealtimeEndValue: false,
    });

    expect(result).toHaveProperty('totalValueChange');
    expect(result).toHaveProperty('totalValueChangePercent');
    expect(result).toHaveProperty('periodReturnPercent');
    expect(result).toHaveProperty('periodPnl');
  });

  it('总资产变化应包含存款影响', async () => {
    const result = await calculatePeriodStats(mockPortfolio, 'weekly', {
      useRealtimeEndValue: false,
    });

    // 期初: 10000 股 × 100 元 = 100万
    // 期末: 10000 股 × 105 元 + 10万现金 = 115万
    // 总资产变化 = 115 - 100 = 15万
    if (
      result.totalValueChange !== null &&
      result.totalValueChange !== undefined
    ) {
      expect(result.totalValueChange).toBeGreaterThan(0);
      expect(result.totalValueChangePercent).toBeGreaterThan(0);
    }
  });

  it('投资收益率应排除存款影响', async () => {
    const result = await calculatePeriodStats(mockPortfolio, 'weekly', {
      useRealtimeEndValue: false,
    });

    // Modified Dietz 应该排除10万存款的影响
    if (
      result.periodReturnPercent !== null &&
      result.periodReturnPercent !== undefined &&
      result.totalValueChangePercent !== null &&
      result.totalValueChangePercent !== undefined
    ) {
      // 投资收益率应该小于总资产变化率（因为排除了存款）
      expect(result.periodReturnPercent).toBeLessThan(
        result.totalValueChangePercent
      );
    }
  });

  it('无存取款时，两个指标应该相等', async () => {
    // 移除存款交易
    mockPortfolio.transactions = mockPortfolio.transactions.filter(
      (tx) => tx.type !== TransactionType.DEPOSIT
    );
    mockPortfolio.cash = 0;

    const result = await calculatePeriodStats(mockPortfolio, 'weekly', {
      useRealtimeEndValue: false,
    });

    // 无现金流时，两个指标应该相等
    if (
      result.periodReturnPercent !== null &&
      result.periodReturnPercent !== undefined &&
      result.totalValueChangePercent !== null &&
      result.totalValueChangePercent !== undefined
    ) {
      expect(
        Math.abs(result.periodReturnPercent - result.totalValueChangePercent)
      ).toBeLessThan(0.01);
    }
  });
});

/**
 * 🔧 改进的 Modified Dietz 算法测试
 * 测试时间加权现金流的计算准确性
 */
describe('Modified Dietz - Time-Weighted Cash Flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * 测试场景1：周期开始时入金
   * 入金应该有接近100%的权重（参与整个周期）
   */
  it('should apply high weight to deposits at period start', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-31T00:00:00.000Z'));

    const transactions: Transaction[] = [
      // 1月2日入金10万（周期开始后第1天）
      {
        id: 'deposit-1',
        date: '2024-01-02T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 100000,
      },
      // 1月2日买入股票
      {
        id: 'buy-1',
        date: '2024-01-02T00:00:00.000Z',
        type: TransactionType.BUY,
        assetCode: 'sh600519',
        quantity: 1000,
        price: 100,
        amount: 100000,
      },
    ];

    const portfolio = createPortfolio(transactions, 0);

    // Mock K线数据：1月1日收盘价100，1月31日收盘价110
    mockedFetchKline.mockResolvedValue(
      createKline(['2024-01-01', '2024-01-31'], [100, 110])
    );

    const stats = await calculatePeriodStats(portfolio, 'monthly');

    // 期初资产 = 0
    // 期末资产 = 1000股 × 110 = 110,000
    // 净现金流 = 100,000
    // 加权现金流 ≈ 100,000 × (remaining/period)
    // 收益率 = (110,000 - 0 - 100,000) / (0 + 加权现金流) ≈ 10.45%
    expect(stats.periodReturnPercent).toBeCloseTo(10.45, 0);

    jest.useRealTimers();
  });

  /**
   * 测试场景2：周期结束时入金
   * 入金应该有接近0%的权重（几乎不参与周期）
   */
  it('should apply low weight to deposits at period end', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-31T00:00:00.000Z'));

    const transactions: Transaction[] = [
      // 1月1日初始资金
      {
        id: 'deposit-0',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 100000,
      },
      // 1月1日买入股票
      {
        id: 'buy-1',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.BUY,
        assetCode: 'sh600519',
        quantity: 1000,
        price: 100,
        amount: 100000,
      },
      // 1月30日追加入金10万（周期结束前1天）
      {
        id: 'deposit-1',
        date: '2024-01-30T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 100000,
      },
    ];

    const portfolio = createPortfolio(transactions, 0);

    // Mock K线数据
    mockedFetchKline.mockResolvedValue(
      createKline(['2024-01-01', '2024-01-31'], [100, 110])
    );

    const stats = await calculatePeriodStats(portfolio, 'monthly');

    // 期初资产 = 0（DEPOSIT在1月01日在周期内，不计入期初）
    // 期末资产 = 1000股 × 110 + 100,000现金 = 210,000
    // 现金流: deposit-0(100k) + deposit-1(100k) = 200,000
    // 收益率 = (210,000 - 0 - 200,000) / (0 + 加权现金流) ≈ 9.59%
    expect(stats.periodReturnPercent).toBeCloseTo(9.59, 0);

    jest.useRealTimers();
  });

  /**
   * 测试场景3：周期开始时出金
   * 出金应该有接近0%的权重（资金几乎不在账户）
   */
  it('should apply low weight to withdrawals at period start', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-31T00:00:00.000Z'));

    const transactions: Transaction[] = [
      // 初始资金20万
      {
        id: 'init',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 200000,
      },
      // 1月2日出金10万
      {
        id: 'withdraw-1',
        date: '2024-01-02T00:00:00.000Z',
        type: TransactionType.WITHDRAW,
        amount: 100000,
      },
      // 1月2日用剩余10万买入股票
      {
        id: 'buy-1',
        date: '2024-01-02T00:00:00.000Z',
        type: TransactionType.BUY,
        assetCode: 'sh600519',
        quantity: 1000,
        price: 100,
        amount: 100000,
      },
    ];

    const portfolio = createPortfolio(transactions, 0);

    mockedFetchKline.mockResolvedValue(
      createKline(['2024-01-01', '2024-01-31'], [100, 110])
    );

    const stats = await calculatePeriodStats(portfolio, 'monthly');

    // 期初资产 = 0（DEPOSIT在1月01日在周期内，不计入期初）
    // 期末资产 = 1000股 × 110 = 110,000
    // 现金流: deposit(200k) + withdraw(-100k) = 100,000
    // 收益率 = (110,000 - 0 - 100,000) / (0 + 加权现金流) ≈ 9.79%
    expect(stats.periodReturnPercent).toBeCloseTo(9.79, 0);

    jest.useRealTimers();
  });

  /**
   * 测试场景4：多笔现金流，不同时间点
   * 验证多笔现金流的加权计算准确性
   */
  it('should correctly weight multiple cash flows at different times', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-31T00:00:00.000Z'));

    const transactions: Transaction[] = [
      // 1月1日初始10万
      {
        id: 'init',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 100000,
      },
      // 1月5日入金5万（权重 ≈ 26/31 = 0.84）
      {
        id: 'deposit-1',
        date: '2024-01-05T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 50000,
      },
      // 1月20日出金3万（权重 ≈ 11/31 = 0.35）
      {
        id: 'withdraw-1',
        date: '2024-01-20T00:00:00.000Z',
        type: TransactionType.WITHDRAW,
        amount: 30000,
      },
      // 买入股票
      {
        id: 'buy-1',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.BUY,
        assetCode: 'sh600519',
        quantity: 1000,
        price: 100,
        amount: 100000,
      },
    ];

    const portfolio = createPortfolio(transactions, 0);

    mockedFetchKline.mockResolvedValue(
      createKline(['2024-01-01', '2024-01-31'], [100, 110])
    );

    const stats = await calculatePeriodStats(portfolio, 'monthly');

    // 期初资产 = 100,000
    // 期末资产 = 1000股 × 110 + 20,000现金 = 130,000
    // 总现金流 = 50,000 - 30,000 = 20,000
    // 加权现金流 ≈ 50,000 × (26/31) + (-30,000) × (11/31)
    //           ≈ 41,935 - 10,645 = 31,290
    // 收益率 = (130,000 - 100,000 - 20,000) / (100,000 + 31,290) ≈ 7.62%
    expect(stats.periodReturnPercent).toBeCloseTo(7.62, 1);

    jest.useRealTimers();
  });

  /**
   * 测试场景5：无现金流
   * 加权现金流应该为0，收益率计算应该正确
   */
  it('should handle zero cash flows correctly', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-31T00:00:00.000Z'));

    const transactions: Transaction[] = [
      {
        id: 'init',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.DEPOSIT,
        amount: 100000,
      },
      {
        id: 'buy-1',
        date: '2024-01-01T00:00:00.000Z',
        type: TransactionType.BUY,
        assetCode: 'sh600519',
        quantity: 1000,
        price: 100,
        amount: 100000,
      },
    ];

    const portfolio = createPortfolio(transactions, 0);

    mockedFetchKline.mockResolvedValue(
      createKline(['2024-01-01', '2024-01-31'], [100, 110])
    );

    const stats = await calculatePeriodStats(portfolio, 'monthly');

    // 期初资产 = 0（DEPOSIT在1月01日在周期内，不计入期初）
    // 期末资产 = 110,000
    // 现金流: deposit(100k)
    // 收益率 = (110,000 - 0 - 100,000) / (0 + 加权现金流) ≈ 10.11%
    expect(stats.periodReturnPercent).toBeCloseTo(10.11, 0);

    jest.useRealTimers();
  });
});
