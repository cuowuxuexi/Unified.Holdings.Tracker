import { SourceAdapter, SourceAdapterContext, SourceResult } from '../../types';
import { toSourceError } from '../../errors';
import { parseMarketCodeList, normalizeMarketCode } from './codeDiagnostics';
import { klineFreshness, quoteFreshness } from './tencentNormalizers';
import {
  KlineRequest,
  MarketQuoteFetcher,
  MarketQuoteRequest,
  MarketQuoteResponse,
  QuoteRequest,
} from './types';

export const TENCENT_MARKET_QUOTE_SOURCE_ID = 'tencent.marketQuote';

export class MarketQuoteSourceError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = 'MarketQuoteSourceError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? true;
  }
}

export class TencentMarketQuoteAdapter
  implements SourceAdapter<MarketQuoteRequest, MarketQuoteResponse>
{
  readonly id: string;
  private readonly fetcher: MarketQuoteFetcher;

  constructor(
    fetcher: MarketQuoteFetcher,
    id = TENCENT_MARKET_QUOTE_SOURCE_ID
  ) {
    this.id = id;
    this.fetcher = fetcher;
  }

  async fetch(
    request: MarketQuoteRequest,
    _context: SourceAdapterContext
  ): Promise<SourceResult<MarketQuoteResponse>> {
    try {
      const data =
        request.kind === 'quote'
          ? await this.fetchQuoteResponse(request)
          : await this.fetchKlineResponse(request);

      return {
        ok: true,
        data,
        metadata: {
          requested: data.requested,
          found: data.found,
          missing: data.missing,
          invalid: data.invalid,
        },
      };
    } catch (error) {
      return this.toFailure(error);
    }
  }

  private async fetchQuoteResponse(
    request: QuoteRequest
  ): Promise<MarketQuoteResponse> {
    const diagnostics = parseMarketCodeList(request.codes);
    const quotes =
      diagnostics.valid.length === 0
        ? []
        : await this.fetcher.fetchQuotes(diagnostics.valid);
    const found = diagnostics.valid.filter((code) =>
      quotes.some((quote) => quote.code === code)
    );
    const missing = diagnostics.valid.filter((code) => !found.includes(code));

    return {
      kind: 'quote',
      requested: diagnostics.requested,
      found,
      missing,
      invalid: diagnostics.invalid,
      quotes,
      freshness: quoteFreshness(quotes),
    };
  }

  private async fetchKlineResponse(
    request: KlineRequest
  ): Promise<MarketQuoteResponse> {
    const parsedCode = normalizeMarketCode(request.code);
    const period = request.period ?? 'daily';
    const fq = request.fq ?? 'qfq';
    const count = request.count ?? 400;

    if (!parsedCode.ok) {
      return {
        kind: 'kline',
        code: null,
        requested: [request.code],
        found: [],
        missing: [],
        invalid: [parsedCode.invalid],
        period,
        fq,
        count,
        points: [],
        freshness: klineFreshness([]),
      };
    }

    const points = await this.fetcher.fetchKline(
      parsedCode.code,
      period,
      request.startDate,
      request.endDate,
      fq,
      count
    );
    const found = points.length > 0 ? [parsedCode.code] : [];
    const missing = points.length > 0 ? [] : [parsedCode.code];

    return {
      kind: 'kline',
      code: parsedCode.code,
      requested: [request.code],
      found,
      missing,
      invalid: [],
      period,
      fq,
      count,
      points,
      freshness: klineFreshness(points),
    };
  }

  private toFailure(error: unknown): SourceResult<MarketQuoteResponse> {
    if (error instanceof MarketQuoteSourceError) {
      return {
        ok: false,
        statusCode: error.statusCode,
        error: toSourceError(
          this.id,
          error.statusCode ? 'SOURCE_HTTP_ERROR' : 'SOURCE_FAILURE',
          error.message,
          error.retryable,
          error.statusCode,
          error
        ),
      };
    }

    return {
      ok: false,
      error: toSourceError(
        this.id,
        'SOURCE_EXCEPTION',
        error instanceof Error ? error.message : String(error),
        true,
        undefined,
        error
      ),
    };
  }
}

export function isEmptyMarketQuoteResponse(data: MarketQuoteResponse): boolean {
  return data.requested.length === 0;
}
