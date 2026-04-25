import { SourceGateway } from '../../..';
import { SourceGatewayRepository } from '@uht/domain/repositories';
import { createFredMacroIndicatorAdapter, normalizeFredObservations } from '..';
import {
  fredFailureFixture,
  fredMissingValueFixture,
  fredStaleFixture,
  fredSuccessFixture,
} from '../__fixtures__/fred';
import { MacroHttpFetcher } from '../types';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  };
}

function createRepository(): jest.Mocked<SourceGatewayRepository> {
  return {
    recordSourceRun: jest.fn().mockResolvedValue(undefined),
    upsertSourceHealth: jest.fn().mockResolvedValue(undefined),
  };
}

describe('macro indicator normalizer', () => {
  it('maps FRED observations to MacroIndicatorSnapshot facts', () => {
    const normalized = normalizeFredObservations(fredSuccessFixture, {
      indicatorId: 'US_CPI',
      sourceId: 'fred-macro',
    });

    expect(normalized.error).toBeUndefined();
    expect(normalized.records).toEqual([
      {
        date: '2026-03-01',
        indicatorId: 'US_CPI',
        value: 312.332,
        unit: 'index_1982_1984_100',
        sourceId: 'fred-macro',
        sourceTime: new Date('2026-04-10T00:00:00.000Z'),
        status: 'SUCCESS',
      },
    ]);
  });

  it('keeps missing values as records with MISSING status', () => {
    const normalized = normalizeFredObservations(fredMissingValueFixture, {
      indicatorId: 'DXY',
      sourceId: 'fred-macro',
    });

    expect(normalized.records).toEqual([
      expect.objectContaining({
        date: '2026-03-02',
        indicatorId: 'DXY',
        unit: 'index',
        sourceId: 'fred-macro',
        status: 'MISSING',
        errorSummary: 'Missing value for DXY on 2026-03-02',
      }),
    ]);
  });

  it('marks observations stale relative to asOfDate and maxStaleDays', () => {
    const normalized = normalizeFredObservations(fredStaleFixture, {
      indicatorId: 'US_POLICY_RATE',
      sourceId: 'fred-macro',
      asOfDate: '2026-04-25',
      maxStaleDays: 30,
    });

    expect(normalized.records).toEqual([
      expect.objectContaining({
        date: '2025-12-01',
        indicatorId: 'US_POLICY_RATE',
        value: 99.1,
        unit: 'percent',
        sourceId: 'fred-macro',
        status: 'STALE',
        errorSummary:
          'Latest US_POLICY_RATE observation is stale as of 2026-04-25',
      }),
    ]);
  });

  it('normalizes source-level FRED failures', () => {
    const normalized = normalizeFredObservations(fredFailureFixture, {
      indicatorId: 'US_PMI',
      sourceId: 'fred-macro',
    });

    expect(normalized.records).toEqual([]);
    expect(normalized.error).toEqual(
      expect.objectContaining({
        code: 'SOURCE_FAILURE',
        message: 'Bad Request. The series does not exist.',
        retryable: true,
        sourceId: 'fred-macro',
      })
    );
  });
});

describe('FredMacroIndicatorAdapter', () => {
  it('fetches configured DXY/CPI/PMI/policy-rate series without hardcoded credentials', async () => {
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(fredSuccessFixture))
      .mockResolvedValueOnce(jsonResponse(fredSuccessFixture))
      .mockResolvedValueOnce(jsonResponse(fredSuccessFixture))
      .mockResolvedValueOnce(jsonResponse(fredSuccessFixture));
    const adapter = createFredMacroIndicatorAdapter({
      apiKey: 'test-key',
      fetcher,
    });

    const result = await adapter.fetch(
      {
        indicatorIds: ['DXY', 'US_CPI', 'US_PMI', 'US_POLICY_RATE'],
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      },
      {
        sourceId: adapter.id,
        operation: 'macro-indicators',
        attempt: 1,
        timeoutMs: 1000,
        signal: new AbortController().signal,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const urls = fetcher.mock.calls.map(([url]) => new URL(url));
    expect(urls.map((url) => url.searchParams.get('series_id'))).toEqual([
      'DTWEXBGS',
      'CPIAUCSL',
      'NAPM',
      'FEDFUNDS',
    ]);
    expect(
      urls.every((url) => url.searchParams.get('api_key') === 'test-key')
    ).toBe(true);
  });

  it('uses SourceGateway failure recording for upstream HTTP failures', async () => {
    const repository = createRepository();
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'down' }, 503));
    const adapter = createFredMacroIndicatorAdapter({
      apiKey: 'test-key',
      fetcher,
    });
    const gateway = new SourceGateway({
      operation: 'macro-indicators',
      adapters: [adapter],
      repository,
      timeoutMs: 100,
      retryPolicy: { maxAttempts: 1 },
    });

    await expect(
      gateway.execute({ indicatorIds: ['DXY'] })
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          code: 'SOURCE_HTTP_ERROR',
          sourceId: 'fred-macro',
          statusCode: 503,
        }),
      ],
    });
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'fred-macro',
        operation: 'macro-indicators',
        status: 'failed',
        errorCode: 'SOURCE_HTTP_ERROR',
      })
    );
  });
});
