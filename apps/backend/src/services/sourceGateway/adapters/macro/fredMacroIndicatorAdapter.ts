import { toSourceError } from '../../errors';
import { SourceAdapter, SourceAdapterContext, SourceResult } from '../../types';
import {
  getFrozenMacroIndicatorCatalog,
  isFredMacroConfigured,
  MACRO_FACT_DATE_SEMANTICS,
  MACRO_SOURCE_TIME_SEMANTICS,
} from './catalog';
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
    if (!isFredMacroConfigured(this.apiKey)) {
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
    const catalog = getFrozenMacroIndicatorCatalog(request.indicatorIds);
    // 单个序列失败（如 NAPM 已从 FRED 下架）不拖垮整体：记录错误并继续其余指标，
    // 仅当全部序列失败时才整体 fail-closed
    const seriesErrors: Array<{
      indicatorId: string;
      message: string;
      statusCode?: number;
    }> = [];

    for (const definition of catalog) {
      const url = this.buildUrl(definition.sourceSeriesId, request);
      const response = await this.fetcher(url, { signal: context.signal });

      if (!response.ok) {
        seriesErrors.push({
          indicatorId: definition.indicatorId,
          message: `FRED returned HTTP ${response.status} for ${definition.indicatorId}`,
          statusCode: response.status,
        });
        continue;
      }

      const payload = (await response.json()) as FredObservationResponse;
      const normalized = normalizeFredObservations(payload, {
        indicatorId: definition.indicatorId,
        sourceId: this.id,
        asOfDate: request.asOfDate,
        maxStaleDays: request.maxStaleDays ?? definition.defaultMaxStaleDays,
      });

      if (normalized.error) {
        seriesErrors.push({
          indicatorId: definition.indicatorId,
          message: normalized.error.message,
        });
        continue;
      }

      records.push(...normalized.records);
    }

    if (records.length === 0 && seriesErrors.length > 0) {
      const firstStatus = seriesErrors.find((e) => e.statusCode)?.statusCode;
      return {
        ok: false,
        statusCode: firstStatus,
        error: toSourceError(
          this.id,
          'SOURCE_HTTP_ERROR',
          seriesErrors.map((e) => e.message).join('; '),
          seriesErrors.some((e) => (e.statusCode ?? 0) >= 500),
          firstStatus
        ),
      };
    }

    return {
      ok: true,
      data: records,
      metadata: {
        source: 'fred',
        indicatorCount: catalog.length,
        indicatorIds: catalog.map((definition) => definition.indicatorId),
        factDateSemantics: MACRO_FACT_DATE_SEMANTICS,
        sourceTimeSemantics: MACRO_SOURCE_TIME_SEMANTICS,
        ...(seriesErrors.length > 0 ? { seriesErrors } : {}),
      },
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
