import { Transaction, TransactionType } from '../../../types';
import {
  buildDividendEventKey,
  computeDividendEntitlements,
  quantityHeldBefore,
  resolveDividendTaxRates,
} from '../dividendEntitlement';
import {
  parseAShareDividendRows,
  parseHkDividendRows,
} from '../dividendSources';
import { aShareRows, hkRows } from './fixtures';

let seq = 0;
function tx(
  date: string,
  type: TransactionType,
  assetCode: string,
  quantity: number
): Transaction {
  seq += 1;
  return { id: `tx-${seq}`, date, type, assetCode, quantity, price: 1 };
}

// 生产组合 2026 年的真实交易（UTC 落库时间），只保留与分红相关的标的
const transactions: Transaction[] = [
  tx('2026-01-01T05:51:00.000Z', TransactionType.BUY, 'sh603259', 3900),
  tx('2026-01-01T05:54:00.000Z', TransactionType.BUY, 'sz002714', 6000),
  tx('2026-01-01T05:57:00.000Z', TransactionType.BUY, 'hk00700', 800),
  tx('2026-01-01T05:59:00.000Z', TransactionType.BUY, 'sh601318', 5000),
  tx('2026-01-01T06:01:00.000Z', TransactionType.BUY, 'sz002415', 8800),
  tx('2026-01-01T06:02:00.000Z', TransactionType.BUY, 'sh600276', 7000),
  tx('2026-01-30T06:10:00.000Z', TransactionType.SELL, 'sz002415', 1800),
  tx('2026-02-02T06:13:00.000Z', TransactionType.SELL, 'sz002415', 1000),
  tx('2026-02-02T06:13:00.000Z', TransactionType.SELL, 'sh603259', 400),
  tx('2026-02-02T06:14:00.000Z', TransactionType.SELL, 'sz002714', 1500),
  tx('2026-02-09T06:17:00.000Z', TransactionType.BUY, 'sh601318', 3500),
  tx('2026-02-10T05:39:00.000Z', TransactionType.SELL, 'sh603259', 500),
  tx('2026-02-10T05:42:00.000Z', TransactionType.BUY, 'hk00700', 200),
  tx('2026-02-12T01:56:00.000Z', TransactionType.BUY, 'hk00700', 200),
  tx('2026-05-18T01:39:00.000Z', TransactionType.BUY, 'sz000858', 600),
  tx('2026-05-28T01:48:00.000Z', TransactionType.SELL, 'sh603259', 3000),
  tx('2026-05-28T01:50:00.000Z', TransactionType.SELL, 'sh601318', 8500),
  tx('2026-07-01T09:15:00.000Z', TransactionType.BUY, 'hk00700', 200),
  tx('2026-07-01T09:19:00.000Z', TransactionType.BUY, 'sz000858', 900),
];

const events = [
  ...parseAShareDividendRows('sz000858', aShareRows['000858']).events,
  ...parseAShareDividendRows('sz002415', aShareRows['002415']).events,
  ...parseAShareDividendRows('sh600276', aShareRows['600276']).events,
  ...parseAShareDividendRows('sz002714', aShareRows['002714']).events,
  ...parseAShareDividendRows('sh601318', aShareRows['601318']).events,
  ...parseAShareDividendRows('sh603259', aShareRows['603259']).events,
  ...parseHkDividendRows('hk00700', hkRows['00700']).events,
];

describe('dividendEntitlement', () => {
  it('counts only trades dated before the ex date (Beijing calendar day)', () => {
    // 2026-05-28 09:50 北京时间卖出平安，6-10 除权时已无持仓
    expect(quantityHeldBefore(transactions, 'sh601318', '2026-06-10')).toBe(0);
    // 卖出当天就是股权登记日（5-28），5-29 除权时不再享有
    expect(quantityHeldBefore(transactions, 'sh603259', '2026-05-29')).toBe(0);
    expect(quantityHeldBefore(transactions, 'hk00700', '2026-05-15')).toBe(
      1200
    );
    expect(quantityHeldBefore(transactions, 'sz000858', '2026-07-16')).toBe(
      1500
    );
  });

  it('reproduces the 2026 dividends the production portfolio was entitled to', () => {
    const { entitlements } = computeDividendEntitlements({
      transactions,
      events,
      today: '2026-10-21',
      taxRates: { CN: 0, HK: 0.2, US: 0.1 },
    });

    expect(
      entitlements.map((item) => [
        item.event.assetCode,
        item.event.exDate,
        item.quantity,
        item.grossAmount,
        item.netAmount,
        item.status,
      ])
    ).toEqual(
      [
        ['sz002415', '2026-05-20', 6000, 4500, 4500, 'PAYABLE'],
        ['hk00700', '2026-05-15', 1200, 6360, 5088, 'PAYABLE'],
        ['sh600276', '2026-05-27', 7000, 1400, 1400, 'PAYABLE'],
        ['sz002714', '2026-05-27', 4500, 1921.5, 1921.5, 'PAYABLE'],
        ['sz000858', '2026-07-16', 1500, 3869.53, 3869.53, 'PAYABLE'],
        ['sz002415', '2026-08-19', 6000, 3300, 3300, 'PAYABLE'],
      ].sort(
        (left, right) =>
          String(left[1]).localeCompare(String(right[1])) ||
          String(left[0]).localeCompare(String(right[0]))
      )
    );
  });

  it('marks ex-dividend events with a future pay date as awaiting payment', () => {
    const { entitlements } = computeDividendEntitlements({
      transactions,
      events,
      today: '2026-05-20',
      taxRates: { CN: 0, HK: 0.2, US: 0.1 },
    });
    const tencent = entitlements.find(
      (item) => item.event.assetCode === 'hk00700'
    );

    expect(tencent?.status).toBe('AWAITING_PAYMENT');
  });

  it('builds stable event keys', () => {
    const tencent = events.find((event) => event.assetCode === 'hk00700');
    expect(tencent && buildDividendEventKey(tencent)).toBe(
      'hk00700:2026-05-15:5.3:HKD'
    );
  });

  it('reads withholding rates from env and ignores invalid values', () => {
    expect(
      resolveDividendTaxRates({
        UHT_DIVIDEND_TAX_HK: '0',
        UHT_DIVIDEND_TAX_US: '1.5',
      })
    ).toEqual({ CN: 0, HK: 0, US: 0.1 });
  });
});
