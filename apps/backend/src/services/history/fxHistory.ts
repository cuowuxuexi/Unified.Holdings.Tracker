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
  baselineStartDate?: string;
  pairs?: readonly string[];
};

export type FxHistoryPoint = {
  date: string;
  pair: FxHistoryPair;
  rate: number;
  source: string | null;
};

export type FxHistoryBaseline = {
  target_date: string;
  actual_date: string | null;
  rate: number | null;
  source: string | null;
  fallback: boolean;
};

export type FxHistoryPairWindow = {
  pair: FxHistoryPair;
  points: FxHistoryPoint[];
  current_date: string | null;
  current_rate: number | null;
  change_7d_percent: number | null;
  change_30d_percent: number | null;
  change_ytd_percent: number | null;
  change_5y_percent: number | null;
  change_10y_percent: number | null;
  baselines: {
    change_7d_percent: FxHistoryBaseline;
    change_30d_percent: FxHistoryBaseline;
    change_ytd_percent: FxHistoryBaseline;
    change_5y_percent: FxHistoryBaseline;
    change_10y_percent: FxHistoryBaseline;
  };
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

type ChangeWindow = '7d' | '30d' | 'ytd' | '5y' | '10y' | 'current';

type ResolvedFxBaseline = {
  targetDate: string;
  point: FxHistoryPoint | null;
};

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

const LONG_CHANGE_WINDOWS = [
  { key: 'change_5y_percent', label: '5y', yearsBack: 5 },
  { key: 'change_10y_percent', label: '10y', yearsBack: 10 },
] as const;

const BASELINE_FALLBACK_MAX_DAYS = 7;

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
  const baselineStart = request.baselineStartDate
    ? minDate(
        validateDateOnly(request.baselineStartDate, 'baselineStartDate'),
        start
      )
    : start;
  const warnings: FxHistoryWarning[] = [];
  const requestedPairs = normalizeRequestedPairs(request.pairs, warnings);
  const pointsByPair = groupPointsByPair(rows, start, end);
  const baselinePointsByPair = groupPointsByPair(rows, baselineStart, end);
  const enableLongWindows = baselineStart < start;

  return {
    window: { year, start, end },
    pairs: requestedPairs.map((pair) =>
      buildPairWindow({
        pair,
        points: pointsByPair.get(pair) ?? [],
        baselinePoints: baselinePointsByPair.get(pair) ?? [],
        start,
        end,
        enableLongWindows,
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
  baselinePoints: FxHistoryPoint[];
  start: string;
  end: string;
  enableLongWindows: boolean;
  warnings: FxHistoryWarning[];
}): FxHistoryPairWindow {
  const current = findLatestOnOrBefore(input.points, input.end, input.start);
  if (!current) {
    pushIncompleteWarning(input.warnings, input.pair, 'current', input.end);
  }

  const rollingBaselines = CHANGE_WINDOWS.map((window) => ({
    ...window,
    baseline: resolveBaselinePoint({
      points: input.baselinePoints,
      targetDate: subtractDays(input.end, window.daysBack),
      currentDate: current?.date ?? null,
      preferOnOrAfter: false,
    }),
  }));

  const sevenDayBaseline = rollingBaselines[0].baseline;
  const thirtyDayBaseline = rollingBaselines[1].baseline;
  const sevenDayChange = calculatePercentChange(
    current?.rate ?? null,
    sevenDayBaseline.point
  );
  const thirtyDayChange = calculatePercentChange(
    current?.rate ?? null,
    thirtyDayBaseline.point
  );

  if (sevenDayChange === null) {
    pushIncompleteWarning(
      input.warnings,
      input.pair,
      '7d',
      sevenDayBaseline.targetDate
    );
  }
  if (thirtyDayChange === null) {
    pushIncompleteWarning(
      input.warnings,
      input.pair,
      '30d',
      thirtyDayBaseline.targetDate
    );
  }

  const ytdBaseline = resolveBaselinePoint({
    points: input.baselinePoints,
    targetDate: input.start,
    currentDate: null,
    preferOnOrAfter: true,
  });
  const ytdChange = calculatePercentChange(
    current?.rate ?? null,
    ytdBaseline.point
  );
  if (ytdChange === null) {
    pushIncompleteWarning(input.warnings, input.pair, 'ytd', input.start);
  }

  const longBaselines = LONG_CHANGE_WINDOWS.map((window) => ({
    ...window,
    baseline: resolveBaselinePoint({
      points: input.baselinePoints,
      targetDate: subtractYears(input.end, window.yearsBack),
      currentDate: current?.date ?? null,
      preferOnOrAfter: false,
    }),
  }));
  const fiveYearBaseline = longBaselines[0].baseline;
  const tenYearBaseline = longBaselines[1].baseline;
  const fiveYearChange = input.enableLongWindows
    ? calculatePercentChange(current?.rate ?? null, fiveYearBaseline.point)
    : null;
  const tenYearChange = input.enableLongWindows
    ? calculatePercentChange(current?.rate ?? null, tenYearBaseline.point)
    : null;

  if (input.enableLongWindows && fiveYearChange === null) {
    pushIncompleteWarning(
      input.warnings,
      input.pair,
      '5y',
      fiveYearBaseline.targetDate
    );
  }
  if (input.enableLongWindows && tenYearChange === null) {
    pushIncompleteWarning(
      input.warnings,
      input.pair,
      '10y',
      tenYearBaseline.targetDate
    );
  }

  return {
    pair: input.pair,
    points: input.points,
    current_date: current?.date ?? null,
    current_rate: current?.rate ?? null,
    change_7d_percent: sevenDayChange,
    change_30d_percent: thirtyDayChange,
    change_ytd_percent: ytdChange,
    change_5y_percent: fiveYearChange,
    change_10y_percent: tenYearChange,
    baselines: {
      change_7d_percent: serializeBaseline(sevenDayBaseline),
      change_30d_percent: serializeBaseline(thirtyDayBaseline),
      change_ytd_percent: serializeBaseline(ytdBaseline),
      change_5y_percent: serializeBaseline(fiveYearBaseline),
      change_10y_percent: serializeBaseline(tenYearBaseline),
    },
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

function resolveBaselinePoint(input: {
  points: readonly FxHistoryPoint[];
  targetDate: string;
  currentDate: string | null;
  preferOnOrAfter: boolean;
}): ResolvedFxBaseline {
  const exact = findPointOnDate(input.points, input.targetDate);
  if (exact) return { targetDate: input.targetDate, point: exact };

  const nearest =
    input.points
      .filter((point) => point.date !== input.currentDate)
      .map((point) => ({
        point,
        distance: daysBetween(point.date, input.targetDate),
      }))
      .filter((candidate) => candidate.distance <= BASELINE_FALLBACK_MAX_DAYS)
      .sort((left, right) => {
        const byDistance = left.distance - right.distance;
        if (byDistance !== 0) return byDistance;

        const leftAfter = left.point.date >= input.targetDate;
        const rightAfter = right.point.date >= input.targetDate;
        if (leftAfter !== rightAfter) {
          if (input.preferOnOrAfter) return leftAfter ? -1 : 1;
          return leftAfter ? 1 : -1;
        }

        return input.preferOnOrAfter
          ? left.point.date.localeCompare(right.point.date)
          : right.point.date.localeCompare(left.point.date);
      })[0]?.point ?? null;

  return { targetDate: input.targetDate, point: nearest };
}

function serializeBaseline(baseline: ResolvedFxBaseline): FxHistoryBaseline {
  return {
    target_date: baseline.targetDate,
    actual_date: baseline.point?.date ?? null,
    rate: baseline.point?.rate ?? null,
    source: baseline.point?.source ?? null,
    fallback:
      baseline.point !== null && baseline.point.date !== baseline.targetDate,
  };
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

function subtractYears(date: string, years: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const targetYear = year - years;
  const targetDay = Math.min(day, daysInMonth(targetYear, month));
  return [
    String(targetYear).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(targetDay).padStart(2, '0'),
  ].join('-');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysBetween(left: string, right: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(
    Math.round(
      (Date.parse(`${left}T00:00:00.000Z`) -
        Date.parse(`${right}T00:00:00.000Z`)) /
        msPerDay
    )
  );
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
