import { container } from '../../../container';
import { prisma } from '../../../lib/prisma';
import { Transaction, TransactionType } from '../../../types';
import { portfolioStatsService } from '../../portfolioStatsService';
import {
  AUTO_DIVIDEND_NOTE_PREFIX,
  clearDividendEventCache,
  syncPortfolioDividends,
} from '../dividendSettlementService';
import { aShareRows, hkRows } from './fixtures';

jest.mock('../../../lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  },
}));

jest.mock('../../../container', () => ({
  container: {
    getPortfolioUseCase: { execute: jest.fn() },
    addTransactionUseCase: { execute: jest.fn() },
    listPortfoliosUseCase: { execute: jest.fn() },
  },
}));

jest.mock('../../portfolioStatsService', () => ({
  portfolioStatsService: { clearCache: jest.fn() },
}));

jest.mock('../../currencyService', () => ({
  getExchangeRate: jest.fn(() => 0.85),
}));

const baseTransactions: Transaction[] = [
  {
    id: 'buy-tencent',
    date: '2026-01-01T05:57:00.000Z',
    type: TransactionType.BUY,
    assetCode: 'hk00700',
    quantity: 1200,
    price: 500,
  },
  {
    id: 'buy-hik',
    date: '2026-01-01T06:01:00.000Z',
    type: TransactionType.BUY,
    assetCode: 'sz002415',
    quantity: 6000,
    price: 30,
  },
];

function httpGet(url: string): Promise<string> {
  const parsed = new URL(url);
  const filter = parsed.searchParams.get('filter') ?? '';
  const data = filter.includes('00700')
    ? hkRows['00700']
    : filter.includes('002415')
      ? aShareRows['002415']
      : [];
  return Promise.resolve(JSON.stringify({ success: true, result: { data } }));
}

const queryRaw = prisma.$queryRawUnsafe as jest.Mock;
const executeRaw = prisma.$executeRawUnsafe as jest.Mock;
const addTransaction = container.addTransactionUseCase.execute as jest.Mock;

function mockSettlements(
  rows: Array<{ eventKey: string; status: string; transactionId: string }>
) {
  queryRaw.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM "DividendSettlement"')) return rows;
    if (sql.includes('FROM "ExchangeRateSnapshot"')) return [{ rate: 0.8635 }];
    return [];
  });
}

describe('syncPortfolioDividends', () => {
  let transactions: Transaction[];

  beforeEach(() => {
    jest.clearAllMocks();
    clearDividendEventCache();
    transactions = [...baseTransactions];
    (container.getPortfolioUseCase.execute as jest.Mock).mockImplementation(
      async () => ({ id: 'p1', transactions })
    );
    let created = 0;
    addTransaction.mockImplementation(async ({ transaction }) => {
      created += 1;
      // 仓储按日期重排：新交易不一定在末尾
      transactions = [
        { ...transaction, id: `new-${created}` },
        ...transactions,
      ];
      return { id: 'p1', transactions };
    });
    mockSettlements([]);
  });

  it('dry-run reports what would be booked without writing', async () => {
    const report = await syncPortfolioDividends(
      'p1',
      { dryRun: true, today: '2026-10-21' },
      httpGet
    );

    expect(
      report.items.map((item) => [
        item.event.assetCode,
        item.event.exDate,
        item.state,
        item.amountCny,
      ])
    ).toEqual([
      ['hk00700', '2026-05-15', 'TO_SETTLE', 4393.49], // 5088 × 0.8635
      ['sz002415', '2026-05-20', 'TO_SETTLE', 4500],
      ['sz002415', '2026-08-19', 'TO_SETTLE', 3300],
    ]);
    expect(addTransaction).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('books payable dividends once, at the pay-date rate, and records the settlement', async () => {
    const report = await syncPortfolioDividends(
      'p1',
      { today: '2026-10-21' },
      httpGet
    );

    expect(report.created).toBe(3);
    expect(addTransaction).toHaveBeenCalledWith({
      portfolioId: 'p1',
      transaction: expect.objectContaining({
        type: TransactionType.DIVIDEND,
        date: '2026-06-01T04:00:00.000Z',
        assetCode: 'hk00700',
        amount: 5088,
        currency: 'HKD',
        exchangeRate: 0.8635,
        notes: expect.stringMatching(
          new RegExp(`^${AUTO_DIVIDEND_NOTE_PREFIX}｜.*预扣20%`)
        ),
      }),
    });
    const inserts = executeRaw.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO "DividendSettlement"')
    );
    expect(inserts.map((call) => [call[2], call[6], call[7]])).toEqual([
      ['hk00700:2026-05-15:5.3:HKD', 'SETTLED', 'new-1'],
      ['sz002415:2026-05-20:0.75:CNY', 'SETTLED', 'new-2'],
      ['sz002415:2026-08-19:0.55:CNY', 'SETTLED', 'new-3'],
    ]);
    expect(portfolioStatsService.clearCache).toHaveBeenCalledWith('p1');
  });

  it('never re-creates a dividend the user deleted', async () => {
    mockSettlements([
      {
        eventKey: 'hk00700:2026-05-15:5.3:HKD',
        status: 'DISMISSED',
        transactionId: 'old-tx',
      },
    ]);

    const report = await syncPortfolioDividends(
      'p1',
      { today: '2026-10-21' },
      httpGet
    );

    expect(
      report.items.find((item) => item.event.assetCode === 'hk00700')?.state
    ).toBe('DISMISSED');
    expect(addTransaction).toHaveBeenCalledTimes(2);
    expect(addTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ assetCode: 'hk00700' }),
      })
    );
  });

  it('links a manually recorded dividend instead of booking it twice', async () => {
    transactions.push({
      id: 'manual-div',
      date: '2026-06-02T08:00:00.000Z',
      type: TransactionType.DIVIDEND,
      assetCode: 'hk00700',
      amount: 4400,
    });

    const report = await syncPortfolioDividends(
      'p1',
      { today: '2026-10-21' },
      httpGet
    );

    const tencent = report.items.find(
      (item) => item.event.assetCode === 'hk00700'
    );
    expect(tencent?.state).toBe('MATCHED_MANUAL');
    expect(tencent?.transactionId).toBe('manual-div');
    expect(report.matched).toBe(1);
    expect(report.created).toBe(2);
  });

  it('leaves dividends paid before the auto window for an explicit backfill', async () => {
    const report = await syncPortfolioDividends(
      'p1',
      { today: '2026-10-21', payDateFrom: '2026-09-21' },
      httpGet
    );

    expect(report.items.map((item) => item.state)).toEqual([
      'BACKFILL_AVAILABLE',
      'BACKFILL_AVAILABLE',
      'BACKFILL_AVAILABLE',
    ]);
    expect(addTransaction).not.toHaveBeenCalled();
  });
});
