import { KlinePoint, Quote } from '@uht/domain';

export const aShareQuote: Quote = {
  code: 'sh600519',
  name: '贵州茅台',
  currentPrice: 1634,
  prevClosePrice: 1620,
  openPrice: 1628,
  highPrice: 1640,
  lowPrice: 1610,
  volume: 12345,
  turnover: 20000,
  changeAmount: 14,
  changePercent: 0.86,
  timestamp: Date.parse('2026-04-24T07:00:00.000Z'),
  peRatio: 25.3,
  marketCap: 20500,
};

export const hkQuote: Quote = {
  code: 'hk00700',
  name: '腾讯控股',
  currentPrice: 372.4,
  prevClosePrice: 370,
  openPrice: 371,
  highPrice: 375,
  lowPrice: 368,
  volume: 54321,
  turnover: 1234567,
  changeAmount: 2.4,
  changePercent: 0.65,
  timestamp: Date.parse('2026-04-24T08:00:00.000Z'),
  peRatio: 18.2,
  marketCap: 35000,
};

export const usQuote: Quote = {
  code: 'usAAPL',
  name: '苹果',
  currentPrice: 202.52,
  prevClosePrice: 198.15,
  openPrice: 211.44,
  highPrice: 212.94,
  lowPrice: 201.16,
  volume: 101352911,
  turnover: 20819141533,
  changeAmount: 4.37,
  changePercent: 2.21,
  timestamp: Date.parse('2026-04-24T20:00:02.000Z'),
  peRatio: 32.15,
  marketCap: 30405.5654,
};

export const dailyKline: KlinePoint[] = [
  {
    date: '2026-04-23',
    open: 1600,
    close: 1620,
    high: 1630,
    low: 1590,
    volume: 10000,
  },
  {
    date: '2026-04-24',
    open: 1620,
    close: 1634,
    high: 1640,
    low: 1610,
    volume: 12000,
  },
];

export function tencentQuoteLine(
  code: string,
  values: Record<number, string>,
  length = 48
): string {
  const parts = Array.from({ length }, () => '0');
  for (const [index, value] of Object.entries(values)) {
    parts[Number(index)] = value;
  }
  return `v_${code}="${parts.join('~')}";`;
}
