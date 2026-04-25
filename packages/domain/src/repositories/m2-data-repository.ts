export type SourceRunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export type SourceHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export type M2SnapshotStatus =
  | 'SUCCESS'
  | 'MISSING'
  | 'STALE'
  | 'SOURCE_FAILED';

export interface SourceRunRecord {
  id: string;
  runKey: string;
  sourceId: string;
  domain: string;
  job?: string;
  targetDate?: string;
  startedAt: Date;
  finishedAt?: Date;
  status: SourceRunStatus;
  rowsWritten: number;
  errorCode?: string;
  errorMessage?: string;
  payloadHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSourceRunInput {
  runKey: string;
  sourceId: string;
  domain: string;
  job?: string;
  targetDate?: string;
  startedAt: Date;
  finishedAt?: Date;
  status: SourceRunStatus;
  rowsWritten?: number;
  errorCode?: string;
  errorMessage?: string;
  payloadHash?: string;
}

export interface SourceHealthRecord {
  id: number;
  sourceId: string;
  domain: string;
  status: SourceHealthStatus;
  checkedAt: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  consecutiveFailures: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSourceHealthInput {
  sourceId: string;
  domain: string;
  status: SourceHealthStatus;
  checkedAt: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  consecutiveFailures?: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface YieldCurveSnapshotRecord {
  id: number;
  date: string;
  country: string;
  tenor: string;
  yieldPercent?: number;
  sourceId: string;
  sourceTime?: Date;
  status: M2SnapshotStatus;
  errorSummary?: string;
  payloadHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertYieldCurveSnapshotInput {
  date: string;
  country: string;
  tenor: string;
  yieldPercent?: number;
  sourceId: string;
  sourceTime?: Date;
  status: M2SnapshotStatus;
  errorSummary?: string;
  payloadHash?: string;
}

export interface YieldCurveSnapshotQuery {
  dateFrom?: string;
  dateTo?: string;
  country?: string;
  tenors?: string[];
  sourceId?: string;
  status?: M2SnapshotStatus;
}

export interface MacroIndicatorSnapshotRecord {
  id: number;
  date: string;
  indicatorId: string;
  value?: number;
  unit?: string;
  sourceId: string;
  sourceTime?: Date;
  status: M2SnapshotStatus;
  errorSummary?: string;
  payloadHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertMacroIndicatorSnapshotInput {
  date: string;
  indicatorId: string;
  value?: number;
  unit?: string;
  sourceId: string;
  sourceTime?: Date;
  status: M2SnapshotStatus;
  errorSummary?: string;
  payloadHash?: string;
}

export interface MacroIndicatorSnapshotQuery {
  dateFrom?: string;
  dateTo?: string;
  indicatorIds?: string[];
  sourceId?: string;
  status?: M2SnapshotStatus;
}

export interface M2DataRepository {
  upsertSourceRun(input: UpsertSourceRunInput): Promise<SourceRunRecord>;
  upsertSourceHealth(
    input: UpsertSourceHealthInput
  ): Promise<SourceHealthRecord>;
  upsertYieldCurveSnapshot(
    input: UpsertYieldCurveSnapshotInput
  ): Promise<YieldCurveSnapshotRecord>;
  listYieldCurveSnapshots(
    query: YieldCurveSnapshotQuery
  ): Promise<YieldCurveSnapshotRecord[]>;
  upsertMacroIndicatorSnapshot(
    input: UpsertMacroIndicatorSnapshotInput
  ): Promise<MacroIndicatorSnapshotRecord>;
  listMacroIndicatorSnapshots(
    query: MacroIndicatorSnapshotQuery
  ): Promise<MacroIndicatorSnapshotRecord[]>;
}
