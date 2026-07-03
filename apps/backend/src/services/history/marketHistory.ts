export const CORE_BENCHMARK_INDEX_CODES = [
  'sh000001',
  'sz399001',
  'hkHSI',
  'usDJI',
  'usIXIC',
  'usINX',
] as const;

type NumericLike =
  | number
  | string
  | bigint
  | null
  | undefined
  | { toNumber(): number };

export type QuoteSnapshotLikeRow = {
  assetCode: string;
  date: string | null;
  timestamp?: Date | string | null;
  currentPrice: NumericLike;
  changePercent?: NumericLike;
  changeAmount?: NumericLike;
  prevClosePrice?: NumericLike;
  weeklyChangePercent?: NumericLike;
  monthlyChangePercent?: NumericLike;
  yearlyChangePercent?: NumericLike;
};

export type IndexSnapshotLikeRow = {
  indexCode: string;
  date: string;
  name?: string | null;
  currentPrice: NumericLike;
  changePercent?: NumericLike;
  changeAmount?: NumericLike;
  weeklyChangePercent?: NumericLike;
  monthlyChangePercent?: NumericLike;
  yearlyChangePercent?: NumericLike;
};

export type MarketHistoryRequest = {
  assetCodes: readonly string[];
  startDate: string;
  endDate: string;
  quoteRows: readonly QuoteSnapshotLikeRow[];
  indexRows: readonly IndexSnapshotLikeRow[];
};

export type MarketHistoryCoverage = {
  requested: string[];
  found: string[];
  missing: string[];
};

export type MarketHistoryWarning = {
  code: 'quote_history_incomplete' | 'benchmark_history_missing';
  message: string;
  details: Record<string, unknown>;
};

export type QuoteHistoryPoint = {
  date: string;
  timestamp: string | null;
  current_price: number;
  change_amount: number | null;
  change_percent: number | null;
  prev_close_price: number | null;
  weekly_change_percent: number | null;
  monthly_change_percent: number | null;
  yearly_change_percent: number | null;
  change_from_baseline_percent: number;
};

export type QuoteHistorySeries = {
  asset_code: string;
  baseline_date: string | null;
  baseline_price: number | null;
  points: QuoteHistoryPoint[] | null;
};

export type BenchmarkIndexPoint = {
  date: string;
  current_price: number;
  change_amount: number | null;
  change_percent: number | null;
  weekly_change_percent: number | null;
  monthly_change_percent: number | null;
  yearly_change_percent: number | null;
  change_from_baseline_percent: number;
};

export type BenchmarkIndexSeries = {
  index_code: (typeof CORE_BENCHMARK_INDEX_CODES)[number];
  name: string | null;
  baseline_date: string | null;
  baseline_price: number | null;
  points: BenchmarkIndexPoint[];
};

export type MarketHistoryResult = {
  requested_assets: string[];
  quote_coverage: MarketHistoryCoverage;
  quote_points: QuoteHistorySeries[];
  requested_benchmark_indices: string[];
  benchmark_index_coverage: MarketHistoryCoverage;
  benchmark_index_points: BenchmarkIndexSeries[];
  warnings: MarketHistoryWarning[];
};

export function buildMarketHistory(
  request: MarketHistoryRequest
): MarketHistoryResult {
  const requestedAssets = uniqueNonEmpty(request.assetCodes);
  const quoteRowsByAsset = groupQuoteRows(request.quoteRows, request);
  const indexRowsByCode = groupIndexRows(request.indexRows, request);

  const quoteCoverage = coverageFor(requestedAssets, quoteRowsByAsset);
  const benchmarkCodes = [...CORE_BENCHMARK_INDEX_CODES];
  const benchmarkCoverage = coverageFor(benchmarkCodes, indexRowsByCode);
  const quoteBaselineMissing: string[] = [];
  const benchmarkBaselineMissing: string[] = [];

  const quotePoints = requestedAssets.map((assetCode) => {
    const rows = quoteRowsByAsset.get(assetCode) ?? [];
    // 基准优先精确匹配 startDate；startDate 为非交易日（如 1 月 1 日）时
    // 回退到窗口内第一个可用交易日
    const baseline =
      rows.find((row) => row.date === request.startDate) ?? rows[0];

    if (!baseline) {
      quoteBaselineMissing.push(assetCode);
      return {
        asset_code: assetCode,
        baseline_date: null,
        baseline_price: null,
        points: null,
      } satisfies QuoteHistorySeries;
    }

    return {
      asset_code: assetCode,
      baseline_date: baseline.date,
      baseline_price: baseline.currentPrice,
      points: rows.map((row) => toQuotePoint(row, baseline.currentPrice)),
    } satisfies QuoteHistorySeries;
  });

  const benchmarkIndexPoints = benchmarkCodes.map((indexCode) => {
    const rows = indexRowsByCode.get(indexCode) ?? [];
    // 同上：非交易日基准回退到窗口内第一个可用交易日
    const baseline =
      rows.find((row) => row.date === request.startDate) ?? rows[0];
    const name = rows.find((row) => row.name !== null)?.name ?? null;

    if (!baseline) {
      benchmarkBaselineMissing.push(indexCode);
      return {
        index_code: indexCode,
        name,
        baseline_date: null,
        baseline_price: null,
        points: [],
      } satisfies BenchmarkIndexSeries;
    }

    return {
      index_code: indexCode,
      name,
      baseline_date: baseline.date,
      baseline_price: baseline.currentPrice,
      points: rows.map((row) => toBenchmarkPoint(row, baseline.currentPrice)),
    } satisfies BenchmarkIndexSeries;
  });

  const warnings = buildWarnings({
    startDate: request.startDate,
    endDate: request.endDate,
    quoteCoverage,
    quoteBaselineMissing,
    benchmarkCoverage,
    benchmarkBaselineMissing,
  });

  return {
    requested_assets: requestedAssets,
    quote_coverage: quoteCoverage,
    quote_points: quotePoints,
    requested_benchmark_indices: benchmarkCodes,
    benchmark_index_coverage: benchmarkCoverage,
    benchmark_index_points: benchmarkIndexPoints,
    warnings,
  };
}

type NormalizedQuoteRow = {
  assetCode: string;
  date: string;
  timestamp: string | null;
  currentPrice: number;
  changePercent: number | null;
  changeAmount: number | null;
  prevClosePrice: number | null;
  weeklyChangePercent: number | null;
  monthlyChangePercent: number | null;
  yearlyChangePercent: number | null;
};

type NormalizedIndexRow = {
  indexCode: (typeof CORE_BENCHMARK_INDEX_CODES)[number];
  date: string;
  name: string | null;
  currentPrice: number;
  changePercent: number | null;
  changeAmount: number | null;
  weeklyChangePercent: number | null;
  monthlyChangePercent: number | null;
  yearlyChangePercent: number | null;
};

function groupQuoteRows(
  rows: readonly QuoteSnapshotLikeRow[],
  request: Pick<MarketHistoryRequest, 'startDate' | 'endDate'>
): Map<string, NormalizedQuoteRow[]> {
  const result = new Map<string, NormalizedQuoteRow[]>();

  for (const row of rows) {
    const normalized = normalizeQuoteRow(row, request);
    if (!normalized) continue;

    const existing = result.get(normalized.assetCode) ?? [];
    existing.push(normalized);
    result.set(normalized.assetCode, existing);
  }

  for (const groupedRows of result.values()) {
    groupedRows.sort(compareByDate);
  }

  return result;
}

function groupIndexRows(
  rows: readonly IndexSnapshotLikeRow[],
  request: Pick<MarketHistoryRequest, 'startDate' | 'endDate'>
): Map<string, NormalizedIndexRow[]> {
  const coreCodes = new Set<string>(CORE_BENCHMARK_INDEX_CODES);
  const result = new Map<string, NormalizedIndexRow[]>();

  for (const row of rows) {
    const normalized = normalizeIndexRow(row, request, coreCodes);
    if (!normalized) continue;

    const existing = result.get(normalized.indexCode) ?? [];
    existing.push(normalized);
    result.set(normalized.indexCode, existing);
  }

  for (const groupedRows of result.values()) {
    groupedRows.sort(compareByDate);
  }

  return result;
}

function normalizeQuoteRow(
  row: QuoteSnapshotLikeRow,
  request: Pick<MarketHistoryRequest, 'startDate' | 'endDate'>
): NormalizedQuoteRow | null {
  const assetCode = row.assetCode.trim();
  const currentPrice = toPositiveNumber(row.currentPrice);

  if (
    !assetCode ||
    row.date === null ||
    !isInsideWindow(row.date, request) ||
    currentPrice === null
  ) {
    return null;
  }

  return {
    assetCode,
    date: row.date,
    timestamp: normalizeTimestamp(row.timestamp),
    currentPrice,
    changePercent: toNullableNumber(row.changePercent),
    changeAmount: toNullableNumber(row.changeAmount),
    prevClosePrice: toNullableNumber(row.prevClosePrice),
    weeklyChangePercent: toNullableNumber(row.weeklyChangePercent),
    monthlyChangePercent: toNullableNumber(row.monthlyChangePercent),
    yearlyChangePercent: toNullableNumber(row.yearlyChangePercent),
  };
}

function normalizeIndexRow(
  row: IndexSnapshotLikeRow,
  request: Pick<MarketHistoryRequest, 'startDate' | 'endDate'>,
  coreCodes: Set<string>
): NormalizedIndexRow | null {
  const indexCode = row.indexCode.trim();
  const currentPrice = toPositiveNumber(row.currentPrice);

  if (
    !coreCodes.has(indexCode) ||
    !isInsideWindow(row.date, request) ||
    currentPrice === null
  ) {
    return null;
  }

  return {
    indexCode: indexCode as (typeof CORE_BENCHMARK_INDEX_CODES)[number],
    date: row.date,
    name: row.name?.trim() || null,
    currentPrice,
    changePercent: toNullableNumber(row.changePercent),
    changeAmount: toNullableNumber(row.changeAmount),
    weeklyChangePercent: toNullableNumber(row.weeklyChangePercent),
    monthlyChangePercent: toNullableNumber(row.monthlyChangePercent),
    yearlyChangePercent: toNullableNumber(row.yearlyChangePercent),
  };
}

function toQuotePoint(
  row: NormalizedQuoteRow,
  baselinePrice: number
): QuoteHistoryPoint {
  return {
    date: row.date,
    timestamp: row.timestamp,
    current_price: row.currentPrice,
    change_amount: row.changeAmount,
    change_percent: row.changePercent,
    prev_close_price: row.prevClosePrice,
    weekly_change_percent: row.weeklyChangePercent,
    monthly_change_percent: row.monthlyChangePercent,
    yearly_change_percent: row.yearlyChangePercent,
    change_from_baseline_percent: percentChange(
      row.currentPrice,
      baselinePrice
    ),
  };
}

function toBenchmarkPoint(
  row: NormalizedIndexRow,
  baselinePrice: number
): BenchmarkIndexPoint {
  return {
    date: row.date,
    current_price: row.currentPrice,
    change_amount: row.changeAmount,
    change_percent: row.changePercent,
    weekly_change_percent: row.weeklyChangePercent,
    monthly_change_percent: row.monthlyChangePercent,
    yearly_change_percent: row.yearlyChangePercent,
    change_from_baseline_percent: percentChange(
      row.currentPrice,
      baselinePrice
    ),
  };
}

function coverageFor(
  requested: readonly string[],
  rowsByCode: Map<string, readonly unknown[]>
): MarketHistoryCoverage {
  const found = requested.filter(
    (code) => (rowsByCode.get(code) ?? []).length > 0
  );
  return {
    requested: [...requested],
    found,
    missing: requested.filter((code) => !found.includes(code)),
  };
}

function buildWarnings(input: {
  startDate: string;
  endDate: string;
  quoteCoverage: MarketHistoryCoverage;
  quoteBaselineMissing: string[];
  benchmarkCoverage: MarketHistoryCoverage;
  benchmarkBaselineMissing: string[];
}): MarketHistoryWarning[] {
  const warnings: MarketHistoryWarning[] = [];

  if (
    input.quoteCoverage.missing.length > 0 ||
    input.quoteBaselineMissing.length > 0
  ) {
    warnings.push({
      code: 'quote_history_incomplete',
      message:
        'QuoteSnapshot history does not cover all requested annual holding assets or lacks the requested baseline date.',
      details: {
        start_date: input.startDate,
        end_date: input.endDate,
        requested_assets: input.quoteCoverage.requested,
        missing_assets: input.quoteCoverage.missing,
        baseline_missing_assets: input.quoteBaselineMissing,
      },
    });
  }

  if (
    input.benchmarkCoverage.missing.length > 0 ||
    input.benchmarkBaselineMissing.length > 0
  ) {
    warnings.push({
      code: 'benchmark_history_missing',
      message:
        'Core benchmark IndexSnapshot history is missing or lacks the requested baseline date.',
      details: {
        start_date: input.startDate,
        end_date: input.endDate,
        requested_indices: input.benchmarkCoverage.requested,
        missing_indices: input.benchmarkCoverage.missing,
        baseline_missing_indices: input.benchmarkBaselineMissing,
      },
    });
  }

  return warnings;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return Array.from(
    values.reduce((set, value) => {
      const trimmed = value.trim();
      if (trimmed) set.add(trimmed);
      return set;
    }, new Set<string>())
  );
}

function isInsideWindow(
  date: string,
  request: Pick<MarketHistoryRequest, 'startDate' | 'endDate'>
): boolean {
  return date >= request.startDate && date <= request.endDate;
}

function compareByDate(
  left: { date: string },
  right: { date: string }
): number {
  return left.date.localeCompare(right.date);
}

function percentChange(current: number, baseline: number): number {
  return roundTo6(((current - baseline) / baseline) * 100);
}

function roundTo6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeTimestamp(
  value: Date | string | null | undefined
): string | null {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function toPositiveNumber(value: NumericLike): number | null {
  const next = toNullableNumber(value);
  return next !== null && next > 0 ? next : null;
}

function toNullableNumber(value: NumericLike): number | null {
  if (value === null || value === undefined) return null;

  const next = typeof value === 'object' ? value.toNumber() : Number(value);
  return Number.isFinite(next) ? next : null;
}
