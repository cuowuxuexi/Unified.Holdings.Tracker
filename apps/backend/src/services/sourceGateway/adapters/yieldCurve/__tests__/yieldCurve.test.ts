import { SourceGatewayRepository } from '@uht/domain/repositories';
import { SourceGateway, SourceGatewayFailureError } from '../../..';
import { createYieldCurveAdapter } from '../adapter';
import {
  buildYieldCurveBridgeRequest,
  createAkshareYieldCurveFetcher,
} from '../akshareFetcher';
import {
  calculateBasisPointChanges,
  calculateCnUsTenYearSpreadBp,
  calculateTenYearTwoYearSpreadBp,
} from '../helpers';
import { createProductionYieldCurveGateway } from '../gateway';
import {
  normalizeYieldCurveResponse,
  normalizeYieldCurveSourceFailure,
} from '../normalizer';
import {
  completeYieldCurveFixture,
  missingTenorFixture,
  staleYieldCurveFixture,
} from '../fixtures/yieldCurve.fixture';

function createRepository(): jest.Mocked<SourceGatewayRepository> {
  return {
    recordSourceRun: jest.fn().mockResolvedValue(undefined),
    upsertSourceHealth: jest.fn().mockResolvedValue(undefined),
  };
}

describe('yieldCurve adapter', () => {
  it('builds the production bridge request for CN/US 2Y,5Y,10Y,30Y history fetches', async () => {
    const runner = jest
      .fn()
      .mockResolvedValue({ ok: true, data: completeYieldCurveFixture });
    const fetcher = createAkshareYieldCurveFetcher({
      lookbackDays: 9,
      pythonCommand: 'python3',
      runner,
    });

    await fetcher(
      { asOfDate: '2026-04-25' },
      { signal: new AbortController().signal }
    );

    expect(runner).toHaveBeenCalledWith(
      buildYieldCurveBridgeRequest({ asOfDate: '2026-04-25' }, 9),
      expect.objectContaining({ pythonCommand: 'python3' })
    );
  });

  it('normalizes successful CN/US 2Y,5Y,10Y,30Y records through the production gateway seam', async () => {
    const repository = createRepository();
    const gateway = createProductionYieldCurveGateway({
      repository,
      sourceId: 'fixture-yield-source',
      fetcherOptions: {
        runner: jest
          .fn()
          .mockResolvedValue({ ok: true, data: completeYieldCurveFixture }),
      },
      timeoutMs: 100,
    });

    const result = await gateway.execute({ asOfDate: '2026-04-25' });

    expect(result.sourceId).toBe('fixture-yield-source');
    expect(result.data).toHaveLength(8);
    expect(result.data).toContainEqual({
      date: '2026-04-25',
      country: 'CN',
      tenor: '10Y',
      yieldPercent: 2.12,
      sourceId: 'fixture-yield-source',
      sourceTime: '2026-04-25T08:30:00.000Z',
      status: 'SUCCESS',
    });
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'yield-curve',
        status: 'success',
        rowCount: 8,
      })
    );
  });

  it('marks a requested missing tenor without dropping diagnostics', () => {
    const records = normalizeYieldCurveResponse(
      missingTenorFixture,
      { asOfDate: '2026-04-25', countries: ['CN'], tenors: ['30Y'] },
      'fixture-yield-source'
    );

    expect(records).toEqual([
      expect.objectContaining({
        date: '2026-04-25',
        country: 'CN',
        tenor: '30Y',
        sourceId: 'fixture-yield-source',
        status: 'MISSING',
        errorSummary: 'Missing CN 30Y yield curve value',
      }),
    ]);
  });

  it('returns SOURCE_FAILED records when the upstream source reports failure', async () => {
    const adapter = createYieldCurveAdapter({
      sourceId: 'failing-yield-source',
      fetcher: jest
        .fn()
        .mockResolvedValue({ ok: false, error: 'upstream 503' }),
    });
    const repository = createRepository();
    const gateway = new SourceGateway({
      operation: 'yield-curve',
      adapters: [adapter],
      repository,
      timeoutMs: 100,
    });

    const result = await gateway.execute({
      asOfDate: '2026-04-25',
      countries: ['US'],
      tenors: ['10Y'],
    });

    expect(result.data).toEqual([
      {
        date: '2026-04-25',
        country: 'US',
        tenor: '10Y',
        sourceId: 'failing-yield-source',
        status: 'SOURCE_FAILED',
        errorSummary: 'upstream 503',
      },
    ]);
    expect(result.metadata).toEqual({ sourceFailed: true });
  });

  it('marks records stale when source date is older than the requested freshness window', () => {
    const records = normalizeYieldCurveResponse(
      staleYieldCurveFixture,
      {
        asOfDate: '2026-04-25',
        countries: ['US'],
        tenors: ['10Y'],
        staleAfterDays: 2,
      },
      'fixture-yield-source'
    );

    expect(records).toEqual([
      expect.objectContaining({
        date: '2026-04-20',
        country: 'US',
        tenor: '10Y',
        yieldPercent: 4.31,
        status: 'STALE',
        errorSummary: 'Stale US 10Y yield curve value from 2026-04-20',
      }),
    ]);
  });

  it('builds SOURCE_FAILED records directly for persistence fallback paths', () => {
    expect(
      normalizeYieldCurveSourceFailure(
        { asOfDate: '2026-04-25', countries: ['CN'], tenors: ['2Y'] },
        'akshare-yield-curve',
        'network error'
      )
    ).toEqual([
      {
        date: '2026-04-25',
        country: 'CN',
        tenor: '2Y',
        sourceId: 'akshare-yield-curve',
        status: 'SOURCE_FAILED',
        errorSummary: 'network error',
      },
    ]);
  });

  it('calculates 10Y-2Y, CN-US 10Y, and 7d/30d basis point changes', () => {
    expect(
      calculateTenYearTwoYearSpreadBp({
        country: 'US',
        twoYearYieldPercent: 4.79,
        tenYearYieldPercent: 4.31,
      })
    ).toBe(-48);
    expect(
      calculateCnUsTenYearSpreadBp({
        cnTenYearYieldPercent: 2.12,
        usTenYearYieldPercent: 4.31,
      })
    ).toBe(-219);
    expect(
      calculateBasisPointChanges({
        currentYieldPercent: 4.31,
        prior7dYieldPercent: 4.2,
        prior30dYieldPercent: 4.0,
      })
    ).toEqual({ change7dBp: 11, change30dBp: 31 });
  });

  it('fails closed when the production bridge dependency is missing', async () => {
    const repository = createRepository();
    const gateway = createProductionYieldCurveGateway({
      repository,
      fetcherOptions: {
        runner: jest.fn().mockResolvedValue({
          ok: false,
          errorCode: 'SOURCE_NOT_CONFIGURED',
          error: 'Python runtime dependency missing: akshare',
          retryable: false,
        }),
      },
      timeoutMs: 100,
    });

    const execution = gateway.execute({ asOfDate: '2026-04-25' });

    await expect(execution).rejects.toBeInstanceOf(SourceGatewayFailureError);
    await expect(execution).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          code: 'SOURCE_NOT_CONFIGURED',
          message: 'Python runtime dependency missing: akshare',
        }),
      ],
    });
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'yield-curve',
        status: 'failed',
        errorCode: 'SOURCE_NOT_CONFIGURED',
      })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'akshare-yield-curve',
        status: 'unhealthy',
        lastErrorCode: 'SOURCE_NOT_CONFIGURED',
      })
    );
  });
});
