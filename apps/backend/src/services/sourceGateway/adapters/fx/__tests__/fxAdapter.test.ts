import { SourceGateway } from '../../..';
import { SourceGatewayRepository } from '@uht/domain/repositories';
import { createFxAdapter } from '../adapter';
import {
  buildFxChangeWindowRequest,
  calculateFxChangeWindow,
  normalizeFxRates,
} from '../normalizer';
import {
  duplicateDateFxPayload,
  jsonResponse,
  missingValueFxPayload,
  sourceFailureFxResponse,
  successfulFxPayload,
} from '../fixtures/fxFixtures';

function createRepository(): jest.Mocked<SourceGatewayRepository> {
  return {
    recordSourceRun: jest.fn().mockResolvedValue(undefined),
    upsertSourceHealth: jest.fn().mockResolvedValue(undefined),
  };
}

describe('fx source adapter', () => {
  it('normalizes USD/CNY and HKD/CNY success records for SourceGateway', async () => {
    const repository = createRepository();
    const adapter = createFxAdapter({
      sourceId: 'fixture-fx',
      fetcher: jest.fn().mockResolvedValue(jsonResponse(successfulFxPayload)),
    });
    const gateway = new SourceGateway({
      operation: 'fx-rates',
      adapters: [adapter],
      repository,
      timeoutMs: 100,
    });

    const result = await gateway.execute({ date: '2026-04-24' });

    expect(result.data).toEqual([
      {
        date: '2026-04-24',
        pair: 'HKD-CNY',
        rate: 0.9234,
        sourceId: 'fixture-fx',
        sourceTime: '2026-04-24T16:30:00.000Z',
        status: 'success',
      },
      {
        date: '2026-04-24',
        pair: 'USD-CNY',
        rate: 7.2468,
        sourceId: 'fixture-fx',
        sourceTime: '2026-04-24T16:30:00.000Z',
        status: 'success',
      },
    ]);
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'fixture-fx',
        operation: 'fx-rates',
        status: 'success',
        rowCount: 2,
      })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'fixture-fx', status: 'healthy' })
    );
  });

  it('emits missing_value records when a requested pair has no usable rate', () => {
    const records = normalizeFxRates(missingValueFxPayload, {
      sourceId: 'fixture-fx',
      requestedDate: '2026-04-24',
    });

    expect(records).toEqual([
      expect.objectContaining({
        pair: 'HKD-CNY',
        rate: null,
        status: 'missing_value',
        errorSummary: 'Missing HKD-CNY rate',
      }),
      expect.objectContaining({
        pair: 'USD-CNY',
        rate: 7.2468,
        status: 'success',
      }),
    ]);
  });

  it('records source failures through SourceGateway run and health semantics', async () => {
    const repository = createRepository();
    const adapter = createFxAdapter({
      sourceId: 'failing-fx',
      fetcher: jest.fn().mockResolvedValue(sourceFailureFxResponse),
    });
    const gateway = new SourceGateway({
      operation: 'fx-rates',
      adapters: [adapter],
      repository,
      timeoutMs: 100,
      retryPolicy: { maxAttempts: 1 },
    });

    await expect(gateway.execute({ date: '2026-04-24' })).rejects.toMatchObject(
      {
        errors: [
          expect.objectContaining({
            code: 'SOURCE_HTTP_ERROR',
            sourceId: 'failing-fx',
            statusCode: 503,
          }),
        ],
      }
    );
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'failing-fx',
        status: 'failed',
        errorCode: 'SOURCE_HTTP_ERROR',
      })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'failing-fx',
        status: 'degraded',
        lastErrorCode: 'SOURCE_HTTP_ERROR',
      })
    );
  });

  it('keeps one record per date and pair, preferring latest sourceTime for duplicate dates', () => {
    const records = normalizeFxRates(duplicateDateFxPayload, {
      sourceId: 'fixture-fx',
      requestedDate: '2026-04-24',
    });

    expect(records).toEqual([
      expect.objectContaining({ pair: 'HKD-CNY', rate: 0.92 }),
      expect.objectContaining({
        pair: 'USD-CNY',
        rate: 7.25,
        sourceTime: '2026-04-24T16:00:00.000Z',
      }),
    ]);
  });

  it('prepares 7d, 30d, and YTD change windows without repository coupling', () => {
    const request = buildFxChangeWindowRequest('USD-CNY', '2026-04-24');
    const result = calculateFxChangeWindow(request, [
      { date: '2026-04-24', pair: 'USD-CNY', rate: 7.2 },
      { date: '2026-04-17', pair: 'USD-CNY', rate: 7.1 },
      { date: '2026-03-25', pair: 'USD-CNY', rate: 7.0 },
      { date: '2026-01-01', pair: 'USD-CNY', rate: 7.3 },
    ]);

    expect(request.comparisonDates).toEqual({
      sevenDay: '2026-04-17',
      thirtyDay: '2026-03-25',
      ytd: '2026-01-01',
    });
    expect(result).toEqual({
      pair: 'USD-CNY',
      asOfDate: '2026-04-24',
      currentRate: 7.2,
      sevenDayChangePercent: 1.408451,
      thirtyDayChangePercent: 2.857143,
      ytdChangePercent: -1.369863,
    });
  });
});
