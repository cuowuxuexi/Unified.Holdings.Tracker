import { M2DataRepository } from '@uht/domain';
import {
  persistMacroIndicatorSnapshots,
  persistYieldCurveSnapshots,
} from '../persistence';
import { createM2SourceGatewayRepository } from '../repositoryBridge';

function createRepository(): jest.Mocked<
  Pick<
    M2DataRepository,
    | 'upsertSourceRun'
    | 'upsertSourceHealth'
    | 'upsertYieldCurveSnapshot'
    | 'upsertMacroIndicatorSnapshot'
  >
> {
  return {
    upsertSourceRun: jest.fn(),
    upsertSourceHealth: jest.fn(),
    upsertYieldCurveSnapshot: jest.fn(),
    upsertMacroIndicatorSnapshot: jest.fn(),
  };
}

describe('M4.B SourceGateway integration', () => {
  it('bridges SourceGateway run and health writes into the M2 repository', async () => {
    const repository = createRepository();
    const gatewayRepository = createM2SourceGatewayRepository(
      repository as unknown as M2DataRepository
    );

    await gatewayRepository.recordSourceRun({
      runId: 'run-1',
      sourceId: 'akshare-yield-curve',
      operation: 'yield-curve',
      status: 'success',
      startedAt: '2026-04-25T01:00:00.000Z',
      endedAt: '2026-04-25T01:00:01.000Z',
      durationMs: 1000,
      attempt: 1,
      rowCount: 8,
    });
    await gatewayRepository.upsertSourceHealth({
      sourceId: 'akshare-yield-curve',
      status: 'healthy',
      checkedAt: '2026-04-25T01:00:01.000Z',
      latencyMs: 1000,
      lastSuccessAt: '2026-04-25T01:00:01.000Z',
    });

    expect(repository.upsertSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runKey: 'run-1',
        sourceId: 'akshare-yield-curve',
        domain: 'yield_curve',
        job: 'yield-curve',
        status: 'SUCCESS',
        rowsWritten: 8,
      })
    );
    expect(repository.upsertSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'akshare-yield-curve',
        domain: 'yield_curve',
        status: 'HEALTHY',
        consecutiveFailures: 0,
      })
    );
  });

  it('persists yield-curve adapter records to M2 YieldCurveSnapshot', async () => {
    const repository = createRepository();

    await persistYieldCurveSnapshots(
      repository as unknown as M2DataRepository,
      [
        {
          date: '2026-04-24',
          country: 'US',
          tenor: '10Y',
          yieldPercent: 4.31,
          sourceId: 'akshare-yield-curve',
          sourceTime: '2026-04-25T01:00:00.000Z',
          status: 'SUCCESS',
        },
      ]
    );

    expect(repository.upsertYieldCurveSnapshot).toHaveBeenCalledWith({
      date: '2026-04-24',
      country: 'US',
      tenor: '10Y',
      yieldPercent: 4.31,
      sourceId: 'akshare-yield-curve',
      sourceTime: new Date('2026-04-25T01:00:00.000Z'),
      status: 'SUCCESS',
      errorSummary: undefined,
    });
  });

  it('persists macro adapter records to M2 MacroIndicatorSnapshot', async () => {
    const repository = createRepository();

    await persistMacroIndicatorSnapshots(
      repository as unknown as M2DataRepository,
      [
        {
          date: '2026-04-24',
          indicatorId: 'DXY',
          value: 105.2,
          unit: 'index',
          sourceId: 'fred-macro',
          sourceTime: new Date('2026-04-25T01:00:00.000Z'),
          status: 'SUCCESS',
        },
      ]
    );

    expect(repository.upsertMacroIndicatorSnapshot).toHaveBeenCalledWith({
      date: '2026-04-24',
      indicatorId: 'DXY',
      value: 105.2,
      unit: 'index',
      sourceId: 'fred-macro',
      sourceTime: new Date('2026-04-25T01:00:00.000Z'),
      status: 'SUCCESS',
      errorSummary: undefined,
    });
  });
});
