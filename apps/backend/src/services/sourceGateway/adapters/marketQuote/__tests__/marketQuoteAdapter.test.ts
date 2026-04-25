import { SourceAdapterContext } from '../../../types';
import { MarketQuoteSourceError, TencentMarketQuoteAdapter } from '../adapter';
import { MarketQuoteFetcher } from '../types';
import { aShareQuote, dailyKline, hkQuote, usQuote } from './fixtures';

const context: SourceAdapterContext = {
  sourceId: 'tencent.marketQuote',
  operation: 'marketQuote',
  attempt: 1,
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

describe('TencentMarketQuoteAdapter', () => {
  it('returns quote diagnostics for A-share, HK, US, missing, and invalid codes', async () => {
    const fetcher = mockFetcher({ quotes: [aShareQuote, hkQuote, usQuote] });
    const adapter = new TencentMarketQuoteAdapter(fetcher);

    const result = await adapter.fetch(
      {
        kind: 'quote',
        codes: ['SH600519', 'hk00700', 'usAapl', 'sz000001', 'bad'],
      },
      context
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      kind: 'quote',
      requested: ['SH600519', 'hk00700', 'usAapl', 'sz000001', 'bad'],
      found: ['sh600519', 'hk00700', 'usAAPL'],
      missing: ['sz000001'],
      invalid: [
        {
          code: 'bad',
          reason:
            'unsupported_format: expected sh/sz + 6 digits, hk + 5 digits, hkHSI, or us + ticker',
        },
      ],
      quotes: [aShareQuote, hkQuote, usQuote],
    });
    expect(fetcher.fetchQuotes).toHaveBeenCalledWith([
      'sh600519',
      'hk00700',
      'usAAPL',
      'sz000001',
    ]);
  });

  it('does not call the source when all quote codes are invalid', async () => {
    const fetcher = mockFetcher({ quotes: [] });
    const adapter = new TencentMarketQuoteAdapter(fetcher);

    const result = await adapter.fetch(
      { kind: 'quote', codes: ['bad', ' '] },
      context
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      kind: 'quote',
      requested: ['bad', ''],
      found: [],
      missing: [],
      invalid: [{ code: 'bad' }, { code: '' }],
      quotes: [],
    });
    expect(fetcher.fetchQuotes).not.toHaveBeenCalled();
  });

  it('returns kline diagnostics for found and empty data', async () => {
    const fetcher = mockFetcher({ points: dailyKline });
    const adapter = new TencentMarketQuoteAdapter(fetcher);

    const found = await adapter.fetch(
      { kind: 'kline', code: 'SH600519', period: 'daily', fq: 'qfq', count: 2 },
      context
    );

    expect(found.ok).toBe(true);
    expect(found.data).toMatchObject({
      kind: 'kline',
      code: 'sh600519',
      requested: ['SH600519'],
      found: ['sh600519'],
      missing: [],
      invalid: [],
      points: dailyKline,
    });

    fetcher.fetchKline = jest.fn().mockResolvedValue([]);
    const missing = await adapter.fetch(
      { kind: 'kline', code: 'hk00700' },
      context
    );

    expect(missing.ok).toBe(true);
    expect(missing.data).toMatchObject({
      kind: 'kline',
      code: 'hk00700',
      found: [],
      missing: ['hk00700'],
      invalid: [],
      points: [],
    });
  });

  it('reports invalid kline codes without calling the source', async () => {
    const fetcher = mockFetcher({ points: [] });
    const adapter = new TencentMarketQuoteAdapter(fetcher);

    const result = await adapter.fetch({ kind: 'kline', code: 'bad' }, context);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      kind: 'kline',
      code: null,
      requested: ['bad'],
      found: [],
      missing: [],
      invalid: [{ code: 'bad' }],
      points: [],
    });
    expect(fetcher.fetchKline).not.toHaveBeenCalled();
  });

  it('normalizes non-200/source failures as SourceGateway failures', async () => {
    const fetcher = mockFetcher({ quotes: [] });
    fetcher.fetchQuotes = jest.fn().mockRejectedValue(
      new MarketQuoteSourceError('Tencent returned HTTP 503', {
        statusCode: 503,
      })
    );
    const adapter = new TencentMarketQuoteAdapter(fetcher);

    const result = await adapter.fetch(
      { kind: 'quote', codes: ['sh600519'] },
      context
    );

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error).toMatchObject({
      code: 'SOURCE_HTTP_ERROR',
      sourceId: 'tencent.marketQuote',
      statusCode: 503,
      retryable: true,
    });
  });
});

function mockFetcher(options: {
  quotes?: Awaited<ReturnType<MarketQuoteFetcher['fetchQuotes']>>;
  points?: Awaited<ReturnType<MarketQuoteFetcher['fetchKline']>>;
}): jest.Mocked<MarketQuoteFetcher> {
  return {
    fetchQuotes: jest.fn().mockResolvedValue(options.quotes ?? []),
    fetchKline: jest.fn().mockResolvedValue(options.points ?? []),
  };
}
