import path from 'path';
import {
  buildBackfillRunKey,
  getBackfillSourceDataExitCode,
  parseBackfillSourceDataArgs,
  runBackfillSourceData,
  type BackfillSourceDataPrisma,
} from '../backfillSourceData';

function createPrismaMock(): jest.Mocked<BackfillSourceDataPrisma> {
  const count = jest.fn().mockResolvedValue(0);
  return {
    sourceRun: {
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sourceHealth: {
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
    },
    yieldCurveSnapshot: { count, findMany: jest.fn().mockResolvedValue([]) },
    macroIndicatorSnapshot: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    exchangeRateSnapshot: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([
        {
          date: '2026-04-24',
          pair: 'USD-CNY',
          rate: 7.2,
          source: 'cache:test',
        },
      ]),
    },
    quoteSnapshot: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          date: '2026-04-24',
          assetCode: 'hk00700',
          currentPrice: 370,
          timestamp: new Date('2026-04-24T08:00:00.000Z'),
        },
      ]),
    },
    indexSnapshot: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    portfolio: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'portfolio-2026',
        name: '2026投资组合',
        snapshotEnabled: true,
      }),
    },
    positionSnapshot: {
      findMany: jest.fn().mockResolvedValue([
        { date: '2026-04-24', assetCode: 'hk00700' },
        { date: '2026-04-24', assetCode: 'hk00700' },
        { date: '2026-04-24', assetCode: 'sh600276' },
      ]),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<BackfillSourceDataPrisma>;
}

describe('backfillSourceData runner', () => {
  it('parses dry-run CLI args and defaults to fail-closed writeAttempted=false', () => {
    expect(
      parseBackfillSourceDataArgs([
        '--dry-run',
        '--portfolio-id',
        'portfolio-2026',
        '--date-from=2026-04-24',
        '--date-to',
        '2026-04-24',
        '--domains',
        'fx,market_quote,index,yield_curve,macro',
        '--max-rows',
        '64',
      ])
    ).toEqual({
      dryRun: true,
      write: false,
      portfolioId: 'portfolio-2026',
      dateFrom: '2026-04-24',
      dateTo: '2026-04-24',
      domains: ['fx', 'market_quote', 'index', 'yield_curve', 'macro'],
      maxRows: 64,
      failOnMissingConfig: false,
      allowIsolatedWrite: false,
      confirmIsolatedDb: undefined,
    });
  });

  it('builds an auditable dry-run report without changing guarded counts', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: false,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx', 'market_quote', 'index', 'yield_curve', 'macro'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: false,
      },
      {
        prisma,
        env: {},
        now: () => new Date('2026-04-26T01:00:00.000Z'),
      }
    );

    expect(report.mode).toBe('dry-run');
    expect(report.writeAttempted).toBe(false);
    expect(report.preCounts).toEqual(report.postCounts);
    expect(report.countVerification).toEqual({
      unchanged: true,
      changedTables: [],
      externalFactsUnchanged: true,
      externalFactChangedTables: [],
      auditTableChangedTables: [],
    });
    expect(report.auditWriteSummary).toEqual({
      sourceRunUpserts: 0,
      sourceHealthUpserts: 0,
    });
    expect(report.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'fx',
          runKey: 'backfill:fx:2026-04-24:global',
          targetRows: 2,
          existingRows: 1,
          missingRows: 1,
        }),
        expect.objectContaining({
          domain: 'market_quote',
          runKey: 'backfill:market_quote:2026-04-24:portfolio-2026',
          targetRows: 2,
          existingRows: 1,
          missingRows: 1,
        }),
        expect.objectContaining({
          domain: 'index',
          targetRows: 6,
          missingRows: 6,
        }),
        expect.objectContaining({
          domain: 'yield_curve',
          status: 'blocked',
          targetRows: 8,
        }),
        expect.objectContaining({
          domain: 'macro',
          status: 'blocked',
          targetRows: 4,
        }),
      ])
    );
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'yield_curve',
          code: 'not_configured',
        }),
        expect.objectContaining({ domain: 'macro', code: 'not_configured' }),
      ])
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('fails closed when --write is requested', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: false,
      },
      { prisma, env: { FRED_API_KEY: 'not-used' } }
    );

    expect(report.mode).toBe('write-rejected');
    expect(report.status).toBe('failed_closed');
    expect(report.writeAttempted).toBe(false);
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'write_not_enabled_without_isolated_gate',
        }),
      ])
    );
    expect(prisma.sourceRun.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceHealth.upsert).not.toHaveBeenCalled();
    expect(getBackfillSourceDataExitCode(report)).toBe(2);
  });

  it('can make missing config fatal only when requested', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: false,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['macro'],
        maxRows: 64,
        failOnMissingConfig: true,
        allowIsolatedWrite: false,
      },
      { prisma, env: {} }
    );

    expect(report.status).toBe('blocked');
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'not_configured', domain: 'macro' }),
        expect.objectContaining({ code: 'fail_on_missing_config' }),
      ])
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(3);
  });

  it('uses deterministic SourceRun planning keys', () => {
    expect(buildBackfillRunKey('market_quote', '2026-04-24', 'p1')).toBe(
      'backfill:market_quote:2026-04-24:p1'
    );
    expect(buildBackfillRunKey('macro', '2026-04-24')).toBe(
      'backfill:macro:2026-04-24:global'
    );
  });

  it('allows the default task scratch isolated root and writes audit tables', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx', 'yield_curve'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        confirmIsolatedDb: 'm8-2-3a-isolated-prod-copy.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/m8-2-3a-isolated-prod-copy.db',
        },
        now: () => new Date('2026-04-26T03:00:00.000Z'),
      }
    );

    expect(report.mode).toBe('isolated-write');
    expect(report.status).toBe('isolated_write_completed_with_blocks');
    expect(report.writeAttempted).toBe(true);
    expect(report.auditWriteSummary).toEqual({
      sourceRunUpserts: 2,
      sourceHealthUpserts: 2,
    });
    expect(prisma.sourceRun.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.sourceHealth.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.yieldCurveSnapshot.count).toHaveBeenCalledTimes(2);
    expect(prisma.exchangeRateSnapshot.count).toHaveBeenCalledTimes(2);
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('allows a configured server isolated root', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        confirmIsolatedDb: 'server-copy.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/root/tracker/isolated-backfill-smoke/server-copy.db',
          UHT_BACKFILL_ISOLATED_ROOT: '/root/tracker/isolated-backfill-smoke',
        },
        now: () => new Date('2026-04-26T03:30:00.000Z'),
      }
    );

    expect(report.mode).toBe('isolated-write');
    expect(report.status).toBe('isolated_write_completed');
    expect(report.writeAttempted).toBe(true);
    expect(report.auditWriteSummary).toEqual({
      sourceRunUpserts: 1,
      sourceHealthUpserts: 1,
    });
    expect(prisma.sourceRun.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.sourceHealth.upsert).toHaveBeenCalledTimes(1);
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('fails closed when DATABASE_URL is outside the configured isolated root', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        confirmIsolatedDb: 'server-copy.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL: 'file:/root/tracker/not-smoke/server-copy.db',
          UHT_BACKFILL_ISOLATED_ROOT: '/root/tracker/isolated-backfill-smoke',
        },
      }
    );

    expect(report.mode).toBe('write-rejected');
    expect(report.status).toBe('failed_closed');
    expect(report.writeAttempted).toBe(false);
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'isolated_write_database_not_under_isolated_root',
        }),
      ])
    );
    expect(prisma.sourceRun.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceHealth.upsert).not.toHaveBeenCalled();
    expect(getBackfillSourceDataExitCode(report)).toBe(2);
  });

  it('rejects isolated write when DATABASE_URL is not under the default task scratch root', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        confirmIsolatedDb: 'portfolio.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL: 'file:/app/prisma/data/portfolio.db',
        },
      }
    );

    expect(report.mode).toBe('write-rejected');
    expect(report.status).toBe('failed_closed');
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'isolated_write_production_path_rejected',
        }),
        expect.objectContaining({
          code: 'isolated_write_database_not_under_isolated_root',
        }),
      ])
    );
    expect(prisma.sourceRun.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceHealth.upsert).not.toHaveBeenCalled();
    expect(getBackfillSourceDataExitCode(report)).toBe(2);
  });

  it.each([
    '/app/prisma/data/portfolio.db',
    '/root/tracker/Unified.Holdings.Tracker-server/apps/backend/prisma/data/portfolio.db',
    '/root/tracker/Unified.Holdings.Tracker-server/prisma/data/portfolio.db',
    '/mnt/d/cxks/正在开发的项目/Unified.Holdings.Tracker/apps/backend/prisma/data/portfolio.db',
  ])(
    'fails closed for known production/default database path %s even when filename is confirmed',
    async (databasePath) => {
      const prisma = createPrismaMock();
      const report = await runBackfillSourceData(
        {
          dryRun: true,
          write: true,
          portfolioId: 'portfolio-2026',
          dateFrom: '2026-04-24',
          dateTo: '2026-04-24',
          domains: ['fx'],
          maxRows: 64,
          failOnMissingConfig: false,
          allowIsolatedWrite: true,
          confirmIsolatedDb: 'portfolio.db',
        },
        {
          prisma,
          env: {
            DATABASE_URL: `file:${databasePath}`,
            UHT_BACKFILL_ISOLATED_ROOT: path.dirname(databasePath),
          },
        }
      );

      expect(report.mode).toBe('write-rejected');
      expect(report.status).toBe('failed_closed');
      expect(report.writeAttempted).toBe(false);
      expect(report.blocked).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'isolated_write_production_path_rejected',
          }),
        ])
      );
      expect(prisma.sourceRun.upsert).not.toHaveBeenCalled();
      expect(prisma.sourceHealth.upsert).not.toHaveBeenCalled();
      expect(getBackfillSourceDataExitCode(report)).toBe(2);
    }
  );
});
