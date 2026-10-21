import { M2DataRepository } from '@uht/domain';
import { SourceGatewayRepository } from '@uht/domain/repositories';
import { SourceGateway } from '../../../sourceGateway';
import {
  createEastmoneyMacroIndicatorAdapter,
  createFredMacroIndicatorAdapter,
  getMacroCatalogResponse,
  normalizeFredObservations,
  runMacroProductionFetch,
} from '..';
import {
  eastmoneyEmptyFixture,
  eastmoneyIsmPmiFixture,
} from '../__fixtures__/eastmoney';
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
        source: 'FRED',
        sourceSeriesId: 'DTWEXBGS',
        frequency: 'DAILY',
        observationDateSemantics: 'OBSERVATION_DATE',
        releaseCadence: 'WEEKLY',
        defaultMaxStaleDays: 14,
        factDateField: 'date',
        factDateSemantics: 'FRED_OBSERVATION_DATE',
        releaseDateField: null,
        sourceTimeField: 'sourceTime',
        sourceTimeSemantics: 'FRED_REALTIME_END_THEN_START',
      }),
      expect.objectContaining({
        indicatorId: 'US_POLICY_RATE',
        source: 'FRED',
        sourceSeriesId: 'FEDFUNDS',
        frequency: 'MONTHLY',
        observationDateSemantics: 'PERIOD_START_DATE',
        releaseCadence: 'MONTHLY',
        defaultMaxStaleDays: 80,
      }),
    ]);
  });

  it('keeps the latest monthly release fresh until the next release is due', () => {
    // 9 月 CPI 记为 09-01，10-15 发布；到 11-12 下一期发布前都不该判 stale
    const normalized = normalizeFredObservations(
      {
        observations: [
          {
            date: '2026-09-01',
            value: '336.3',
            realtime_start: '2026-10-15',
          },
        ],
      },
      {
        indicatorId: 'US_CPI',
        sourceId: 'fred-macro',
        asOfDate: '2026-11-12',
        maxStaleDays: getMacroCatalogResponse(['US_CPI'])[0]
          .defaultMaxStaleDays,
      }
    );

    expect(normalized.records[0]).toEqual(
      expect.objectContaining({ status: 'SUCCESS' })
    );
  });

  it('sources US_PMI from Eastmoney because FRED delisted NAPM', () => {
    expect(getMacroCatalogResponse(['US_PMI'])).toEqual([
      expect.objectContaining({
        indicatorId: 'US_PMI',
        source: 'EASTMONEY',
        sourceSeriesId: 'EMG00002790',
        observationDateSemantics: 'PERIOD_START_DATE',
      }),
    ]);
  });
});

describe('EastmoneyMacroIndicatorAdapter', () => {
  const context = {
    sourceId: 'eastmoney-macro',
    operation: 'macro-indicator',
    attempt: 1,
    timeoutMs: 1000,
    signal: new AbortController().signal,
  };

  it('keeps only released periods inside the window and maps them to facts', async () => {
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse(eastmoneyIsmPmiFixture));
    const adapter = createEastmoneyMacroIndicatorAdapter({ fetcher });

    const result = await adapter.fetch(
      {
        indicatorIds: ['US_PMI', 'US_CPI'],
        dateFrom: '2026-07-23',
        dateTo: '2026-10-21',
        asOfDate: '2026-10-21',
      },
      context
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('reportName')).toBe('RPT_ECONOMICVALUE_USA');
    expect(url.searchParams.get('filter')).toBe('(INDICATOR_ID="EMG00002790")');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        // 旧一期按 asOfDate 计龄已超阈值，沿用 FRED 归一化的逐条 STALE 语义
        date: '2026-08-01',
        indicatorId: 'US_PMI',
        value: 54.6,
        unit: 'index',
        sourceId: 'eastmoney-macro',
        sourceTime: new Date('2026-09-01T00:00:00.000Z'),
        status: 'STALE',
        errorSummary: 'Latest US_PMI observation is stale as of 2026-10-21',
      },
      {
        date: '2026-09-01',
        indicatorId: 'US_PMI',
        value: 54.5,
        unit: 'index',
        sourceId: 'eastmoney-macro',
        sourceTime: new Date('2026-10-01T00:00:00.000Z'),
        status: 'SUCCESS',
      },
    ]);
  });

  it('fails the source when Eastmoney returns no rows', async () => {
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse(eastmoneyEmptyFixture));
    const adapter = createEastmoneyMacroIndicatorAdapter({ fetcher });

    const result = await adapter.fetch(
      { indicatorIds: ['US_PMI'], asOfDate: '2026-10-21' },
      context
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: 'SOURCE_EMPTY_DATA',
        sourceId: 'eastmoney-macro',
      })
    );
  });
});

describe('FredMacroIndicatorAdapter', () => {
  it('fetches the FRED-sourced catalog entries in canonical order without hardcoded credentials', async () => {
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
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
    expect(result.data).toHaveLength(3);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        source: 'fred',
        indicatorCount: 3,
        indicatorIds: ['DXY', 'US_CPI', 'US_POLICY_RATE'],
        factDateSemantics: 'FRED_OBSERVATION_DATE',
        sourceTimeSemantics: 'FRED_REALTIME_END_THEN_START',
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    const urls = fetcher.mock.calls.map(([url]) => new URL(url));
    expect(urls.map((url) => url.searchParams.get('series_id'))).toEqual([
      'DTWEXBGS',
      'CPIAUCSL',
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

describe('runMacroProductionFetch - FRED 与东方财富分源', () => {
  const request = {
    indicatorIds: ['US_CPI', 'US_PMI'] as Array<'US_CPI' | 'US_PMI'>,
    dateFrom: '2026-07-23',
    dateTo: '2026-10-21',
    asOfDate: '2026-10-21',
  };

  it('merges records from both sources, each keeping its own sourceId', async () => {
    const gatewayRepository = createGatewayRepository();
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse(fredSuccessFixture));
    const eastmoneyFetcher: jest.MockedFunction<MacroHttpFetcher> = jest
      .fn()
      .mockResolvedValue(jsonResponse(eastmoneyIsmPmiFixture));

    const result = await runMacroProductionFetch(request, {
      gatewayRepository,
      apiKey: 'test-key',
      fetcher,
      eastmoneyFetcher,
      retryPolicy: { maxAttempts: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      new URL(fetcher.mock.calls[0][0]).searchParams.get('series_id')
    ).toBe('CPIAUCSL');
    expect(
      result.records.map((record) => [record.indicatorId, record.sourceId])
    ).toEqual([
      ['US_CPI', 'fred-macro'],
      ['US_PMI', 'eastmoney-macro'],
      ['US_PMI', 'eastmoney-macro'],
    ]);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        sourceIds: ['fred-macro', 'eastmoney-macro'],
      })
    );
  });

  it('keeps FRED results when Eastmoney fails', async () => {
    const result = await runMacroProductionFetch(request, {
      gatewayRepository: createGatewayRepository(),
      apiKey: 'test-key',
      fetcher: jest.fn().mockResolvedValue(jsonResponse(fredSuccessFixture)),
      eastmoneyFetcher: jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'down' }, 503)),
      retryPolicy: { maxAttempts: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.sourceId).toBe('fred-macro');
    expect(result.records.map((record) => record.indicatorId)).toEqual([
      'US_CPI',
    ]);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        sourceErrors: [
          expect.objectContaining({ sourceId: 'eastmoney-macro' }),
        ],
      })
    );
  });

  it('still fetches Eastmoney indicators when FRED_API_KEY is missing', async () => {
    const fetcher: jest.MockedFunction<MacroHttpFetcher> = jest.fn();
    const result = await runMacroProductionFetch(request, {
      gatewayRepository: createGatewayRepository(),
      apiKey: '',
      fetcher,
      eastmoneyFetcher: jest
        .fn()
        .mockResolvedValue(jsonResponse(eastmoneyIsmPmiFixture)),
      retryPolicy: { maxAttempts: 1 },
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.sourceId).toBe('eastmoney-macro');
    expect(result.metadata).toEqual(
      expect.objectContaining({ skippedIndicatorIds: ['US_CPI'] })
    );
  });
});
