import {
  GatewaySourceHealthStatus,
  SourceGatewayRepository,
  SourceHealthRecordInput,
  SourceRunRecordInput,
} from '@uht/domain/repositories';
import {
  M2DataRepository,
  SourceHealthStatus,
  SourceRunStatus,
} from '@uht/domain';

const OPERATION_DOMAIN: Record<string, string> = {
  'fx-rates': 'fx',
  'yield-curve': 'yield_curve',
  'market-quote': 'market_quote',
  'market-kline': 'market_quote',
  'macro-indicator': 'macro',
};

export class M2SourceGatewayRepository implements SourceGatewayRepository {
  constructor(private readonly repository: M2DataRepository) {}

  async recordSourceRun(input: SourceRunRecordInput): Promise<void> {
    await this.repository.upsertSourceRun({
      runKey: input.runId,
      sourceId: input.sourceId,
      domain: operationDomain(input.operation),
      job: input.operation,
      startedAt: new Date(input.startedAt),
      finishedAt: new Date(input.endedAt),
      status: mapRunStatus(input.status),
      rowsWritten: input.rowCount ?? 0,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
  }

  async upsertSourceHealth(input: SourceHealthRecordInput): Promise<void> {
    await this.repository.upsertSourceHealth({
      sourceId: input.sourceId,
      domain: operationDomainFromSource(input.sourceId),
      status: mapHealthStatus(input.status),
      checkedAt: new Date(input.checkedAt),
      lastSuccessAt: input.lastSuccessAt
        ? new Date(input.lastSuccessAt)
        : undefined,
      lastFailureAt: input.lastErrorAt
        ? new Date(input.lastErrorAt)
        : undefined,
      consecutiveFailures: input.status === 'healthy' ? 0 : 1,
      latencyMs: input.latencyMs,
      errorCode: input.lastErrorCode,
      errorMessage: input.lastErrorMessage,
    });
  }
}

export function createM2SourceGatewayRepository(
  repository: M2DataRepository
): SourceGatewayRepository {
  return new M2SourceGatewayRepository(repository);
}

function operationDomain(operation: string): string {
  return OPERATION_DOMAIN[operation] ?? operation;
}

function operationDomainFromSource(sourceId: string): string {
  if (sourceId.includes('yield')) return 'yield_curve';
  if (sourceId.includes('macro') || sourceId.includes('fred')) return 'macro';
  if (sourceId.includes('market') || sourceId.includes('tencent')) {
    return 'market_quote';
  }
  if (sourceId.includes('fx')) return 'fx';
  return 'unknown';
}

function mapRunStatus(status: SourceRunRecordInput['status']): SourceRunStatus {
  return status === 'success' ? 'SUCCESS' : 'FAILED';
}

function mapHealthStatus(
  status: GatewaySourceHealthStatus
): SourceHealthStatus {
  if (status === 'healthy') return 'HEALTHY';
  if (status === 'degraded') return 'DEGRADED';
  return 'DOWN';
}
