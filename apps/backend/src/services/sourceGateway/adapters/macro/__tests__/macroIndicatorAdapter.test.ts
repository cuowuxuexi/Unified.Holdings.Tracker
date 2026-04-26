import { M2DataRepository } from '@uht/domain';
import { SourceGatewayRepository } from '@uht/domain/repositories';
import { SourceGateway } from '../../../sourceGateway';
import {
  createFredMacroIndicatorAdapter,
  getMacroCatalogResponse,
  normalizeFredObservations,
  runMacroProductionFetch,
} from '..';
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

function createGatewayRepository(): jest.Mocked<SourceGatewayRepository> {
  return {
    recordSourceRun: jest.fn().mockResolvedValue(undefined),
    upsertSourceHealth: jest.fn().mockResolvedValue(undefined),
  };
}

function createM2Repository(): jest.Mocked<
  Pick<M2DataRepository, 'upsertMacroIndicatorSnapshot'>
> {
  return {
    upsertMacroIndicatorSnapshot: jest.fn().mockResolvedValue(undefined),
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

describe('macro catalog freeze semantics', () => {
  it('returns the frozen first-batch catalog in canonical order with observation metadata', () => {
    expect(getMacroCatalogResponse(['US_POLICY_RATE', 'DXY'])).toEqual([
      expect.objectContaining({
        indicatorId: 'DXY',
        sourceSeriesId: 'DTWEXBGS',
        frequency: 'DAILY',
        observationDateSemantics: 'OBSERVATION_DATE',
        releaseCadence: 'WEEKLY',
        defaultMaxStaleDays: 10,
        factDateField: 'date',
        factDateSemantics: 'FRED_OBSERVATION_DATE',
        releaseDateField: null,
        sourceTimeField: 'sourceTime',
        sourceTimeSemantics: 'FRED_REALTIME_END_THEN_START',
      }),
      expect.objectContaining({
        indicatorId: 'US_POLICY_RATE',
        sourceSeriesId: 'FEDFUNDS',
        frequency: 'MONTHLY',
        observationDateSemantics: 'PERIOD_START_DATE',
        releaseCadence: 'MONTHLY',
        defaultMaxStaleDays: 45,
      }),
    ]);
  });
});

describe('FredMacroIndicatorAdapter', () => {
  it('fetches the frozen multi-indicator catalog in canonical order without hardcoded credentials', async () => {
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
        indicatorIds: ['US_POLICY_RATE', 'DXY', 'US_PMI', 'US_CPI'],
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        asOfDate: '2026-04-25',
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
    expect(result.metadata).toEqual(
      expect.objectContaining({
        source: 'fred',
        indicatorCount: 4,
        indicatorIds: ['DXY', 'US_CPI', 'US_PMI', 'US_POLICY_RATE'],
        factDateSemantics: 'FRED_OBSERVATION_DATE',
        sourceTimeSemantics: 'FRED_REALTIME_END_THEN_START',
      })
    );
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

  it('records source failures through SourceGateway when the upstream HTTP call fails', async () => {
    const repository = createGatewayRepository();
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

describe('runMacroProductionFetch', () => {
  it('fails closed without key before any HTTP or persistence side effects', async () => {
    const gatewayRepository = createGatewayRepository();
    const m2Repository = createM2Repository();
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest.fn();

    const result = await runMacroProductionFetch(
      {
        indicatorIds: ['DXY'],
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      },
      {
        gatewayRepository,
        m2Repository: m2Repository as unknown as M2DataRepository,
        fetcher,
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        sourceId: 'fred-macro',
        requestedIndicatorIds: ['DXY'],
        failClosed: true,
        blocked: expect.objectContaining({
          code: 'SOURCE_NOT_CONFIGURED',
        }),
        persisted: { attempted: false, rowsWritten: 0 },
      })
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(gatewayRepository.recordSourceRun).not.toHaveBeenCalled();
    expect(m2Repository.upsertMacroIndicatorSnapshot).not.toHaveBeenCalled();
  });

  it('fetches and persists a single requested indicator through the production seam', async () => {
    const gatewayRepository = createGatewayRepository();
    const m2Repository = createM2Repository();
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse(fredSuccessFixture));

    const result = await runMacroProductionFetch(
      {
        indicatorIds: ['DXY'],
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        asOfDate: '2026-04-25',
      },
      {
        gatewayRepository,
        m2Repository: m2Repository as unknown as M2DataRepository,
        apiKey: 'test-key',
        fetcher,
        timeoutMs: 100,
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected macro production fetch to succeed');
    }

    expect(result.requestedIndicatorIds).toEqual(['DXY']);
    expect(result.catalog).toEqual([
      expect.objectContaining({
        indicatorId: 'DXY',
        factDateSemantics: 'FRED_OBSERVATION_DATE',
        sourceTimeSemantics: 'FRED_REALTIME_END_THEN_START',
      }),
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({
        date: '2026-03-01',
        indicatorId: 'DXY',
        value: 312.332,
      }),
    ]);
    expect(result.persisted).toEqual({ attempted: true, rowsWritten: 1 });
    expect(gatewayRepository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'fred-macro',
        operation: 'macro-indicator',
        status: 'success',
        rowCount: 1,
      })
    );
    expect(m2Repository.upsertMacroIndicatorSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        indicatorId: 'DXY',
        value: 312.332,
        sourceId: 'fred-macro',
      })
    );
  });

  it('surfaces upstream source failure through the production seam', async () => {
    const gatewayRepository = createGatewayRepository();
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'down' }, 503));

    await expect(
      runMacroProductionFetch(
        {
          indicatorIds: ['DXY'],
          dateFrom: '2026-03-01',
          dateTo: '2026-03-31',
        },
        {
          gatewayRepository,
          apiKey: 'test-key',
          fetcher,
          timeoutMs: 100,
          retryPolicy: { maxAttempts: 1 },
        }
      )
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          code: 'SOURCE_HTTP_ERROR',
          sourceId: 'fred-macro',
          statusCode: 503,
        }),
      ],
    });
    expect(gatewayRepository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'fred-macro',
        operation: 'macro-indicator',
        status: 'failed',
        errorCode: 'SOURCE_HTTP_ERROR',
      })
    );
  });
});
