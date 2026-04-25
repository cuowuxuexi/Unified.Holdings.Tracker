import { SourceAdapter, SourceResult, toSourceError } from '../..';
import { normalizeFxRates } from './normalizer';
import { FX_PAIRS, FxFetcher, FxRateRecord, FxRateRequest } from './types';

export const FX_SOURCE_ID = 'uht.fx.mockable';

export function createFxAdapter(options: {
  fetcher: FxFetcher;
  sourceId?: string;
  receivedAt?: () => Date;
}): SourceAdapter<FxRateRequest, FxRateRecord[]> {
  const sourceId = options.sourceId ?? FX_SOURCE_ID;

  return {
    id: sourceId,
    async fetch(request, context): Promise<SourceResult<FxRateRecord[]>> {
      const response = await options.fetcher(request, {
        signal: context.signal,
        timeoutMs: context.timeoutMs,
      });

      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.statusCode,
          error: toSourceError(
            sourceId,
            response.statusCode ? 'SOURCE_HTTP_ERROR' : 'SOURCE_FAILURE',
            response.errorText ?? `FX source ${sourceId} failed`,
            (response.statusCode ?? 500) >= 500,
            response.statusCode
          ),
        };
      }

      const raw = response.json ? await response.json() : {};
      const data = normalizeFxRates(raw, {
        sourceId,
        requestedDate: request.date,
        requestedPairs: request.pairs ?? [...FX_PAIRS],
        receivedAt: options.receivedAt?.(),
      });

      return {
        ok: true,
        statusCode: response.statusCode,
        data,
        metadata: {
          requestedPairs: request.pairs ?? [...FX_PAIRS],
          requestedDate: request.date,
        },
      };
    },
  };
}
