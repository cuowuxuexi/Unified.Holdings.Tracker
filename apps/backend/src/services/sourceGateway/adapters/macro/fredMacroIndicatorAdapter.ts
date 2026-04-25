import { toSourceError } from '../../errors';
import { SourceAdapter, SourceAdapterContext, SourceResult } from '../../types';
import { getMacroIndicatorDefinition } from './catalog';
import { normalizeFredObservations } from './normalizer';
import {
  FredObservationResponse,
  MacroHttpFetcher,
  MacroIndicatorRequest,
  MacroIndicatorSnapshot,
} from './types';

export interface FredMacroIndicatorAdapterOptions {
  apiKey?: string;
  fetcher?: MacroHttpFetcher;
  baseUrl?: string;
  sourceId?: string;
}

const DEFAULT_FRED_BASE_URL =
  'https://api.stlouisfed.org/fred/series/observations';

export class FredMacroIndicatorAdapter
  implements SourceAdapter<MacroIndicatorRequest, MacroIndicatorSnapshot[]>
{
  readonly id: string;

  private readonly apiKey?: string;
  private readonly fetcher: MacroHttpFetcher;
  private readonly baseUrl: string;

  constructor(options: FredMacroIndicatorAdapterOptions = {}) {
    this.id = options.sourceId ?? 'fred-macro';
    this.apiKey = options.apiKey ?? process.env.FRED_API_KEY;
    this.fetcher = options.fetcher ?? defaultFetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_FRED_BASE_URL;
  }

  async fetch(
    request: MacroIndicatorRequest,
    context: SourceAdapterContext
  ): Promise<SourceResult<MacroIndicatorSnapshot[]>> {
    if (!this.apiKey) {
      return {
        ok: false,
        error: toSourceError(
          this.id,
          'SOURCE_NOT_CONFIGURED',
          'FRED_API_KEY is not configured',
          false
        ),
      };
    }

    const records: MacroIndicatorSnapshot[] = [];

    for (const indicatorId of request.indicatorIds) {
      const definition = getMacroIndicatorDefinition(indicatorId);
      const url = this.buildUrl(definition.sourceSeriesId, request);
      const response = await this.fetcher(url, { signal: context.signal });

      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          error: toSourceError(
            this.id,
            'SOURCE_HTTP_ERROR',
            `FRED returned HTTP ${response.status} for ${indicatorId}`,
            response.status >= 500,
            response.status
          ),
        };
      }

      const payload = (await response.json()) as FredObservationResponse;
      const normalized = normalizeFredObservations(payload, {
        indicatorId,
        sourceId: this.id,
        asOfDate: request.asOfDate,
        maxStaleDays: request.maxStaleDays,
      });

      if (normalized.error) {
        return { ok: false, error: normalized.error };
      }

      records.push(...normalized.records);
    }

    return {
      ok: true,
      data: records,
      metadata: { source: 'fred', indicatorCount: request.indicatorIds.length },
    };
  }

  private buildUrl(seriesId: string, request: MacroIndicatorRequest): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', this.apiKey as string);
    url.searchParams.set('file_type', 'json');
    if (request.dateFrom)
      url.searchParams.set('observation_start', request.dateFrom);
    if (request.dateTo) url.searchParams.set('observation_end', request.dateTo);
    return url.toString();
  }
}

export function createFredMacroIndicatorAdapter(
  options: FredMacroIndicatorAdapterOptions = {}
): FredMacroIndicatorAdapter {
  return new FredMacroIndicatorAdapter(options);
}

const defaultFetch: MacroHttpFetcher = (url, init) => fetch(url, init);
