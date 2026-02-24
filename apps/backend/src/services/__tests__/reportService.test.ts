jest.mock('../currencyService', () => ({
  getExchangeRate: jest.fn(),
  getExchangeRateInfo: jest.fn(),
}));

import { PortfolioDetail, TransactionType } from '../../types';
import { getExchangeRate, getExchangeRateInfo } from '../currencyService';
import { reportService } from '../reportService';

const mockedGetExchangeRate = getExchangeRate as jest.MockedFunction<
  typeof getExchangeRate
>;
const mockedGetExchangeRateInfo = getExchangeRateInfo as jest.MockedFunction<
  typeof getExchangeRateInfo
>;

function createPortfolioDetail(): PortfolioDetail {
  return {
    id: 'portfolio-1',
    name: '测试组合',
    cash: 1000,
    initialCash: 1000,
    leverage: {
      totalAmount: 0,
      usedAmount: 0,
      availableAmount: 0,
      costRate: 0,
    },
    transactions: [
      {
        id: 'tx-1',
        date: '2026-02-09T10:00:00',
        type: TransactionType.DEPOSIT,
        amount: 1000,
      },
    ],
    positions: [],
    totalAssets: 1000,
    netAssets: 1000,
    totalMarketValue: 0,
    netDepositedCash: 1000,
    totalCommission: 0,
    leverageCost: 0,
    dailyPnl: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
  };
}

describe('ReportService - Exchange Rates in Markdown Export', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockedGetExchangeRate.mockReset();
    mockedGetExchangeRateInfo.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses cached realtime exchange rates and timestamp in markdown report', async () => {
    mockedGetExchangeRate.mockImplementation((from: string, to?: string) => {
      const pair = to ? `${from}-${to}` : from;
      if (pair === 'USD-CNY') return 6.939;
      if (pair === 'HKD-CNY') return 0.8881;
      return null;
    });

    mockedGetExchangeRateInfo.mockImplementation((pair: string) => {
      if (pair === 'USD-CNY') {
        return { rate: 6.939, timestamp: '2026-02-09T12:39:14' };
      }
      if (pair === 'HKD-CNY') {
        return { rate: 0.8881, timestamp: '2026-02-09T12:37:00' };
      }
      return null;
    });

    const markdown = await reportService.generateMarkdownReport(
      createPortfolioDetail(),
      false
    );

    expect(markdown).toContain(
      '汇率：1 USD = 6.9390 CNY, 1 HKD = 0.8881 CNY（更新时间: 2026/02/09 12:39:14）'
    );
  });

  it('falls back to default exchange rates and report timestamp when cache is missing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-09T12:56:13'));

    mockedGetExchangeRate.mockReturnValue(null);
    mockedGetExchangeRateInfo.mockReturnValue(null);

    const markdown = await reportService.generateMarkdownReport(
      createPortfolioDetail(),
      false
    );

    expect(markdown).toContain(
      '汇率：1 USD = 7.2886 CNY, 1 HKD = 0.9394 CNY（更新时间: 2026/02/09 12:56:13）'
    );
  });
});
