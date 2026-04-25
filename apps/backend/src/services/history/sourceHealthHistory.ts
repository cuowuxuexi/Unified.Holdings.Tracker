export type SourceHealthHistoryDateLike = Date | string;

export type SourceRunLikeRow = {
  id?: string | null;
  runKey?: string | null;
  sourceId: string;
  domain: string;
  job?: string | null;
  targetDate?: string | null;
  startedAt: SourceHealthHistoryDateLike;
  finishedAt?: SourceHealthHistoryDateLike | null;
  status: string;
  rowsWritten?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  payloadHash?: string | null;
};

export type SourceHealthLikeRow = {
  id?: number | string | null;
  sourceId: string;
  domain: string;
  status: string;
  checkedAt: SourceHealthHistoryDateLike;
  lastSuccessAt?: SourceHealthHistoryDateLike | null;
  lastFailureAt?: SourceHealthHistoryDateLike | null;
  consecutiveFailures?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type BuildSourceHealthHistoryInput = {
  year: number;
  requestedDate: string;
  runs: readonly SourceRunLikeRow[];
  current: readonly SourceHealthLikeRow[];
};

export type SourceHealthHistoryWarning = {
  code: 'source_health_not_recorded';
  message: string;
  details?: Record<string, unknown>;
};

export type SourceHealthHistoryRun = {
  id: string | null;
  run_key: string | null;
  source_id: string;
  domain: string;
  job: string | null;
  target_date: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_written: number;
  error_code: string | null;
  error_message: string | null;
  payload_hash: string | null;
};

export type SourceHealthCurrentStatus = {
  id: number | string | null;
  source_id: string;
  domain: string;
  status: string;
  checked_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
};

export type SourceHealthRunSummary = {
  source_id: string;
  domain: string;
  total_runs: number;
  status_counts: Record<string, number>;
  rows_written: number;
  jobs: string[];
  first_run_at: string;
  last_run_at: string;
  latest_status: string;
  latest_error_code: string | null;
  latest_error_message: string | null;
};

export type SourceHealthHistoryResult = {
  window: {
    year: number;
    start: string;
    end: string;
  };
  runs: SourceHealthHistoryRun[];
  current: SourceHealthCurrentStatus[];
  run_summary: SourceHealthRunSummary[];
  warnings: SourceHealthHistoryWarning[];
};

type BuildWindow = SourceHealthHistoryResult['window'];

export function buildSourceHealthHistory(
  input: BuildSourceHealthHistoryInput
): SourceHealthHistoryResult {
  const window = buildWindow(input.year, input.requestedDate);
  const runs = input.runs
    .map(normalizeRun)
    .filter((run): run is SourceHealthHistoryRun => run !== null)
    .filter((run) => isRunInWindow(run, window))
    .sort(compareRuns);
  const current = latestCurrentStatuses(input.current, window);
  const runSummary = buildRunSummary(runs);
  const warnings = buildWarnings(runs, current, window);

  return {
    window,
    runs,
    current,
    run_summary: runSummary,
    warnings,
  };
}

function buildWindow(year: number, requestedDate: string): BuildWindow {
  const normalizedYear = Math.trunc(year);
  const start = `${normalizedYear}-01-01`;
  const end = minDate(requestedDate, `${normalizedYear}-12-31`);

  return {
    year: normalizedYear,
    start,
    end,
  };
}

function normalizeRun(row: SourceRunLikeRow): SourceHealthHistoryRun | null {
  const startedAt = serializeDateTime(row.startedAt);
  if (!startedAt) return null;

  return {
    id: row.id ?? null,
    run_key: row.runKey ?? null,
    source_id: row.sourceId,
    domain: row.domain,
    job: row.job ?? null,
    target_date: normalizeDateOnly(row.targetDate),
    started_at: startedAt,
    finished_at: serializeDateTime(row.finishedAt),
    status: row.status,
    rows_written: row.rowsWritten ?? 0,
    error_code: row.errorCode ?? null,
    error_message: row.errorMessage ?? null,
    payload_hash: row.payloadHash ?? null,
  };
}

function latestCurrentStatuses(
  rows: readonly SourceHealthLikeRow[],
  window: BuildWindow
): SourceHealthCurrentStatus[] {
  const latestBySourceDomain = new Map<string, SourceHealthCurrentStatus>();

  for (const row of rows) {
    const current = normalizeCurrent(row);
    if (!current || !isCurrentInWindow(current, window)) continue;

    const key = sourceDomainKey(current.source_id, current.domain);
    const existing = latestBySourceDomain.get(key);
    if (!existing || compareCurrent(current, existing) > 0) {
      latestBySourceDomain.set(key, current);
    }
  }

  return Array.from(latestBySourceDomain.values()).sort(compareCurrentRows);
}

function normalizeCurrent(
  row: SourceHealthLikeRow
): SourceHealthCurrentStatus | null {
  const checkedAt = serializeDateTime(row.checkedAt);
  if (!checkedAt) return null;

  return {
    id: row.id ?? null,
    source_id: row.sourceId,
    domain: row.domain,
    status: row.status,
    checked_at: checkedAt,
    last_success_at: serializeDateTime(row.lastSuccessAt),
    last_failure_at: serializeDateTime(row.lastFailureAt),
    consecutive_failures: row.consecutiveFailures ?? 0,
    latency_ms: row.latencyMs ?? null,
    error_code: row.errorCode ?? null,
    error_message: row.errorMessage ?? null,
  };
}

function buildRunSummary(
  runs: readonly SourceHealthHistoryRun[]
): SourceHealthRunSummary[] {
  const summaryBySourceDomain = new Map<string, SourceHealthRunSummary>();

  for (const run of runs) {
    const key = sourceDomainKey(run.source_id, run.domain);
    const existing = summaryBySourceDomain.get(key);

    if (!existing) {
      summaryBySourceDomain.set(key, createInitialRunSummary(run));
      continue;
    }

    existing.total_runs += 1;
    existing.rows_written += run.rows_written;
    existing.status_counts[run.status] =
      (existing.status_counts[run.status] ?? 0) + 1;
    if (run.job && !existing.jobs.includes(run.job))
      existing.jobs.push(run.job);
    if (run.started_at < existing.first_run_at) {
      existing.first_run_at = run.started_at;
    }
    if (run.started_at >= existing.last_run_at) {
      existing.last_run_at = run.started_at;
      existing.latest_status = run.status;
      existing.latest_error_code = run.error_code;
      existing.latest_error_message = run.error_message;
    }
  }

  return Array.from(summaryBySourceDomain.values())
    .map((summary) => ({ ...summary, jobs: summary.jobs.sort() }))
    .sort(compareRunSummary);
}

function createInitialRunSummary(
  run: SourceHealthHistoryRun
): SourceHealthRunSummary {
  return {
    source_id: run.source_id,
    domain: run.domain,
    total_runs: 1,
    status_counts: { [run.status]: 1 },
    rows_written: run.rows_written,
    jobs: run.job ? [run.job] : [],
    first_run_at: run.started_at,
    last_run_at: run.started_at,
    latest_status: run.status,
    latest_error_code: run.error_code,
    latest_error_message: run.error_message,
  };
}

function buildWarnings(
  runs: readonly SourceHealthHistoryRun[],
  current: readonly SourceHealthCurrentStatus[],
  window: BuildWindow
): SourceHealthHistoryWarning[] {
  if (runs.length > 0 || current.length > 0) return [];

  return [
    {
      code: 'source_health_not_recorded',
      message:
        'No SourceRun or SourceHealth records exist inside the requested annual window; source health history is not available yet.',
      details: {
        window_start: window.start,
        window_end: window.end,
      },
    },
  ];
}

function isRunInWindow(
  run: SourceHealthHistoryRun,
  window: BuildWindow
): boolean {
  const runDate = run.target_date ?? dateOnlyFromIso(run.started_at);
  return runDate >= window.start && runDate <= window.end;
}

function isCurrentInWindow(
  current: SourceHealthCurrentStatus,
  window: BuildWindow
): boolean {
  const checkedDate = dateOnlyFromIso(current.checked_at);
  return checkedDate >= window.start && checkedDate <= window.end;
}

function serializeDateTime(
  value: SourceHealthHistoryDateLike | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  return value;
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isDateOnly(value)) return value;
  const dateOnly = dateOnlyFromIso(value);

  return isDateOnly(dateOnly) ? dateOnly : null;
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateOnlyFromIso(value: string): string {
  return value.slice(0, 10);
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function sourceDomainKey(sourceId: string, domain: string): string {
  return `${sourceId}\u0000${domain}`;
}

function compareRuns(
  left: SourceHealthHistoryRun,
  right: SourceHealthHistoryRun
): number {
  return (
    left.started_at.localeCompare(right.started_at) ||
    left.domain.localeCompare(right.domain) ||
    left.source_id.localeCompare(right.source_id) ||
    (left.run_key ?? '').localeCompare(right.run_key ?? '')
  );
}

function compareCurrent(
  left: SourceHealthCurrentStatus,
  right: SourceHealthCurrentStatus
): number {
  return (
    left.checked_at.localeCompare(right.checked_at) ||
    left.status.localeCompare(right.status) ||
    String(left.id ?? '').localeCompare(String(right.id ?? ''))
  );
}

function compareCurrentRows(
  left: SourceHealthCurrentStatus,
  right: SourceHealthCurrentStatus
): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.source_id.localeCompare(right.source_id) ||
    left.checked_at.localeCompare(right.checked_at)
  );
}

function compareRunSummary(
  left: SourceHealthRunSummary,
  right: SourceHealthRunSummary
): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.source_id.localeCompare(right.source_id)
  );
}
