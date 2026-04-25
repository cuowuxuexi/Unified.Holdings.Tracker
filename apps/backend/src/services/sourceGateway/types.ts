import {
  GatewaySourceHealthStatus,
  SourceGatewayRepository,
} from '@uht/domain/repositories';

export type SourceGatewayErrorCode =
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_EMPTY_DATA'
  | 'SOURCE_HTTP_ERROR'
  | 'SOURCE_FAILURE'
  | 'SOURCE_EXCEPTION'
  | 'SOURCE_NOT_CONFIGURED';

export interface SourceError {
  code: SourceGatewayErrorCode;
  message: string;
  sourceId?: string;
  statusCode?: number;
  retryable: boolean;
  cause?: unknown;
}

export interface SourceResult<TData> {
  ok: boolean;
  data?: TData;
  statusCode?: number;
  error?: SourceError | string;
  metadata?: Record<string, unknown>;
}

export interface SourceAdapterContext {
  sourceId: string;
  operation: string;
  attempt: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface SourceAdapter<TRequest, TData> {
  id: string;
  fetch(
    request: TRequest,
    context: SourceAdapterContext
  ): Promise<SourceResult<TData>>;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs?: number | ((attempt: number, error: SourceError) => number);
  retryableErrorCodes?: SourceGatewayErrorCode[];
}

export interface SourceGatewayConfig<TRequest, TData> {
  operation: string;
  adapters: Array<SourceAdapter<TRequest, TData>>;
  repository: SourceGatewayRepository;
  timeoutMs?: number;
  retryPolicy?: Partial<RetryPolicy>;
  isEmpty?: (data: TData) => boolean;
  now?: () => Date;
}

export interface SourceAttempt {
  sourceId: string;
  attempt: number;
  durationMs: number;
  error?: SourceError;
}

export interface SourceGatewayResponse<TData> {
  data: TData;
  sourceId: string;
  attempts: SourceAttempt[];
  metadata?: Record<string, unknown>;
}

export interface SourceGatewayFailure {
  operation: string;
  attempts: SourceAttempt[];
  errors: SourceError[];
}

export const DEFAULT_TIMEOUT_MS = 5000;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 0,
  retryableErrorCodes: [
    'SOURCE_TIMEOUT',
    'SOURCE_EXCEPTION',
    'SOURCE_FAILURE',
    'SOURCE_HTTP_ERROR',
  ],
};

export const FAILURE_HEALTH_STATUS: Record<
  SourceGatewayErrorCode,
  GatewaySourceHealthStatus
> = {
  SOURCE_TIMEOUT: 'degraded',
  SOURCE_EMPTY_DATA: 'degraded',
  SOURCE_HTTP_ERROR: 'degraded',
  SOURCE_FAILURE: 'degraded',
  SOURCE_EXCEPTION: 'unhealthy',
  SOURCE_NOT_CONFIGURED: 'unhealthy',
};
