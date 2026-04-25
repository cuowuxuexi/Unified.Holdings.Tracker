import { randomUUID } from 'crypto';
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_TIMEOUT_MS,
  FAILURE_HEALTH_STATUS,
  RetryPolicy,
  SourceAdapter,
  SourceError,
  SourceGatewayConfig,
  SourceGatewayResponse,
  SourceResult,
} from './types';
import {
  SourceGatewayError,
  SourceGatewayFailureError,
  normalizeSourceError,
  toSourceError,
} from './errors';

export class SourceGateway<TRequest, TData> {
  private readonly operation: string;
  private readonly adapters: Array<SourceAdapter<TRequest, TData>>;
  private readonly repository: SourceGatewayConfig<
    TRequest,
    TData
  >['repository'];
  private readonly timeoutMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly isEmpty: (data: TData) => boolean;
  private readonly now: () => Date;

  constructor(config: SourceGatewayConfig<TRequest, TData>) {
    this.operation = config.operation;
    this.adapters = config.adapters;
    this.repository = config.repository;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...config.retryPolicy };
    this.isEmpty = config.isEmpty ?? defaultIsEmpty;
    this.now = config.now ?? (() => new Date());
  }

  async execute(request: TRequest): Promise<SourceGatewayResponse<TData>> {
    if (this.adapters.length === 0) {
      throw new SourceGatewayFailureError([
        toSourceError(
          undefinedSourceId,
          'SOURCE_NOT_CONFIGURED',
          `No source adapters configured for ${this.operation}`,
          false
        ),
      ]);
    }

    const attempts: SourceGatewayResponse<TData>['attempts'] = [];
    const errors: SourceError[] = [];

    for (const adapter of this.adapters) {
      for (
        let attempt = 1;
        attempt <= this.retryPolicy.maxAttempts;
        attempt += 1
      ) {
        const startedAt = this.now();
        const runId = randomUUID();

        try {
          const result = await this.runWithTimeout(adapter, request, attempt);
          const error = this.validateResult(adapter.id, result);
          const endedAt = this.now();
          const durationMs = diffMs(startedAt, endedAt);

          if (error) {
            attempts.push({ sourceId: adapter.id, attempt, durationMs, error });
            errors.push(error);
            await this.recordFailure(
              runId,
              adapter.id,
              startedAt,
              endedAt,
              attempt,
              error
            );
            if (!this.shouldRetry(error, attempt)) break;
            await this.waitBeforeRetry(attempt, error);
            continue;
          }

          await this.recordSuccess(
            runId,
            adapter.id,
            startedAt,
            endedAt,
            attempt,
            result.data
          );
          attempts.push({ sourceId: adapter.id, attempt, durationMs });
          return {
            data: result.data as TData,
            sourceId: adapter.id,
            attempts,
            metadata: result.metadata,
          };
        } catch (caught) {
          const endedAt = this.now();
          const durationMs = diffMs(startedAt, endedAt);
          const error = normalizeSourceError(adapter.id, caught);
          attempts.push({ sourceId: adapter.id, attempt, durationMs, error });
          errors.push(error);
          await this.recordFailure(
            runId,
            adapter.id,
            startedAt,
            endedAt,
            attempt,
            error
          );
          if (!this.shouldRetry(error, attempt)) break;
          await this.waitBeforeRetry(attempt, error);
        }
      }
    }

    throw new SourceGatewayFailureError(errors);
  }

  private async runWithTimeout(
    adapter: SourceAdapter<TRequest, TData>,
    request: TRequest,
    attempt: number
  ): Promise<SourceResult<TData>> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    let timedOutError: SourceGatewayError | undefined;

    try {
      return await Promise.race([
        adapter.fetch(request, {
          sourceId: adapter.id,
          operation: this.operation,
          attempt,
          timeoutMs: this.timeoutMs,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOutError = new SourceGatewayError(
              toSourceError(
                adapter.id,
                'SOURCE_TIMEOUT',
                `Source ${adapter.id} timed out after ${this.timeoutMs}ms`,
                true
              )
            );
            reject(timedOutError);
            controller.abort();
          }, this.timeoutMs);
        }),
      ]);
    } catch (error) {
      if (timedOutError) {
        throw timedOutError;
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private validateResult(
    sourceId: string,
    result: SourceResult<TData>
  ): SourceError | null {
    if (!result.ok) {
      return normalizeSourceError(
        sourceId,
        typeof result.error === 'string'
          ? toSourceError(
              sourceId,
              'SOURCE_FAILURE',
              result.error,
              true,
              result.statusCode
            )
          : (result.error ??
              toSourceError(
                sourceId,
                'SOURCE_FAILURE',
                `Source ${sourceId} failed`,
                true
              )),
        'SOURCE_FAILURE'
      );
    }

    if (
      result.statusCode &&
      (result.statusCode < 200 || result.statusCode >= 300)
    ) {
      return toSourceError(
        sourceId,
        'SOURCE_HTTP_ERROR',
        `Source ${sourceId} returned HTTP ${result.statusCode}`,
        result.statusCode >= 500,
        result.statusCode
      );
    }

    if (result.data === undefined || this.isEmpty(result.data)) {
      return toSourceError(
        sourceId,
        'SOURCE_EMPTY_DATA',
        `Source ${sourceId} returned no data`,
        false
      );
    }

    return null;
  }

  private shouldRetry(error: SourceError, attempt: number): boolean {
    if (!error.retryable) return false;
    if (attempt >= this.retryPolicy.maxAttempts) return false;
    return (this.retryPolicy.retryableErrorCodes ?? []).includes(error.code);
  }

  private async waitBeforeRetry(
    attempt: number,
    error: SourceError
  ): Promise<void> {
    const backoff = this.retryPolicy.backoffMs;
    const delay =
      typeof backoff === 'function' ? backoff(attempt, error) : (backoff ?? 0);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async recordSuccess(
    runId: string,
    sourceId: string,
    startedAt: Date,
    endedAt: Date,
    attempt: number,
    data: TData | undefined
  ): Promise<void> {
    const durationMs = diffMs(startedAt, endedAt);
    await this.repository.recordSourceRun({
      runId,
      sourceId,
      operation: this.operation,
      status: 'success',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs,
      attempt,
      rowCount: countRows(data),
    });
    await this.repository.upsertSourceHealth({
      sourceId,
      status: 'healthy',
      checkedAt: endedAt.toISOString(),
      latencyMs: durationMs,
      lastSuccessAt: endedAt.toISOString(),
    });
  }

  private async recordFailure(
    runId: string,
    sourceId: string,
    startedAt: Date,
    endedAt: Date,
    attempt: number,
    error: SourceError
  ): Promise<void> {
    const durationMs = diffMs(startedAt, endedAt);
    await this.repository.recordSourceRun({
      runId,
      sourceId,
      operation: this.operation,
      status: 'failed',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs,
      attempt,
      errorCode: error.code,
      errorMessage: error.message,
      metadata: error.statusCode ? { statusCode: error.statusCode } : undefined,
    });
    await this.repository.upsertSourceHealth({
      sourceId,
      status: FAILURE_HEALTH_STATUS[error.code],
      checkedAt: endedAt.toISOString(),
      latencyMs: durationMs,
      lastErrorAt: endedAt.toISOString(),
      lastErrorCode: error.code,
      lastErrorMessage: error.message,
    });
  }
}

const undefinedSourceId = 'source-gateway';

function defaultIsEmpty<TData>(data: TData): boolean {
  if (Array.isArray(data)) return data.length === 0;
  return data === null;
}

function countRows(data: unknown): number | undefined {
  if (Array.isArray(data)) return data.length;
  if (data === undefined || data === null) return 0;
  return 1;
}

function diffMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}
