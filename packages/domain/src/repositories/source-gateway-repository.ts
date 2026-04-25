export type GatewaySourceRunStatus = 'success' | 'failed';

export type GatewaySourceHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface SourceRunRecordInput {
  runId: string;
  sourceId: string;
  operation: string;
  status: GatewaySourceRunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  attempt: number;
  rowCount?: number;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceHealthRecordInput {
  sourceId: string;
  status: GatewaySourceHealthStatus;
  checkedAt: string;
  latencyMs?: number;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceGatewayRepository {
  recordSourceRun(input: SourceRunRecordInput): Promise<void>;
  upsertSourceHealth(input: SourceHealthRecordInput): Promise<void>;
}
