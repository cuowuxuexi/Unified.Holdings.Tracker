type NumericLike =
  | number
  | string
  | bigint
  | null
  | undefined
  | { toNumber(): number };

export const DEFAULT_FX_HISTORY_PAIRS = ['USD-CNY', 'HKD-CNY'] as const;

export const FX_HISTORY_PAIRS = [
  ...DEFAULT_FX_HISTORY_PAIRS,
  'USD-HKD',
] as const;

export type FxHistoryPair = (typeof FX_HISTORY_PAIRS)[number];

export type FxHistoryWarning = {
  code: 'fx_history_incomplete' | 'fx_pair_unsupported';
  message: string;
  details?: Record<string, unknown>;
};

export type ExchangeRateSnapshotLike = {
  date: string;
  pair: string;
  rate?: NumericLike;
  source?: string | null;
};

export type FxHistoryWindowRequest = {
  year: number | string;
  endDate: string;
  pairs?: readonly string[];
};

export type FxHistoryPoint = {
  date: string;
  pair: FxHistoryPair;
  rate: number;
  source: string | null;
};

export type FxHistoryPairWindow = {
  pair: FxHistoryPair;
  points: FxHistoryPoint[];
  current_date: string | null;
  current_rate: number | null;
  change_7d_percent: number | null;
  change_30d_percent: number | null;
  change_ytd_percent: number | null;
};

export type FxHistoryWindow = {
  window: {
    year: number;
    start: string;
    end: string;
  };
  pairs: FxHistoryPairWindow[];
  warnings: FxHistoryWarning[];
};

type IndexedFxHistoryPoint = FxHistoryPoint & {
  fromCanonicalPair: boolean;
};

type ChangeWindow = '7d' | '30d' | 'ytd' | 'current';

const PAIR_ALIASES: Record<string, FxHistoryPair> = {
  'USD-CNY': 'USD-CNY',
  USDCNY: 'USD-CNY',
  'HKD-CNY': 'HKD-CNY',
  HKDCNY: 'HKD-CNY',
  'USD-HKD': 'USD-HKD',
  USDHKD: 'USD-HKD',
};

const CHANGE_WINDOWS = [
  { key: 'change_7d_percent', label: '7d', daysBack: 7 },
  { key: 'change_30d_percent', label: '30d', daysBack: 30 },
] as const;

export function buildFxHistoryWindow(
  rows: readonly ExchangeRateSnapshotLike[],
  request: FxHistoryWindowRequest
): FxHistoryWindow {
  const year = normalizeYear(request.year);
  const start = `${year}-01-01`;
  const end = minDate(
    validateDateOnly(request.endDate, 'endDate'),
    `${year}-12-31`
  );
  const warnings: FxHistoryWarning[] = [];
  const requestedPairs = normalizeRequestedPairs(request.pairs, warnings);
  const pointsByPair = groupPointsByPair(rows, start, end);

  return {
    window: { year, start, end },
    pairs: requestedPairs.map((pair) =>
      buildPairWindow({
        pair,
        points: pointsByPair.get(pair) ?? [],
        start,
        end,
        warnings,
      })
    ),
    warnings,
  };
}

export function normalizeFxHistoryPair(pair: string): FxHistoryPair | null {
  const compact = pair
    .trim()
    .toUpperCase()
    .replace(/[\s_/]/g, '-');
  return (
    PAIR_ALIASES[compact] ?? PAIR_ALIASES[compact.replace(/-/g, '')] ?? null
  );
}

function normalizeRequestedPairs(
  pairs: readonly string[] | undefined,
  warnings: FxHistoryWarning[]
): FxHistoryPair[] {
  const requested = pairs ?? DEFAULT_FX_HISTORY_PAIRS;
  const normalized: FxHistoryPair[] = [];

  for (const pair of requested) {
    const normalizedPair = normalizeFxHistoryPair(pair);
    if (!normalizedPair) {
      warnings.push({
        code: 'fx_pair_unsupported',
        message: 'Requested FX pair is not supported by the history helper.',
        details: { pair },
      });
      continue;
    }
    if (!normalized.includes(normalizedPair)) {
      normalized.push(normalizedPair);
    }
  }

  return normalized;
}

function groupPointsByPair(
  rows: readonly ExchangeRateSnapshotLike[],
  start: string,
  end: string
): Map<FxHistoryPair, FxHistoryPoint[]> {
  const indexed = new Map<string, IndexedFxHistoryPoint>();

  for (const row of rows) {
    const pair = normalizeFxHistoryPair(row.pair);
    const rate = toPositiveNumber(row.rate);
    if (!pair || rate === null || !isDateOnly(row.date)) continue;
    if (row.date < start || row.date > end) continue;

    const key = `${pair}:${row.date}`;
    const fromCanonicalPair = row.pair.trim().toUpperCase() === pair;
    const existing = indexed.get(key);
    if (
      !existing ||
      shouldReplaceDuplicate(existing.fromCanonicalPair, fromCanonicalPair)
    ) {
      indexed.set(key, {
        date: row.date,
        pair,
        rate,
        source: row.source ?? null,
        fromCanonicalPair,
      });
    }
  }

  const result = new Map<FxHistoryPair, FxHistoryPoint[]>();
  for (const indexedPoint of indexed.values()) {
    const point: FxHistoryPoint = {
      date: indexedPoint.date,
      pair: indexedPoint.pair,
      rate: indexedPoint.rate,
      source: indexedPoint.source,
    };
    const pairPoints = result.get(point.pair) ?? [];
    pairPoints.push(point);
    result.set(point.pair, pairPoints);
  }

  for (const [pair, pairPoints] of result.entries()) {
    result.set(pair, pairPoints.sort(comparePoints));
  }

  return result;
}

function buildPairWindow(input: {
  pair: FxHistoryPair;
  points: FxHistoryPoint[];
  start: string;
  end: string;
  warnings: FxHistoryWarning[];
}): FxHistoryPairWindow {
  const current = findLatestOnOrBefore(input.points, input.end, input.start);
  if (!current) {
    pushIncompleteWarning(input.warnings, input.pair, 'current', input.end);
  }

  const changes = CHANGE_WINDOWS.reduce(
    (memo, window) => {
      const baselineDate = subtractDays(input.end, window.daysBack);
      const baseline = findPointOnDate(input.points, baselineDate);
      const change = calculatePercentChange(current?.rate ?? null, baseline);
      if (change === null) {
        pushIncompleteWarning(
          input.warnings,
          input.pair,
          window.label,
          baselineDate
        );
      }
      return { ...memo, [window.key]: change };
    },
    {
      change_7d_percent: null,
      change_30d_percent: null,
    } as Pick<FxHistoryPairWindow, 'change_7d_percent' | 'change_30d_percent'>
  );

  const ytdBaseline = findPointOnDate(input.points, input.start);
  const ytdChange = calculatePercentChange(current?.rate ?? null, ytdBaseline);
  if (ytdChange === null) {
    pushIncompleteWarning(input.warnings, input.pair, 'ytd', input.start);
  }

  return {
    pair: input.pair,
    points: input.points,
    current_date: current?.date ?? null,
    current_rate: current?.rate ?? null,
    ...changes,
    change_ytd_percent: ytdChange,
  };
}

function calculatePercentChange(
  currentRate: number | null,
  baseline: FxHistoryPoint | null
): number | null {
  if (currentRate === null || !baseline || baseline.rate <= 0) return null;
  return roundNumber(((currentRate - baseline.rate) / baseline.rate) * 100);
}

function pushIncompleteWarning(
  warnings: FxHistoryWarning[],
  pair: FxHistoryPair,
  window: ChangeWindow,
  baselineDate: string
): void {
  warnings.push({
    code: 'fx_history_incomplete',
    message:
      'FX history point or baseline is missing; affected change fields are returned as null.',
    details: { pair, window, baseline_date: baselineDate },
  });
}

function findLatestOnOrBefore(
  points: readonly FxHistoryPoint[],
  date: string,
  minDate: string
): FxHistoryPoint | null {
  return (
    points
      .filter((point) => point.date >= minDate && point.date <= date)
      .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null
  );
}

function findPointOnDate(
  points: readonly FxHistoryPoint[],
  date: string
): FxHistoryPoint | null {
  return points.find((point) => point.date === date) ?? null;
}

function shouldReplaceDuplicate(
  existingCanonical: boolean,
  nextCanonical: boolean
): boolean {
  return nextCanonical || !existingCanonical;
}

function comparePoints(left: FxHistoryPoint, right: FxHistoryPoint): number {
  return (
    left.date.localeCompare(right.date) || left.pair.localeCompare(right.pair)
  );
}

function normalizeYear(year: number | string): number {
  const parsed = typeof year === 'number' ? year : Number(year);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
    throw new Error(`Invalid FX history year: ${year}`);
  }
  return parsed;
}

function validateDateOnly(date: string, label: string): string {
  if (!isDateOnly(date)) {
    throw new Error(`Invalid FX history ${label}: ${date}`);
  }
  return date;
}

function isDateOnly(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === date;
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function subtractDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function toPositiveNumber(value: NumericLike): number | null {
  const next =
    typeof value === 'object' && value !== null
      ? value.toNumber()
      : Number(value);
  if (!Number.isFinite(next) || next <= 0) return null;
  return next;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}
