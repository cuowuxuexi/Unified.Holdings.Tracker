import { fetchExchangeRatesHistory, HistoricalRateRecord } from '@uht/infra';
import {
  createFrankfurterFxAdapter,
  createFrankfurterFxFetcher,
  FRANKFURTER_FX_SOURCE_ID,
} from '../frankfurterFetcher';
import { SourceGateway } from '../../..';
import { SourceGatewayRepository } from '@uht/domain/repositories';

function createRepository(): jest.Mocked<SourceGatewayRepository> {
  return {
    recordSourceRun: jest.fn().mockResolvedValue(undefined),
    upsertSourceHealth: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Frankfurter FX history seam', () => {
  const now = () => new Date('2026-04-26T02:03:04.000Z');

  it('fetches exact-date FX history for both supported pairs using Frankfurter v1 paths', async () => {
    const client = jest
      .fn()
      .mockResolvedValueOnce({
        date: '2026-04-24',
        rates: { CNY: 7.2468 },
      })
      .mockResolvedValueOnce({
        date: '2026-04-24',
        rates: { CNY: 0.9234 },
      });

    const records = await fetchExchangeRatesHistory({
      pairs: ['USD-CNY', 'HKD-CNY'],
      date: '2026-04-24',
      client,
      now,
    });

    expect(client.mock.calls.map(([request]) => request.url)).toEqual([
      'https://api.frankfurter.dev/v1/2026-04-24?base=USD&symbols=CNY',
      'https://api.frankfurter.dev/v1/2026-04-24?base=HKD&symbols=CNY',
    ]);
    expect(records).toEqual([
      {
        date: '2026-04-24',
        pair: 'HKD-CNY',
        rate: 0.9234,
        timestamp: '2026-04-26T02:03:04.000Z',
      },
      {
        date: '2026-04-24',
        pair: 'USD-CNY',
        rate: 7.2468,
        timestamp: '2026-04-26T02:03:04.000Z',
      },
    ]);
  });

  it('flattens date-range FX history and preserves historical window parameters', async () => {
    const client = jest
      .fn()
      .mockResolvedValueOnce({
        start_date: '2026-04-23',
        end_date: '2026-04-24',
        rates: {
          '2026-04-23': { CNY: 7.21 },
          '2026-04-24': { CNY: 7.2468 },
        },
      })
      .mockResolvedValueOnce({
        start_date: '2026-04-23',
        end_date: '2026-04-24',
        rates: {
          '2026-04-23': { CNY: 0.9228 },
          '2026-04-24': { CNY: 0.9234 },
        },
      });

    const records = await fetchExchangeRatesHistory({
      pairs: ['USD-CNY', 'HKD-CNY'],
      dateFrom: '2026-04-23',
      dateTo: '2026-04-24',
      client,
      now,
    });

    expect(client.mock.calls.map(([request]) => request.url)).toEqual([
      'https://api.frankfurter.dev/v1/2026-04-23..2026-04-24?base=USD&symbols=CNY',
      'https://api.frankfurter.dev/v1/2026-04-23..2026-04-24?base=HKD&symbols=CNY',
    ]);
    expect(records).toEqual([
      {
        date: '2026-04-23',
        pair: 'HKD-CNY',
        rate: 0.9228,
        timestamp: '2026-04-26T02:03:04.000Z',
      },
      {
        date: '2026-04-23',
        pair: 'USD-CNY',
        rate: 7.21,
        timestamp: '2026-04-26T02:03:04.000Z',
      },
      {
        date: '2026-04-24',
        pair: 'HKD-CNY',
        rate: 0.9234,
        timestamp: '2026-04-26T02:03:04.000Z',
      },
      {
        date: '2026-04-24',
        pair: 'USD-CNY',
        rate: 7.2468,
        timestamp: '2026-04-26T02:03:04.000Z',
      },
    ]);
  });

  it('converts Frankfurter history rows into SourceGateway-ready FX records', async () => {
    const fetchRates = jest
      .fn<Promise<HistoricalRateRecord[]>, [unknown]>()
      .mockResolvedValue([
        {
          date: '2026-04-24',
          pair: 'USD-CNY',
          rate: 7.2468,
          timestamp: '2026-04-24T12:00:00.000Z',
        },
        {
          date: '2026-04-24',
          pair: 'HKD-CNY',
          rate: 0.9234,
          timestamp: '2026-04-24T12:00:00.000Z',
        },
      ]);

    const fetcher = createFrankfurterFxFetcher({ fetchRates });
    const controller = new AbortController();
    const response = await fetcher(
      {
        date: '2026-04-24',
        pairs: ['USD-CNY', 'HKD-CNY'],
      },
      {
        signal: controller.signal,
        timeoutMs: 4321,
      }
    );

    expect(fetchRates).toHaveBeenCalledWith({
      pairs: ['USD-CNY', 'HKD-CNY'],
      date: '2026-04-24',
      dateFrom: undefined,
      dateTo: undefined,
      signal: controller.signal,
      timeoutMs: 4321,
    });
    expect(response.ok).toBe(true);
    await expect(response.json?.()).resolves.toEqual({
      records: [
        {
          date: '2026-04-24',
          pair: 'USD-CNY',
          rate: 7.2468,
          sourceTime: '2026-04-24T12:00:00.000Z',
        },
        {
          date: '2026-04-24',
          pair: 'HKD-CNY',
          rate: 0.9234,
          sourceTime: '2026-04-24T12:00:00.000Z',
        },
      ],
    });
  });

  it('maps upstream failures to SourceGateway failure semantics', async () => {
    const repository = createRepository();
    const fetchRates = jest
      .fn<Promise<HistoricalRateRecord[]>, [unknown]>()
      .mockRejectedValue(
        Object.assign(new Error('upstream unavailable'), { statusCode: 503 })
      );
    const gateway = new SourceGateway({
      operation: 'fx-rates',
      adapters: [
        createFrankfurterFxAdapter({
          fetchRates,
        }),
      ],
      repository,
      timeoutMs: 100,
      retryPolicy: { maxAttempts: 1 },
    });

    await expect(gateway.execute({ date: '2026-04-24' })).rejects.toMatchObject(
      {
        errors: [
          expect.objectContaining({
            sourceId: FRANKFURTER_FX_SOURCE_ID,
            code: 'SOURCE_HTTP_ERROR',
            statusCode: 503,
          }),
        ],
      }
    );
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: FRANKFURTER_FX_SOURCE_ID,
        status: 'failed',
        errorCode: 'SOURCE_HTTP_ERROR',
      })
    );
  });
});
