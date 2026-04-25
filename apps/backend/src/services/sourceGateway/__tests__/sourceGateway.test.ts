import {
  SourceGatewayRepository,
  SourceRunRecordInput,
} from '@uht/domain/repositories';
import {
  SourceAdapter,
  SourceGateway,
  SourceGatewayFailureError,
  SourceResult,
} from '..';

type Request = { code: string };
type DataRow = { code: string; value: number };

type MockRepository = jest.Mocked<SourceGatewayRepository>;

function createRepository(): MockRepository {
  return {
    recordSourceRun: jest.fn().mockResolvedValue(undefined),
    upsertSourceHealth: jest.fn().mockResolvedValue(undefined),
  };
}

function adapter(
  id: string,
  fetch: jest.Mock<
    Promise<SourceResult<DataRow[]>>,
    [Request, Parameters<SourceAdapter<Request, DataRow[]>['fetch']>[1]]
  >
): SourceAdapter<Request, DataRow[]> {
  return { id, fetch };
}

describe('SourceGateway', () => {
  it('uses the primary source and records successful run and health', async () => {
    const repository = createRepository();
    const primary = adapter(
      'primary',
      jest.fn().mockResolvedValue({
        ok: true,
        data: [{ code: 'CNY', value: 1 }],
        metadata: { batchId: 'b1' },
      })
    );
    const fallback = adapter(
      'fallback',
      jest
        .fn()
        .mockResolvedValue({ ok: true, data: [{ code: 'USD', value: 7.2 }] })
    );

    const gateway = new SourceGateway<Request, DataRow[]>({
      operation: 'fx-rates',
      adapters: [primary, fallback],
      repository,
      timeoutMs: 100,
    });

    const result = await gateway.execute({ code: 'CNY' });

    expect(result.sourceId).toBe('primary');
    expect(result.data).toEqual([{ code: 'CNY', value: 1 }]);
    expect(result.attempts).toHaveLength(1);
    expect(primary.fetch).toHaveBeenCalledTimes(1);
    expect(fallback.fetch).not.toHaveBeenCalled();
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'primary',
        operation: 'fx-rates',
        status: 'success',
        attempt: 1,
        rowCount: 1,
      })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'primary', status: 'healthy' })
    );
  });

  it('normalizes timeouts and records failed run and degraded health', async () => {
    const repository = createRepository();
    const primary = adapter(
      'slow-source',
      jest.fn(
        (_request: Request, _context) =>
          new Promise<SourceResult<DataRow[]>>((resolve) => {
            setTimeout(() => {
              resolve({ ok: true, data: [{ code: 'late', value: 1 }] });
            }, 50);
          })
      )
    );

    const gateway = new SourceGateway<Request, DataRow[]>({
      operation: 'quotes',
      adapters: [primary],
      repository,
      timeoutMs: 5,
      retryPolicy: { maxAttempts: 1 },
    });

    await expect(gateway.execute({ code: 'sh600519' })).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          code: 'SOURCE_TIMEOUT',
          sourceId: 'slow-source',
        }),
      ],
    });
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'slow-source',
        status: 'failed',
        errorCode: 'SOURCE_TIMEOUT',
      })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'slow-source',
        status: 'degraded',
        lastErrorCode: 'SOURCE_TIMEOUT',
      })
    );
  });

  it('treats empty data as a source error and falls back to the next source', async () => {
    const repository = createRepository();
    const emptyPrimary = adapter(
      'empty-primary',
      jest.fn().mockResolvedValue({ ok: true, data: [] })
    );
    const fallback = adapter(
      'fallback',
      jest
        .fn()
        .mockResolvedValue({ ok: true, data: [{ code: 'GDP', value: 5 }] })
    );

    const gateway = new SourceGateway<Request, DataRow[]>({
      operation: 'macro-indicator',
      adapters: [emptyPrimary, fallback],
      repository,
      timeoutMs: 100,
    });

    const result = await gateway.execute({ code: 'GDP' });

    expect(result.sourceId).toBe('fallback');
    expect(result.attempts).toEqual([
      expect.objectContaining({
        sourceId: 'empty-primary',
        error: expect.objectContaining({ code: 'SOURCE_EMPTY_DATA' }),
      }),
      expect.objectContaining({ sourceId: 'fallback', attempt: 1 }),
    ]);
    expect(repository.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'empty-primary',
        status: 'failed',
        errorCode: 'SOURCE_EMPTY_DATA',
      })
    );
  });

  it('normalizes non-200 and source failure responses when all sources fail', async () => {
    const repository = createRepository();
    const httpFailure = adapter(
      'http-source',
      jest.fn().mockResolvedValue({
        ok: true,
        statusCode: 503,
        data: [{ code: 'US10Y', value: 4.2 }],
      })
    );
    const sourceFailure = adapter(
      'failed-source',
      jest.fn().mockResolvedValue({
        ok: false,
        error: 'upstream returned invalid payload',
      })
    );

    const gateway = new SourceGateway<Request, DataRow[]>({
      operation: 'yield-curve',
      adapters: [httpFailure, sourceFailure],
      repository,
      timeoutMs: 100,
      retryPolicy: { maxAttempts: 1 },
    });

    await expect(gateway.execute({ code: 'US10Y' })).rejects.toBeInstanceOf(
      SourceGatewayFailureError
    );

    const errorCodes = repository.recordSourceRun.mock.calls.map(
      ([input]: [SourceRunRecordInput]) => input.errorCode
    );
    expect(errorCodes).toEqual(['SOURCE_HTTP_ERROR', 'SOURCE_FAILURE']);
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'http-source', status: 'degraded' })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'failed-source', status: 'degraded' })
    );
  });

  it('retries retryable failures and returns data after a later successful attempt', async () => {
    const repository = createRepository();
    const flaky = adapter(
      'flaky-source',
      jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          error: 'temporary upstream outage',
        })
        .mockResolvedValueOnce({
          ok: true,
          data: [{ code: 'USD-CNY', value: 7.2 }],
        })
    );

    const gateway = new SourceGateway<Request, DataRow[]>({
      operation: 'exchange-rate',
      adapters: [flaky],
      repository,
      timeoutMs: 100,
      retryPolicy: { maxAttempts: 2, backoffMs: 0 },
    });

    const result = await gateway.execute({ code: 'USD-CNY' });

    expect(result.sourceId).toBe('flaky-source');
    expect(flaky.fetch).toHaveBeenCalledTimes(2);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        sourceId: 'flaky-source',
        attempt: 1,
        error: expect.objectContaining({ code: 'SOURCE_FAILURE' }),
      }),
      expect.objectContaining({ sourceId: 'flaky-source', attempt: 2 }),
    ]);
    expect(repository.recordSourceRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'failed', attempt: 1 })
    );
    expect(repository.recordSourceRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'success', attempt: 2, rowCount: 1 })
    );
  });
});
