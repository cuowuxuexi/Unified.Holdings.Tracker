import { SourceAdapter, SourceResult, toSourceError } from '../..';
import {
  normalizeYieldCurveResponse,
  normalizeYieldCurveSourceFailure,
} from './normalizer';
import {
  YieldCurveFetcher,
  YieldCurveRecord,
  YieldCurveRequest,
} from './types';

export const DEFAULT_YIELD_CURVE_SOURCE_ID = 'akshare-yield-curve';

export function createYieldCurveAdapter(options: {
  sourceId?: string;
  fetcher: YieldCurveFetcher;
}): SourceAdapter<YieldCurveRequest, YieldCurveRecord[]> {
  const sourceId = options.sourceId ?? DEFAULT_YIELD_CURVE_SOURCE_ID;

  return {
    id: sourceId,
    async fetch(request, context): Promise<SourceResult<YieldCurveRecord[]>> {
      try {
        const response = await options.fetcher(request, {
          signal: context.signal,
        });
        if (!response.ok) {
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
