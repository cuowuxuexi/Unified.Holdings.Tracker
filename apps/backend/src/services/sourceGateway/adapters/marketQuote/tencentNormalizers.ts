import { KlinePoint, Quote } from '@uht/domain';
import { FqType, KlinePeriod, MarketQuoteFreshness } from './types';

export function parseTencentQuoteLine(
  line: string,
  now: () => number = Date.now
): Quote | null {
  if (!line.trim()) return null;

  const [rawVariable, rawValue] = line.split('=');
  if (!rawVariable || !rawValue) return null;

  const code = rawVariable.replace(/^v_/, '').trim();
  const dataParts = rawValue.replace(/"/g, '').trim().split('~');
  const market = code.substring(0, 2);

  if (dataParts.length < 5) return null;

  const quote: Partial<Quote> = {
    code,
    name: dataParts[1],
    currentPrice: numberAt(dataParts, 3),
    prevClosePrice: numberAt(dataParts, 4),
    openPrice: numberAt(dataParts, 5),
    volume: numberAt(dataParts, 6),
    timestamp: now(),
  };

  if (market === 'sh' || market === 'sz') {
    if (dataParts.length < 48) return null;
    quote.highPrice = numberAt(dataParts, 33);
    quote.lowPrice = numberAt(dataParts, 34);
    quote.changeAmount = numberAt(dataParts, 31);
    quote.changePercent = numberAt(dataParts, 32);
    quote.turnover = numberAt(dataParts, 37);
    quote.peRatio = optionalNumberAt(dataParts, 39);
    quote.marketCap = optionalNumberAt(dataParts, 45);
    quote.timestamp = parseCompactTimestamp(dataParts[30]) ?? quote.timestamp;
  } else if (market === 'hk') {
    if (dataParts.length < 46) return null;
    quote.highPrice = numberAt(dataParts, 33);
    quote.lowPrice = numberAt(dataParts, 34);
    quote.changeAmount = numberAt(dataParts, 31);
    quote.changePercent = numberAt(dataParts, 32);
    quote.turnover = numberAt(dataParts, 11);
    quote.peRatio = optionalNumberAt(dataParts, 39);
    quote.marketCap = optionalNumberAt(dataParts, 44);
    quote.timestamp = parseLooseTimestamp(dataParts[30]) ?? quote.timestamp;
  } else if (market === 'us') {
    if (dataParts.length < 46) return null;
    quote.highPrice = numberAt(dataParts, 33);
    quote.lowPrice = numberAt(dataParts, 34);
    quote.changeAmount = numberAt(dataParts, 31);
    quote.changePercent = numberAt(dataParts, 32);
    quote.turnover = numberAt(dataParts, 37);
    quote.peRatio = optionalNumberAt(dataParts, 39);
    quote.marketCap = optionalNumberAt(dataParts, 45);
    quote.timestamp = parseLooseTimestamp(dataParts[30]) ?? quote.timestamp;
  } else {
    return null;
  }

  return isCompleteQuote(quote) ? (quote as Quote) : null;
}

export function parseTencentQuoteBody(
  body: string,
  now: () => number = Date.now
): Quote[] {
  return body
    .split('\n')
    .map((line) => parseTencentQuoteLine(line, now))
    .filter((quote): quote is Quote => quote !== null);
}

export function normalizeTencentKlineResponse(
  responseData: unknown,
  code: string,
  period: KlinePeriod = 'daily',
  fq: FqType = 'qfq'
): KlinePoint[] {
  if (!isRecord(responseData) || responseData.code !== 0) return [];
  if (!isRecord(responseData.data)) return [];

  const processedCode = processedTencentKlineCode(code);
  const dataContainer = responseData.data[processedCode];
  if (!isRecord(dataContainer)) return [];

  const fieldKeys = tencentKlineFieldKeys(code, period, fq);
  const rawRows = fieldKeys
    .map((fieldKey) => dataContainer[fieldKey])
    .find(Array.isArray);

  if (!Array.isArray(rawRows)) return [];

  return rawRows
    .map(normalizeKlineRow)
    .filter((point): point is KlinePoint => point !== null);
}

export function quoteFreshness(quotes: Quote[]): MarketQuoteFreshness {
  const latestTimestamp = quotes.reduce<number | null>((latest, quote) => {
    if (!Number.isFinite(quote.timestamp)) return latest;
    return latest === null
      ? quote.timestamp
      : Math.max(latest, quote.timestamp);
  }, null);

  return {
    latestTimestamp,
    latestIso:
      latestTimestamp === null ? null : new Date(latestTimestamp).toISOString(),
  };
}

export function klineFreshness(points: KlinePoint[]): MarketQuoteFreshness {
  const latestDate = points.reduce<string | null>((latest, point) => {
    if (!point.date) return latest;
    return latest === null || point.date > latest ? point.date : latest;
  }, null);
  const latestTimestamp =
    latestDate === null ? null : Date.parse(`${latestDate}T00:00:00.000Z`);

  return {
    latestTimestamp,
    latestIso:
      latestTimestamp === null ? null : new Date(latestTimestamp).toISOString(),
  };
}

function tencentKlineFieldKeys(
  code: string,
  period: KlinePeriod,
  fq: FqType
): string[] {
  const apiPeriod = toTencentPeriod(period);
  const market = code.substring(0, 2);
  const keys: string[] = [];

  if (fq === 'qfq') {
    if (apiPeriod === 'year' && (market === 'sh' || market === 'sz')) {
      keys.push('year');
    } else {
      keys.push(`qfq${apiPeriod}`);
    }
  } else if (fq === 'hfq') {
    keys.push(`hfq_${apiPeriod}`);
  }

  keys.push(apiPeriod);
  return keys;
}

function toTencentPeriod(period: KlinePeriod): string {
  switch (period) {
    case 'weekly':
      return 'week';
    case 'monthly':
      return 'month';
    case 'yearly':
      return 'year';
    case 'daily':
      return 'day';
  }
}

function processedTencentKlineCode(code: string): string {
  const knownUSIndices = new Set(['usDJI', 'usIXIC', 'usSPX', 'usINX']);
  if (
    code.startsWith('us') &&
    !knownUSIndices.has(code) &&
    !code.includes('.')
  ) {
    return `${code}.OQ`;
  }
  return code;
}

function normalizeKlineRow(row: unknown): KlinePoint | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const point: KlinePoint = {
    date: String(row[0]),
    open: Number.parseFloat(String(row[1])),
    close: Number.parseFloat(String(row[2])),
    high: Number.parseFloat(String(row[3])),
    low: Number.parseFloat(String(row[4])),
    volume: Number.parseInt(String(row[5]), 10),
  };

  if (
    !point.date ||
    Number.isNaN(point.open) ||
    Number.isNaN(point.close) ||
    Number.isNaN(point.high) ||
    Number.isNaN(point.low) ||
    Number.isNaN(point.volume)
  ) {
    return null;
  }

  return point;
}

function isCompleteQuote(quote: Partial<Quote>): boolean {
  return Boolean(
    quote.code &&
      quote.name &&
      Number.isFinite(quote.currentPrice) &&
      Number.isFinite(quote.changePercent) &&
      Number.isFinite(quote.changeAmount)
  );
}

function numberAt(parts: string[], index: number): number {
  return Number.parseFloat(parts[index]);
}

function optionalNumberAt(parts: string[], index: number): number | undefined {
  const value = numberAt(parts, index);
  return Number.isFinite(value) && value !== 0 ? value : undefined;
}

function parseCompactTimestamp(value: string | undefined): number | null {
  if (!value || !/^\d{14}$/.test(value)) return null;
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10) - 1;
  const day = Number.parseInt(value.slice(6, 8), 10);
  const hour = Number.parseInt(value.slice(8, 10), 10);
  const minute = Number.parseInt(value.slice(10, 12), 10);
  const second = Number.parseInt(value.slice(12, 14), 10);
  const timestamp = new Date(year, month, day, hour, minute, second).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseLooseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
