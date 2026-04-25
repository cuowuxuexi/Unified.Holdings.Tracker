import {
  FX_PAIRS,
  FxChangeWindowPoint,
  FxChangeWindowRequest,
  FxChangeWindowResult,
  FxPair,
  FxRateRecord,
  FxRawPayload,
  FxRawRecord,
} from './types';

const CURRENCY_TO_PAIR: Record<string, FxPair> = {
  USD: 'USD-CNY',
  HKD: 'HKD-CNY',
};

export function normalizeFxRates(
  raw: FxRawPayload,
  options: {
    sourceId: string;
    requestedDate?: string;
    requestedPairs?: FxPair[];
    receivedAt?: Date;
  }
): FxRateRecord[] {
  const requestedPairs = options.requestedPairs ?? [...FX_PAIRS];
  const fallbackDate =
    options.requestedDate ?? raw.date ?? toDateOnly(options.receivedAt);
  const fallbackSourceTime =
    raw.sourceTime ?? options.receivedAt?.toISOString();
  const rows = buildRawRows(raw, fallbackDate);
  const recordsByKey = new Map<string, FxRateRecord>();

  for (const pair of requestedPairs) {
    const matchingRows = rows.filter((row) => toFxPair(row) === pair);

    if (matchingRows.length === 0) {
      recordsByKey.set(
        keyFor(fallbackDate, pair),
        missingRecord({
          date: fallbackDate,
          pair,
          sourceId: options.sourceId,
          sourceTime: fallbackSourceTime,
          errorSummary: `Missing ${pair} rate`,
        })
      );
      continue;
    }

    for (const row of matchingRows) {
      const date = row.date ?? fallbackDate;
      const sourceTime =
        row.sourceTime ?? fallbackSourceTime ?? `${date}T00:00:00.000Z`;
      const rate = parseRate(row.rate);
      const record =
        rate === null
          ? missingRecord({
              date,
              pair,
              sourceId: options.sourceId,
              sourceTime,
              errorSummary: `Missing ${pair} rate`,
            })
          : {
              date,
              pair,
              rate,
              sourceId: options.sourceId,
              sourceTime,
              status: 'success' as const,
            };
      upsertLatest(recordsByKey, record);
    }
  }

  return Array.from(recordsByKey.values()).sort(compareFxRecords);
}

export function buildFxChangeWindowRequest(
  pair: FxPair,
  asOfDate: string
): FxChangeWindowRequest {
  const asOf = parseDateOnly(asOfDate);
  return {
    pair,
    asOfDate,
    comparisonDates: {
      sevenDay: addDays(asOf, -7),
      thirtyDay: addDays(asOf, -30),
      ytd: `${asOfDate.slice(0, 4)}-01-01`,
    },
  };
}

export function calculateFxChangeWindow(
  request: FxChangeWindowRequest,
  points: FxChangeWindowPoint[]
): FxChangeWindowResult {
  const rateByDate = new Map(
    points
      .filter((point) => point.pair === request.pair)
      .map((point) => [point.date, point.rate])
  );
  const currentRate = rateByDate.get(request.asOfDate);

  return {
    pair: request.pair,
    asOfDate: request.asOfDate,
    currentRate,
    sevenDayChangePercent: percentChange(
      currentRate,
      request.comparisonDates.sevenDay
        ? rateByDate.get(request.comparisonDates.sevenDay)
        : undefined
    ),
    thirtyDayChangePercent: percentChange(
      currentRate,
      request.comparisonDates.thirtyDay
        ? rateByDate.get(request.comparisonDates.thirtyDay)
        : undefined
    ),
    ytdChangePercent: percentChange(
      currentRate,
      request.comparisonDates.ytd
        ? rateByDate.get(request.comparisonDates.ytd)
        : undefined
    ),
  };
}

function buildRawRows(raw: FxRawPayload, fallbackDate: string): FxRawRecord[] {
  const rows = raw.records ? [...raw.records] : [];

  for (const [key, rate] of Object.entries(raw.rates ?? {})) {
    const pair = CURRENCY_TO_PAIR[key] ?? key;
    rows.push({
      date: raw.date ?? fallbackDate,
      pair,
      rate,
      sourceTime: raw.sourceTime,
    });
  }

  return rows;
}

function toFxPair(row: FxRawRecord): FxPair | null {
  const pair =
    row.pair ?? (row.currency ? CURRENCY_TO_PAIR[row.currency] : undefined);
  return FX_PAIRS.includes(pair as FxPair) ? (pair as FxPair) : null;
}

function parseRate(value: number | string | null | undefined): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function missingRecord(input: {
  date: string;
  pair: FxPair;
  sourceId: string;
  sourceTime?: string;
  errorSummary: string;
}): FxRateRecord {
  return {
    date: input.date,
    pair: input.pair,
    rate: null,
    sourceId: input.sourceId,
    sourceTime: input.sourceTime ?? `${input.date}T00:00:00.000Z`,
    status: 'missing_value',
    errorSummary: input.errorSummary,
  };
}

function upsertLatest(
  recordsByKey: Map<string, FxRateRecord>,
  record: FxRateRecord
): void {
  const key = keyFor(record.date, record.pair);
  const existing = recordsByKey.get(key);
  if (!existing || record.sourceTime >= existing.sourceTime) {
    recordsByKey.set(key, record);
  }
}

function keyFor(date: string, pair: FxPair): string {
  return `${date}:${pair}`;
}

function compareFxRecords(left: FxRateRecord, right: FxRateRecord): number {
  return (
    left.date.localeCompare(right.date) || left.pair.localeCompare(right.pair)
  );
}

function percentChange(
  current?: number,
  previous?: number
): number | undefined {
  if (current === undefined || previous === undefined || previous === 0)
    return undefined;
  return Number((((current - previous) / previous) * 100).toFixed(6));
}

function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return toDateOnly(copy);
}

function toDateOnly(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
