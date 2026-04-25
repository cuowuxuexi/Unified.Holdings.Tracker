import { SourceError, SourceGatewayErrorCode } from './types';

export class SourceGatewayError extends Error {
  readonly details: SourceError;

  constructor(details: SourceError) {
    super(details.message);
    this.name = 'SourceGatewayError';
    this.details = details;
  }
}

export class SourceGatewayFailureError extends Error {
  readonly errors: SourceError[];

  constructor(errors: SourceError[]) {
    super(
      errors
        .map((error) => `${error.sourceId ?? 'unknown'}:${error.code}`)
        .join(', ')
    );
    this.name = 'SourceGatewayFailureError';
    this.errors = errors;
  }
}

export function normalizeSourceError(
  sourceId: string,
  error: unknown,
  fallbackCode: SourceGatewayErrorCode = 'SOURCE_EXCEPTION'
): SourceError {
  if (error instanceof SourceGatewayError) {
    return { ...error.details, sourceId: error.details.sourceId ?? sourceId };
  }

  if (isSourceError(error)) {
    return { ...error, sourceId: error.sourceId ?? sourceId };
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
      sourceId,
      retryable: true,
      cause: error,
    };
  }

  return {
    code: fallbackCode,
    message: String(error),
    sourceId,
    retryable: true,
    cause: error,
  };
}

export function toSourceError(
  sourceId: string,
  code: SourceGatewayErrorCode,
  message: string,
  retryable: boolean,
  statusCode?: number,
  cause?: unknown
): SourceError {
  return { code, message, sourceId, statusCode, retryable, cause };
}

function isSourceError(error: unknown): error is SourceError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Partial<SourceError>;
  return (
    typeof candidate.code === 'string' && typeof candidate.message === 'string'
  );
}
