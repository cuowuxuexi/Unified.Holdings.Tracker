const MACRO_HISTORY_INDICATORS = [
  'DXY',
  'US_CPI',
  'US_PMI',
  'US_POLICY_RATE',
] as const;

export type MacroHistoryIndicatorId = (typeof MACRO_HISTORY_INDICATORS)[number];

export type MacroHistorySnapshotStatus =
  | 'SUCCESS'
  | 'MISSING'
  | 'STALE'
  | 'SOURCE_FAILED';

export interface MacroIndicatorSnapshotLike {
  date: string;
  indicatorId: string;
  value?: number | null;
  unit?: string | null;
  sourceId: string;
  sourceTime?: Date | string | null;
  status?: MacroHistorySnapshotStatus | null;
  errorSummary?: string | null;
}

export interface BuildMacroHistoryInput {
  year: number;
  requestedDate: string;
  rows: MacroIndicatorSnapshotLike[];
  indicatorIds?: MacroHistoryIndicatorId[];
  maxStaleDays?: number;
}

export interface MacroHistoryRecord {
  date: string;
  indicator_id: MacroHistoryIndicatorId;
  value: number | null;
  unit: string | null;
  source_id: string;
  source_time: string | null;
  status: MacroHistorySnapshotStatus;
  error_summary: string | null;
}

export interface MacroHistoryLatestValue {
  date: string;
  value: number;
  unit: string | null;
  source_id: string;
  source_time: string | null;
  status: MacroHistorySnapshotStatus;
}

export interface MacroHistoryWarning {
  code:
    | 'macro_indicator_missing'
    | 'macro_indicator_stale'
    | 'macro_indicator_unavailable'
    | 'macro_indicator_unsupported';
  message: string;
  details?: Record<string, unknown>;
}

export interface MacroHistoryResult {
  indicator_ids: MacroHistoryIndicatorId[];
  window: {
    year: number;
    start_date: string;
    end_date: string;
  };
  records: MacroHistoryRecord[];
  latest_values: Record<
    MacroHistoryIndicatorId,
    MacroHistoryLatestValue | null
  >;
  warnings: MacroHistoryWarning[];
}

const DEFAULT_MAX_STALE_DAYS = 70;
const STATUS_PRIORITY: Record<MacroHistorySnapshotStatus, number> = {
  SUCCESS: 4,
  STALE: 3,
  MISSING: 2,
  SOURCE_FAILED: 1,
};

export function buildMacroHistory(
  input: BuildMacroHistoryInput
): MacroHistoryResult {
  const indicatorIds = input.indicatorIds ?? [...MACRO_HISTORY_INDICATORS];
  const maxStaleDays = input.maxStaleDays ?? DEFAULT_MAX_STALE_DAYS;
  const startDate = `${input.year}-01-01`;
  const endDate = minDate(input.requestedDate, `${input.year}-12-31`);
  const supportedIndicators = new Set<string>(indicatorIds);
  const warnings: MacroHistoryWarning[] = [];

  const unsupportedIndicatorIds = Array.from(
    new Set(
      input.rows
        .map((row) => row.indicatorId)
        .filter((indicatorId) => !isMacroHistoryIndicatorId(indicatorId))
    )
  ).sort();

  if (unsupportedIndicatorIds.length > 0) {
    warnings.push({
      code: 'macro_indicator_unsupported',
      message:
        'Unsupported macro indicators were ignored; M7.5 only covers the current adapter catalog.',
      details: { indicator_ids: unsupportedIndicatorIds },
    });
  }

  const records = input.rows
    .filter(
      (
        row
      ): row is MacroIndicatorSnapshotLike & {
        indicatorId: MacroHistoryIndicatorId;
      } =>
        isMacroHistoryIndicatorId(row.indicatorId) &&
        supportedIndicators.has(row.indicatorId) &&
        row.date >= startDate &&
        row.date <= endDate
    )
    .map(serializeMacroHistoryRecord)
    .sort(compareMacroHistoryRecords);

  const latestByIndicator = selectLatestRecords(records);
  const latestValues = createEmptyLatestValues();

  for (const indicatorId of indicatorIds) {
    const latest = latestByIndicator.get(indicatorId);
    if (!latest) {
      warnings.push({
        code: 'macro_indicator_missing',
        message: `No ${indicatorId} macro facts exist inside the requested annual window.`,
        details: {
          indicator_id: indicatorId,
          window_start: startDate,
          window_end: endDate,
        },
      });
      continue;
    }

    const value = latest.value;
    if (value !== null) {
      latestValues[indicatorId] = {
        date: latest.date,
        value,
        unit: latest.unit,
        source_id: latest.source_id,
        source_time: latest.source_time,
        status: latest.status,
      };
    } else {
      warnings.push({
        code: 'macro_indicator_unavailable',
        message: `${indicatorId} latest macro fact has no usable value.`,
        details: {
          indicator_id: indicatorId,
          latest_date: latest.date,
          status: latest.status,
          error_summary: latest.error_summary,
        },
      });
    }

    const staleDays = daysBetween(latest.date, endDate);
    if (latest.status === 'STALE' || staleDays > maxStaleDays) {
      warnings.push({
        code: 'macro_indicator_stale',
        message: `${indicatorId} latest macro fact is stale for the requested annual window.`,
        details: {
          indicator_id: indicatorId,
          latest_date: latest.date,
          window_end: endDate,
          stale_days: staleDays,
          max_stale_days: maxStaleDays,
          status: latest.status,
        },
      });
    }
  }

  return {
    indicator_ids: indicatorIds,
    window: {
      year: input.year,
      start_date: startDate,
      end_date: endDate,
    },
    records,
    latest_values: latestValues,
    warnings,
  };
}

function isMacroHistoryIndicatorId(
  indicatorId: string
): indicatorId is MacroHistoryIndicatorId {
  return MACRO_HISTORY_INDICATORS.includes(
    indicatorId as MacroHistoryIndicatorId
  );
}

function serializeMacroHistoryRecord(
  row: MacroIndicatorSnapshotLike & { indicatorId: MacroHistoryIndicatorId }
): MacroHistoryRecord {
  return {
    date: row.date,
    indicator_id: row.indicatorId,
    value: toNullableNumber(row.value),
    unit: row.unit ?? null,
    source_id: row.sourceId,
    source_time: serializeSourceTime(row.sourceTime),
    status:
      row.status ??
      (row.value === null || row.value === undefined ? 'MISSING' : 'SUCCESS'),
    error_summary: row.errorSummary ?? null,
  };
}

function serializeSourceTime(sourceTime?: Date | string | null): string | null {
  if (!sourceTime) return null;
  if (sourceTime instanceof Date) return sourceTime.toISOString();
  return sourceTime;
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value;
}

function compareMacroHistoryRecords(
  left: MacroHistoryRecord,
  right: MacroHistoryRecord
): number {
  return (
    left.date.localeCompare(right.date) ||
    left.indicator_id.localeCompare(right.indicator_id) ||
    left.source_id.localeCompare(right.source_id)
  );
}

function selectLatestRecords(
  records: MacroHistoryRecord[]
): Map<MacroHistoryIndicatorId, MacroHistoryRecord> {
  const latestByIndicator = new Map<
    MacroHistoryIndicatorId,
    MacroHistoryRecord
  >();

  for (const record of records) {
    const existing = latestByIndicator.get(record.indicator_id);
    if (!existing || isNewerOrBetter(record, existing)) {
      latestByIndicator.set(record.indicator_id, record);
    }
  }

  return latestByIndicator;
}

function isNewerOrBetter(
  candidate: MacroHistoryRecord,
  existing: MacroHistoryRecord
): boolean {
  if (candidate.date !== existing.date) return candidate.date > existing.date;
  return STATUS_PRIORITY[candidate.status] > STATUS_PRIORITY[existing.status];
}

function createEmptyLatestValues(): Record<
  MacroHistoryIndicatorId,
  MacroHistoryLatestValue | null
> {
  return {
    DXY: null,
    US_CPI: null,
    US_PMI: null,
    US_POLICY_RATE: null,
  };
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function daysBetween(start: string, end: string): number {
  return Math.floor((dateToUtcMs(end) - dateToUtcMs(start)) / 86_400_000);
}

function dateToUtcMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}
