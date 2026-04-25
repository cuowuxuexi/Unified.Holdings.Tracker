import express from 'express';
import request from 'supertest';
import { M2DataRepository } from '@uht/domain';
import { createSourceDataRouter } from '../sourceData';

function createRepository(): jest.Mocked<
  Pick<
    M2DataRepository,
    | 'listSourceHealth'
    | 'listYieldCurveSnapshots'
    | 'listMacroIndicatorSnapshots'
  >
> {
  return {
    listSourceHealth: jest.fn().mockResolvedValue([]),
    listYieldCurveSnapshots: jest.fn().mockResolvedValue([]),
    listMacroIndicatorSnapshots: jest.fn().mockResolvedValue([]),
  };
}

function createApp(repository: M2DataRepository) {
  const app = express();
  app.use('/api', createSourceDataRouter(repository));
  return app;
}

describe('M4.B source data readonly routes', () => {
  it('returns source health in the standard envelope', async () => {
    const repository = createRepository();
    repository.listSourceHealth.mockResolvedValue([
      {
        id: 1,
        sourceId: 'fred-macro',
        domain: 'macro',
        status: 'HEALTHY',
        checkedAt: new Date('2026-04-25T01:00:00.000Z'),
        consecutiveFailures: 0,
        createdAt: new Date('2026-04-25T01:00:00.000Z'),
        updatedAt: new Date('2026-04-25T01:00:00.000Z'),
      },
    ]);

    const response = await request(
      createApp(repository as unknown as M2DataRepository)
    ).get('/api/source-health?domain=macro&status=HEALTHY');

    expect(response.status).toBe(200);
    expect(response.body.data.sources).toHaveLength(1);
    expect(response.body.meta.source).toBe('uht.source-health');
    expect(repository.listSourceHealth).toHaveBeenCalledWith({
      domain: 'macro',
      sourceId: undefined,
      status: 'HEALTHY',
    });
  });

  it('rejects invalid source health status', async () => {
    const repository = createRepository();

    const response = await request(
      createApp(repository as unknown as M2DataRepository)
    ).get('/api/source-health?status=BROKEN');

    expect(response.status).toBe(400);
    expect(response.body.errors[0]).toMatchObject({
      code: 'invalid_status',
    });
    expect(repository.listSourceHealth).not.toHaveBeenCalled();
  });

  it('queries yield curve snapshots by exact date and tenor list', async () => {
    const repository = createRepository();

    const response = await request(
      createApp(repository as unknown as M2DataRepository)
    ).get('/api/data/yield-curve?date=2026-04-24&country=US&tenors=2Y,10Y');

    expect(response.status).toBe(200);
    expect(response.body.meta.source).toBe('uht.yield-curve');
    expect(repository.listYieldCurveSnapshots).toHaveBeenCalledWith({
      dateFrom: '2026-04-24',
      dateTo: '2026-04-24',
      country: 'US',
      tenors: ['2Y', '10Y'],
      sourceId: undefined,
      status: undefined,
    });
  });

  it('queries macro indicator snapshots by indicator list', async () => {
    const repository = createRepository();

    const response = await request(
      createApp(repository as unknown as M2DataRepository)
    ).get('/api/data/macro-indicators?indicatorIds=DXY,US_CPI&status=SUCCESS');

    expect(response.status).toBe(200);
    expect(response.body.meta.source).toBe('uht.macro-indicators');
    expect(repository.listMacroIndicatorSnapshots).toHaveBeenCalledWith({
      dateFrom: undefined,
      dateTo: undefined,
      indicatorIds: ['DXY', 'US_CPI'],
      sourceId: undefined,
      status: 'SUCCESS',
    });
  });
});
