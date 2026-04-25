export type YieldHistoryCountry = 'CN' | 'US';
export type YieldHistoryTenor = '2Y' | '5Y' | '10Y' | '30Y';
export type YieldHistorySnapshotStatus =
  | 'SUCCESS'
  | 'MISSING'
  | 'STALE'
  | 'SOURCE_FAILED';

export type YieldHistoryWarning = {
  code: 'yield_curve_missing';
  message: string;
  details?: Record<string, unknown>;
};

export type YieldCurveSnapshotLike = {
  date: string;
  country: string;
  tenor: string;
  yieldPercent?: number | null;
  sourceId?: string | null;
  sourceTime?: Date | string | null;
  status?: YieldHistorySnapshotStatus | string | null;
  errorSummary?: string | null;
};

export type BuildYieldHistoryInput = {
  rows: YieldCurveSnapshotLike[];
  year: number;
  requestedEnd: string;
  countries?: readonly YieldHistoryCountry[];
  tenors?: readonly YieldHistoryTenor[];
};

export type YieldHistoryWindow = {
  year: number;
  start: string;
  end: string;
};

export type YieldHistoryRecord = {
  date: string;
  country: YieldHistoryCountry;
  tenor: YieldHistoryTenor;
  yieldPercent: number | null;
  sourceId: string | null;
  sourceTime: string | null;
  status: string;
  errorSummary: string | null;
};

export type YieldHistorySpreads = {
  us_10y_2y_bp: number | null;
  cn_10y_2y_bp: number | null;
  cn_us_10y_bp: number | null;
};

export type YieldHistoryResult = {
  window: YieldHistoryWindow;
  records: YieldHistoryRecord[];
  latest_curve: {
    latest_date: string | null;
    records: YieldHistoryRecord[];
  };
  spreads: YieldHistorySpreads;
  warnings: YieldHistoryWarning[];
};

const DEFAULT_COUNTRIES = ['CN', 'US'] as const;
const DEFAULT_TENORS = ['2Y', '5Y', '10Y', '30Y'] as const;
const MISSING_STATUSES = new Set(['MISSING', 'SOURCE_FAILED']);

export function buildYieldHistory(
  input: BuildYieldHistoryInput
): YieldHistoryResult {
  const countries = input.countries ?? DEFAULT_COUNTRIES;
  const tenors = input.tenors ?? DEFAULT_TENORS;
  const window = buildWindow(input.year, input.requestedEnd);
  const records = input.rows
    .filter((row) => isInWindow(row.date, window))
    .filter((row) => isRequestedCountry(row.country, countries))
    .filter((row) => isRequestedTenor(row.tenor, tenors))
    .map(normalizeRecord)
    .sort(compareRecords);

  const latestRecords = latestRecordsByCurvePoint(records, countries, tenors);
  const warnings = buildMissingWarnings(
    latestRecords,
    window,
    countries,
    tenors
  );

  return {
    window,
    records,
    latest_curve: {
      latest_date: maxDate(latestRecords.map((record) => record.date)),
      records: latestRecords,
    },
    spreads: {
      us_10y_2y_bp: calculateTenYearTwoYearSpread(latestRecords, 'US'),
      cn_10y_2y_bp: calculateTenYearTwoYearSpread(latestRecords, 'CN'),
      cn_us_10y_bp: calculateCrossCountrySpread(latestRecords, 'CN', 'US'),
    },
    warnings,
  };
}

function buildWindow(year: number, requestedEnd: string): YieldHistoryWindow {
  const normalizedYear = Math.trunc(year);
  const start = `${normalizedYear}-01-01`;
  const yearEnd = `${normalizedYear}-12-31`;
  const end = requestedEnd > yearEnd ? yearEnd : requestedEnd;

  return {
    year: normalizedYear,
    start,
    end,
  };
}

function isInWindow(date: string, window: YieldHistoryWindow): boolean {
  return date >= window.start && date <= window.end;
}

function isRequestedCountry(
  country: string,
  countries: readonly YieldHistoryCountry[]
): country is YieldHistoryCountry {
  return countries.includes(country as YieldHistoryCountry);
}

function isRequestedTenor(
  tenor: string,
  tenors: readonly YieldHistoryTenor[]
): tenor is YieldHistoryTenor {
  return tenors.includes(tenor as YieldHistoryTenor);
}

function normalizeRecord(row: YieldCurveSnapshotLike): YieldHistoryRecord {
  const yieldPercent = toNullableNumber(row.yieldPercent);

  return {
    date: row.date,
    country: row.country as YieldHistoryCountry,
    tenor: row.tenor as YieldHistoryTenor,
    yieldPercent,
    sourceId: row.sourceId ?? null,
    sourceTime: serializeSourceTime(row.sourceTime),
    status: row.status ?? (yieldPercent === null ? 'MISSING' : 'SUCCESS'),
    errorSummary: row.errorSummary ?? null,
  };
}

function latestRecordsByCurvePoint(
  records: YieldHistoryRecord[],
  countries: readonly YieldHistoryCountry[],
  tenors: readonly YieldHistoryTenor[]
): YieldHistoryRecord[] {
  const latestByKey = new Map<string, YieldHistoryRecord>();

  for (const record of records) {
    const key = curveKey(record.country, record.tenor);
    const current = latestByKey.get(key);
    if (!current || shouldReplaceLatest(current, record)) {
      latestByKey.set(key, record);
    }
  }

  return countries
    .flatMap((country) => tenors.map((tenor) => curveKey(country, tenor)))
    .map((key) => latestByKey.get(key))
    .filter((record): record is YieldHistoryRecord => record !== undefined);
}

function shouldReplaceLatest(
  current: YieldHistoryRecord,
  candidate: YieldHistoryRecord
): boolean {
  if (candidate.date !== current.date) {
    return candidate.date > current.date;
  }

  const currentHasYield = hasUsableYield(current);
  const candidateHasYield = hasUsableYield(candidate);
  if (currentHasYield !== candidateHasYield) return candidateHasYield;

  return (candidate.sourceId ?? '') < (current.sourceId ?? '');
}

function buildMissingWarnings(
  latestRecords: YieldHistoryRecord[],
  window: YieldHistoryWindow,
  countries: readonly YieldHistoryCountry[],
  tenors: readonly YieldHistoryTenor[]
): YieldHistoryWarning[] {
  const latestByKey = new Map(
    latestRecords.map((record) => [
      curveKey(record.country, record.tenor),
      record,
    ])
  );
  const missing = countries.flatMap((country) =>
    tenors
      .filter(
        (tenor) => !hasUsableYield(latestByKey.get(curveKey(country, tenor)))
      )
      .map((tenor) => ({ country, tenor }))
  );

  if (missing.length === 0) return [];

  return [
    {
      code: 'yield_curve_missing',
      message:
        'Yield curve history is missing one or more required CN/US tenor records in the annual window.',
      details: {
        window_start: window.start,
        window_end: window.end,
        missing,
      },
    },
  ];
}

function calculateTenYearTwoYearSpread(
  records: YieldHistoryRecord[],
  country: YieldHistoryCountry
): number | null {
  const tenYearYield = findYield(records, country, '10Y');
  const twoYearYield = findYield(records, country, '2Y');
  if (tenYearYield === null || twoYearYield === null) return null;

  return toBasisPoints(tenYearYield - twoYearYield);
}

function calculateCrossCountrySpread(
  records: YieldHistoryRecord[],
  leftCountry: YieldHistoryCountry,
  rightCountry: YieldHistoryCountry
): number | null {
  const leftYield = findYield(records, leftCountry, '10Y');
  const rightYield = findYield(records, rightCountry, '10Y');
  if (leftYield === null || rightYield === null) return null;

  return toBasisPoints(leftYield - rightYield);
}

function findYield(
  records: YieldHistoryRecord[],
  country: YieldHistoryCountry,
  tenor: YieldHistoryTenor
): number | null {
  const record = records.find(
    (item) => item.country === country && item.tenor === tenor
  );
  return hasUsableYield(record) ? record.yieldPercent : null;
}

function hasUsableYield(
  record: YieldHistoryRecord | undefined
): record is YieldHistoryRecord & { yieldPercent: number } {
  return (
    record !== undefined &&
    record.yieldPercent !== null &&
    !MISSING_STATUSES.has(record.status)
  );
}

function compareRecords(
  left: YieldHistoryRecord,
  right: YieldHistoryRecord
): number {
  return (
    left.date.localeCompare(right.date) ||
    countryOrder(left.country) - countryOrder(right.country) ||
    tenorOrder(left.tenor) - tenorOrder(right.tenor) ||
    (left.sourceId ?? '').localeCompare(right.sourceId ?? '')
  );
}

function countryOrder(country: YieldHistoryCountry): number {
  return DEFAULT_COUNTRIES.indexOf(country);
}

function tenorOrder(tenor: YieldHistoryTenor): number {
  return DEFAULT_TENORS.indexOf(tenor);
}

function curveKey(
  country: YieldHistoryCountry,
  tenor: YieldHistoryTenor
): string {
  return `${country}:${tenor}`;
}

function maxDate(dates: string[]): string | null {
  return dates.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? value : null;
}

function toBasisPoints(percentDelta: number): number {
  return Math.round(percentDelta * 10_000) / 100;
}

function serializeSourceTime(
  value: Date | string | null | undefined
): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
