import { PrismaClient } from '@prisma/client';
import { PrismaM2DataRepository } from './prisma-m2-data.repository';

describe('PrismaM2DataRepository', () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;
  let repository: PrismaM2DataRepository;

  beforeAll(() => {
    if (!databaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for M2 repository tests');
    }

    prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });
    repository = new PrismaM2DataRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.macroIndicatorSnapshot.deleteMany();
    await prisma.yieldCurveSnapshot.deleteMany();
    await prisma.sourceHealth.deleteMany();
    await prisma.sourceRun.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('upserts successful source runs idempotently by runKey', async () => {
    const startedAt = new Date('2026-04-25T01:00:00.000Z');

    const first = await repository.upsertSourceRun({
      runKey: 'yield:akshare:2026-04-24',
      sourceId: 'akshare-cn-bond',
      domain: 'yield_curve',
      job: 'daily-yield-curve',
      targetDate: '2026-04-24',
      startedAt,
      finishedAt: new Date('2026-04-25T01:00:01.000Z'),
      status: 'SUCCESS',
      rowsWritten: 8,
      payloadHash: 'hash-v1',
    });

    const second = await repository.upsertSourceRun({
      runKey: 'yield:akshare:2026-04-24',
      sourceId: 'akshare-cn-bond',
      domain: 'yield_curve',
      job: 'daily-yield-curve',
      targetDate: '2026-04-24',
      startedAt,
      finishedAt: new Date('2026-04-25T01:00:02.000Z'),
      status: 'SUCCESS',
      rowsWritten: 9,
      payloadHash: 'hash-v2',
    });

    expect(second.id).toBe(first.id);
    expect(second.rowsWritten).toBe(9);
    expect(second.payloadHash).toBe('hash-v2');
    await expect(prisma.sourceRun.count()).resolves.toBe(1);
  });

  it('stores source failure health with error details', async () => {
    const checkedAt = new Date('2026-04-25T01:01:00.000Z');

    const health = await repository.upsertSourceHealth({
      sourceId: 'fred-macro',
      domain: 'macro',
      status: 'DOWN',
      checkedAt,
      lastFailureAt: checkedAt,
      consecutiveFailures: 2,
      latencyMs: 1500,
      errorCode: 'HTTP_503',
      errorMessage: 'service unavailable',
    });

    expect(health.status).toBe('DOWN');
    expect(health.errorCode).toBe('HTTP_503');
    expect(health.consecutiveFailures).toBe(2);
  });

  it('stores missing yield curve points and supports date/source window queries', async () => {
    await repository.upsertYieldCurveSnapshot({
      date: '2026-04-24',
      country: 'CN',
      tenor: '10Y',
      yieldPercent: 2.15,
      sourceId: 'akshare-cn-bond',
      sourceTime: new Date('2026-04-24T08:00:00.000Z'),
      status: 'SUCCESS',
    });

    await repository.upsertYieldCurveSnapshot({
      date: '2026-04-25',
      country: 'CN',
      tenor: '10Y',
      sourceId: 'akshare-cn-bond',
      status: 'MISSING',
      errorSummary: 'market holiday',
    });

    const snapshots = await repository.listYieldCurveSnapshots({
      dateFrom: '2026-04-24',
      dateTo: '2026-04-25',
      country: 'CN',
      tenors: ['10Y'],
      sourceId: 'akshare-cn-bond',
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].yieldPercent).toBeCloseTo(2.15);
    expect(snapshots[1]).toMatchObject({
      date: '2026-04-25',
      status: 'MISSING',
      errorSummary: 'market holiday',
    });
    expect(snapshots[1].yieldPercent).toBeUndefined();
  });

  it('stores source-failed macro indicators and supports indicator window queries', async () => {
    await repository.upsertMacroIndicatorSnapshot({
      date: '2026-04-24',
      indicatorId: 'US_CPI_YOY',
      value: 3.1,
      unit: 'percent',
      sourceId: 'fred-macro',
      status: 'SUCCESS',
    });

    await repository.upsertMacroIndicatorSnapshot({
      date: '2026-04-25',
      indicatorId: 'US_CPI_YOY',
      unit: 'percent',
      sourceId: 'fred-macro',
      status: 'SOURCE_FAILED',
      errorSummary: 'timeout',
    });

    const snapshots = await repository.listMacroIndicatorSnapshots({
      dateFrom: '2026-04-24',
      dateTo: '2026-04-25',
      indicatorIds: ['US_CPI_YOY'],
      sourceId: 'fred-macro',
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      date: '2026-04-24',
      value: 3.1,
      status: 'SUCCESS',
    });
    expect(snapshots[1]).toMatchObject({
      date: '2026-04-25',
      status: 'SOURCE_FAILED',
      errorSummary: 'timeout',
    });
    expect(snapshots[1].value).toBeUndefined();
  });
});
