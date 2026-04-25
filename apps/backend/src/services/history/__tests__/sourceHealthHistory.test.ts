import {
  buildSourceHealthHistory,
  SourceHealthLikeRow,
  SourceRunLikeRow,
} from '../sourceHealthHistory';

function run(overrides: Partial<SourceRunLikeRow>): SourceRunLikeRow {
  return {
    runKey: overrides.runKey ?? 'run-default',
    sourceId: overrides.sourceId ?? 'tencent-market',
    domain: overrides.domain ?? 'market_quote',
    job: overrides.job ?? 'market-quote',
    targetDate: overrides.targetDate,
    startedAt: overrides.startedAt ?? '2026-04-24T08:00:00.000Z',
    finishedAt: overrides.finishedAt ?? '2026-04-24T08:00:03.000Z',
    status: overrides.status ?? 'success',
    rowsWritten: overrides.rowsWritten ?? 10,
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
    payloadHash: overrides.payloadHash,
  };
}

function current(overrides: Partial<SourceHealthLikeRow>): SourceHealthLikeRow {
  return {
    id: overrides.id ?? 1,
    sourceId: overrides.sourceId ?? 'tencent-market',
    domain: overrides.domain ?? 'market_quote',
    status: overrides.status ?? 'HEALTHY',
    checkedAt: overrides.checkedAt ?? '2026-04-24T08:00:03.000Z',
    lastSuccessAt: overrides.lastSuccessAt ?? '2026-04-24T08:00:03.000Z',
    lastFailureAt: overrides.lastFailureAt,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    latencyMs: overrides.latencyMs ?? 3000,
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
  };
}

describe('buildSourceHealthHistory', () => {
  it('returns annual-window SourceRun events, current statuses, and source/domain run summary', () => {
    const result = buildSourceHealthHistory({
      year: 2026,
      requestedDate: '2026-04-25',
      runs: [
        run({
          runKey: 'previous-year',
          targetDate: '2025-12-31',
          status: 'success',
        }),
        run({
          runKey: 'market-success',
          targetDate: '2026-04-24',
          status: 'success',
          rowsWritten: 11,
        }),
        run({
          runKey: 'market-timeout',
          targetDate: '2026-04-25',
          status: 'timeout',
          rowsWritten: 0,
          startedAt: '2026-04-25T08:00:00.000Z',
          errorCode: 'SOURCE_TIMEOUT',
          errorMessage: 'Tencent quote timed out',
        }),
        run({
          runKey: 'fx-empty',
          sourceId: 'fx-primary',
          domain: 'fx',
          job: 'fx-rates',
          targetDate: '2026-04-25',
          status: 'empty',
          rowsWritten: 0,
          startedAt: '2026-04-25T09:00:00.000Z',
        }),
      ],
      current: [
        current({
          id: 1,
          status: 'DEGRADED',
          checkedAt: '2026-04-24T08:00:00.000Z',
          consecutiveFailures: 1,
        }),
        current({
          id: 2,
          status: 'HEALTHY',
          checkedAt: '2026-04-25T08:00:00.000Z',
        }),
        current({
          id: 3,
          sourceId: 'fx-primary',
          domain: 'fx',
          status: 'DOWN',
          checkedAt: '2026-04-25T09:00:00.000Z',
          lastFailureAt: '2026-04-25T09:00:00.000Z',
          consecutiveFailures: 2,
          errorCode: 'EMPTY_RESPONSE',
        }),
      ],
    });

    expect(result.window).toEqual({
      year: 2026,
      start: '2026-01-01',
      end: '2026-04-25',
    });
    expect(result.runs.map((item) => item.run_key)).toEqual([
      'market-success',
      'market-timeout',
      'fx-empty',
    ]);
    expect(result.current).toEqual([
      expect.objectContaining({
        source_id: 'fx-primary',
        domain: 'fx',
        status: 'DOWN',
        error_code: 'EMPTY_RESPONSE',
      }),
      expect.objectContaining({
        source_id: 'tencent-market',
        domain: 'market_quote',
        status: 'HEALTHY',
        consecutive_failures: 0,
      }),
    ]);
    expect(result.run_summary).toEqual([
      expect.objectContaining({
        source_id: 'fx-primary',
        domain: 'fx',
        total_runs: 1,
        status_counts: { empty: 1 },
        rows_written: 0,
        jobs: ['fx-rates'],
        latest_status: 'empty',
      }),
      expect.objectContaining({
        source_id: 'tencent-market',
        domain: 'market_quote',
        total_runs: 2,
        status_counts: { success: 1, timeout: 1 },
        rows_written: 11,
        jobs: ['market-quote'],
        latest_status: 'timeout',
        latest_error_code: 'SOURCE_TIMEOUT',
      }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('returns empty blocks and source_health_not_recorded when SourceRun and SourceHealth are absent', () => {
    const result = buildSourceHealthHistory({
      year: 2026,
      requestedDate: '2026-04-25',
      runs: [],
      current: [],
    });

    expect(result.runs).toEqual([]);
    expect(result.current).toEqual([]);
    expect(result.run_summary).toEqual([]);
    expect(result.warnings).toEqual([
      {
        code: 'source_health_not_recorded',
        message:
          'No SourceRun or SourceHealth records exist inside the requested annual window; source health history is not available yet.',
        details: {
          window_start: '2026-01-01',
          window_end: '2026-04-25',
        },
      },
    ]);
  });

  it('clips the requested window to year-end and uses startedAt when targetDate is absent', () => {
    const result = buildSourceHealthHistory({
      year: 2026,
      requestedDate: '2027-01-10',
      runs: [
        run({
          runKey: 'started-at-window',
          targetDate: undefined,
          startedAt: '2026-12-31T23:55:00.000Z',
          status: 'stale',
        }),
        run({
          runKey: 'outside-year',
          targetDate: undefined,
          startedAt: '2027-01-01T00:05:00.000Z',
          status: 'success',
        }),
      ],
      current: [
        current({ checkedAt: '2027-01-01T00:00:00.000Z' }),
        current({ checkedAt: '2026-12-31T10:00:00.000Z' }),
      ],
    });

    expect(result.window.end).toBe('2026-12-31');
    expect(result.runs).toEqual([
      expect.objectContaining({
        run_key: 'started-at-window',
        status: 'stale',
      }),
    ]);
    expect(result.current).toEqual([
      expect.objectContaining({ checked_at: '2026-12-31T10:00:00.000Z' }),
    ]);
    expect(result.run_summary[0].status_counts).toEqual({ stale: 1 });
  });

  it('keeps status strings exactly as received instead of remapping them', () => {
    const result = buildSourceHealthHistory({
      year: 2026,
      requestedDate: '2026-04-25',
      runs: [
        run({ runKey: 'upper-success', status: 'SUCCESS' }),
        run({
          runKey: 'lower-success',
          status: 'success',
          startedAt: '2026-04-25T09:00:00.000Z',
        }),
        run({
          runKey: 'failure',
          status: 'failure',
          startedAt: '2026-04-25T10:00:00.000Z',
        }),
      ],
      current: [current({ status: 'unknown-custom-status' })],
    });

    expect(result.runs.map((item) => item.status)).toEqual([
      'SUCCESS',
      'success',
      'failure',
    ]);
    expect(result.current[0].status).toBe('unknown-custom-status');
    expect(result.run_summary[0].status_counts).toEqual({
      SUCCESS: 1,
      success: 1,
      failure: 1,
    });
  });
});
