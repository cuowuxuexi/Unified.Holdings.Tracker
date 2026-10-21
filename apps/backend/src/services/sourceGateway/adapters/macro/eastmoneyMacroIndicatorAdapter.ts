import { toSourceError } from '../../errors';
import { SourceAdapter, SourceAdapterContext, SourceResult } from '../../types';
import {
  getFrozenMacroIndicatorCatalog,
  MACRO_FACT_DATE_SEMANTICS,
  MACRO_SOURCE_TIME_SEMANTICS,
} from './catalog';
import { normalizeFredObservations } from './normalizer';
import {
  EastmoneyEconomicValueResponse,
  EastmoneyEconomicValueRow,
  FredObservation,
  MacroHttpFetcher,
  MacroIndicatorRequest,
  MacroIndicatorSnapshot,
} from './types';

export interface EastmoneyMacroIndicatorAdapterOptions {
  fetcher?: MacroHttpFetcher;
  baseUrl?: string;
  sourceId?: string;
}

const DEFAULT_EASTMONEY_BASE_URL =
  'https://datacenter-web.eastmoney.com/api/data/v1/get';
// 月度序列一页 36 期足够覆盖回补窗口（backfill 只往回取 90 天）
const PAGE_SIZE = 36;

/**
 * 东方财富「全球经济数据-美国」。REPORT_DATE 是统计期期初（与 FRED 月度
 * observation date 同义），PUBLISH_DATE 是发布日；尚未发布的期次 VALUE 为 null，
 * 按 PUBLISH_DATE 过滤掉，避免把排期当成缺值。
 */
export class EastmoneyMacroIndicatorAdapter
  implements SourceAdapter<MacroIndicatorRequest, MacroIndicatorSnapshot[]>
{
  readonly id: string;

  private readonly fetcher: MacroHttpFetcher;
  private readonly baseUrl: string;

  constructor(options: EastmoneyMacroIndicatorAdapterOptions = {}) {
    this.id = options.sourceId ?? 'eastmoney-macro';
    this.fetcher = options.fetcher ?? defaultFetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_EASTMONEY_BASE_URL;
  }

  async fetch(
    request: MacroIndicatorRequest,
    context: SourceAdapterContext
  ): Promise<SourceResult<MacroIndicatorSnapshot[]>> {
    const catalog = getFrozenMacroIndicatorCatalog(request.indicatorIds).filter(
      (definition) => definition.source === 'EASTMONEY'
    );
    const records: MacroIndicatorSnapshot[] = [];

    for (const definition of catalog) {
      const response = await this.fetcher(
        this.buildUrl(definition.sourceSeriesId),
        { signal: context.signal }
      );
      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          error: toSourceError(
            this.id,
            'SOURCE_HTTP_ERROR',
            `Eastmoney returned HTTP ${response.status} for ${definition.indicatorId}`,
            response.status >= 500,
            response.status
          ),
        };
      }

      const payload = (await response.json()) as EastmoneyEconomicValueResponse;
      const rows = payload.result?.data;
      if (!Array.isArray(rows)) {
        return {
          ok: false,
          error: toSourceError(
            this.id,
            'SOURCE_EMPTY_DATA',
            `Eastmoney response for ${definition.indicatorId} did not include rows: ${payload.message ?? 'unknown'}`,
            false
          ),
        };
      }

      const normalized = normalizeFredObservations(
        {
          observations: toObservations(rows, request),
        },
        {
          indicatorId: definition.indicatorId,
          sourceId: this.id,
          asOfDate: request.asOfDate,
          maxStaleDays: request.maxStaleDays ?? definition.defaultMaxStaleDays,
        }
      );
      records.push(...normalized.records);
    }

    return {
      ok: true,
      data: records,
      metadata: {
        source: 'eastmoney',
        indicatorCount: catalog.length,
        indicatorIds: catalog.map((definition) => definition.indicatorId),
        factDateSemantics: MACRO_FACT_DATE_SEMANTICS,
        sourceTimeSemantics: MACRO_SOURCE_TIME_SEMANTICS,
      },
    };
  }

  private buildUrl(seriesId: string): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set('reportName', 'RPT_ECONOMICVALUE_USA');
    url.searchParams.set(
      'columns',
      'INDICATOR_ID,REPORT_DATE,PUBLISH_DATE,VALUE'
    );
    url.searchParams.set('filter', `(INDICATOR_ID="${seriesId}")`);
    url.searchParams.set('pageNumber', '1');
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('sortColumns', 'REPORT_DATE');
    url.searchParams.set('sortTypes', '-1');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    return url.toString();
  }
}

function toObservations(
  rows: EastmoneyEconomicValueRow[],
  request: MacroIndicatorRequest
): FredObservation[] {
  const publishedBy = request.dateTo ?? request.asOfDate;
  return rows
    .map((row) => ({
      date: (row.REPORT_DATE ?? '').slice(0, 10),
      published: (row.PUBLISH_DATE ?? '').slice(0, 10),
      value: row.VALUE,
    }))
    .filter(
      (row) =>
        row.date.length === 10 &&
        row.published.length === 10 &&
        (!publishedBy || row.published <= publishedBy) &&
        (!request.dateFrom || row.date >= request.dateFrom) &&
        (!request.dateTo || row.date <= request.dateTo)
    )
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({
      date: row.date,
      value:
        row.value === null || row.value === undefined ? '.' : String(row.value),
      realtime_start: row.published,
    }));
}

export function createEastmoneyMacroIndicatorAdapter(
  options: EastmoneyMacroIndicatorAdapterOptions = {}
): EastmoneyMacroIndicatorAdapter {
  return new EastmoneyMacroIndicatorAdapter(options);
}

const defaultFetch: MacroHttpFetcher = (url, init) =>
  fetch(url, {
    ...init,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
