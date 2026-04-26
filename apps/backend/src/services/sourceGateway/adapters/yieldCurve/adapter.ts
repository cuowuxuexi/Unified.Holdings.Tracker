import { toSourceError } from '../../errors';
import { SourceAdapter, SourceResult } from '../../types';
import {
  AkshareYieldCurveFetcherOptions,
  createAkshareYieldCurveFetcher,
} from './akshareFetcher';
import {
  normalizeYieldCurveResponse,
  normalizeYieldCurveSourceFailure,
} from './normalizer';
import {
  YieldCurveFetcher,
  YieldCurveFetcherResponse,
  YieldCurveRecord,
  YieldCurveRequest,
} from './types';

export const DEFAULT_YIELD_CURVE_SOURCE_ID = 'akshare-yield-curve';

export function createYieldCurveAdapter(options: {
  sourceId?: string;
  fetcher?: YieldCurveFetcher;
  fetcherOptions?: AkshareYieldCurveFetcherOptions;
}): SourceAdapter<YieldCurveRequest, YieldCurveRecord[]> {
  const sourceId = options.sourceId ?? DEFAULT_YIELD_CURVE_SOURCE_ID;
  const fetcher =
    options.fetcher ?? createAkshareYieldCurveFetcher(options.fetcherOptions);

  return {
    id: sourceId,
    async fetch(request, context): Promise<SourceResult<YieldCurveRecord[]>> {
      try {
        const response = await fetcher(request, {
          signal: context.signal,
        });
        if (!response.ok) {
          if (shouldBubbleFetcherFailure(response.errorCode)) {
            return {
              ok: false,
              statusCode: response.statusCode,
              error: toSourceError(
                sourceId,
                response.errorCode ?? 'SOURCE_EXCEPTION',
                response.error ?? `Source ${sourceId} failed`,
                response.retryable ??
                  response.errorCode !== 'SOURCE_NOT_CONFIGURED',
                response.statusCode
              ),
            };
          }

          return {
            ok: true,
            statusCode: response.statusCode,
            data: normalizeYieldCurveSourceFailure(
              request,
              sourceId,
              response.error ?? `Source ${sourceId} failed`
            ),
            metadata: { sourceFailed: true },
          };
        }

        return {
          ok: true,
          statusCode: response.statusCode,
          data: normalizeYieldCurveResponse(
            response.data ?? { points: [] },
            request,
            sourceId
          ),
        };
      } catch (error) {
        return {
          ok: false,
          error: toSourceError(
            sourceId,
            'SOURCE_EXCEPTION',
            error instanceof Error ? error.message : String(error),
            true,
            undefined,
            error
          ),
        };
      }
    },
  };
}

function shouldBubbleFetcherFailure(
  errorCode: YieldCurveFetcherResponse['errorCode']
): boolean {
  return (
    errorCode === 'SOURCE_NOT_CONFIGURED' || errorCode === 'SOURCE_EXCEPTION'
  );
}
