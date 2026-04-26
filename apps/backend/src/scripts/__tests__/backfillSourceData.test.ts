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
    yieldCurveSnapshot: {
      count,
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    macroIndicatorSnapshot: {
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    exchangeRateSnapshot: {
      count: jest.fn().mockResolvedValue(2),
      upsert: jest.fn().mockResolvedValue({}),
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
      upsert: jest.fn().mockResolvedValue({}),
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
      upsert: jest.fn().mockResolvedValue({}),
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
      allowFactWrite: false,
      allowSourceFetch: false,
      confirmIsolatedDb: undefined,
    });
  });

  it('parses the explicit fact write and source fetch CLI flags independently from the isolated write gate', () => {
    expect(
      parseBackfillSourceDataArgs([
        '--write',
        '--allow-isolated-write',
        '--allow-fact-write',
        '--allow-source-fetch',
        '--confirm-isolated-db',
        'copy.db',
        '--portfolio-id',
        'portfolio-2026',
        '--date-from',
        '2026-04-24',
        '--date-to',
        '2026-04-24',
        '--domains',
        'fx',
      ])
    ).toEqual(
      expect.objectContaining({
        write: true,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        allowSourceFetch: true,
        confirmIsolatedDb: 'copy.db',
      })
    );
  });

  it('builds an auditable dry-run report without changing guarded counts', async () => {
    const prisma = createPrismaMock();
    const klineFetcher = jest.fn().mockResolvedValue([
      {
        date: '2026-04-24',
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 100,
      },
    ]);
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
        allowFactWrite: false,
      },
      {
        prisma,
        env: {},
        now: () => new Date('2026-04-26T01:00:00.000Z'),
        klineFetcher,
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
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: false,
        totalUpserts: 0,
        skipped: 22,
        skipReasons: { dry_run: 22 },
      })
    );
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
          status: 'planned',
          targetRows: 8,
        }),
        expect.objectContaining({
          domain: 'macro',
          status: 'planned',
          targetRows: 4,
        }),
      ])
    );
    expect(report.blocked).toEqual([]);
    expect(prisma.sourceRun.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceHealth.upsert).not.toHaveBeenCalled();
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.indexSnapshot.upsert).not.toHaveBeenCalled();
    expect(klineFetcher).not.toHaveBeenCalled();
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
        allowFactWrite: true,
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
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: false,
        totalUpserts: 0,
        skipped: 2,
        skipReasons: { write_gate_rejected: 2 },
      })
    );
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
        allowFactWrite: false,
        allowSourceFetch: true,
      },
      {
        prisma,
        env: {},
        macroProductionFetcher: jest.fn().mockResolvedValue({
          ok: false,
          sourceId: 'fred-macro',
          requestedIndicatorIds: ['DXY'],
          catalog: [],
          records: [],
          failClosed: true,
          blocked: {
            code: 'SOURCE_NOT_CONFIGURED',
            message:
              'FRED_API_KEY is not configured; macro production fetch is fail-closed.',
          },
          persisted: { attempted: false, rowsWritten: 0 },
        }),
      }
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
        allowFactWrite: false,
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
    expect(report.status).toBe('isolated_write_completed');
    expect(report.writeAttempted).toBe(true);
    expect(report.auditWriteSummary).toEqual({
      sourceRunUpserts: 2,
      sourceHealthUpserts: 2,
    });
    expect(prisma.sourceRun.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.sourceHealth.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.indexSnapshot.upsert).not.toHaveBeenCalled();
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: false,
        totalUpserts: 0,
        skipped: 10,
        skipReasons: { fact_write_flag_missing: 10 },
      })
    );
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
        allowFactWrite: false,
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

  it('upserts complete fx, market quote, and index fact targets only when the fact write flag is present', async () => {
    const prisma = createPrismaMock();
    (prisma.indexSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      {
        date: '2026-04-24',
        indexCode: 'sh000001',
        name: '上证指数',
        currentPrice: 3080,
      },
    ]);

    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx', 'market_quote', 'index'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        confirmIsolatedDb: 'fact-copy.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/fact-copy.db',
        },
        now: () => new Date('2026-04-26T04:00:00.000Z'),
      }
    );

    expect(report.mode).toBe('isolated-write');
    expect(report.status).toBe('isolated_write_completed');
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 3,
        exchangeRateSnapshotUpserts: 1,
        quoteSnapshotUpserts: 1,
        indexSnapshotUpserts: 1,
        skipped: 7,
        skipReasons: { target_missing_source_value: 7 },
      })
    );
    expect(prisma.exchangeRateSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date_pair: { date: '2026-04-24', pair: 'USD-CNY' } },
      })
    );
    expect(prisma.quoteSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetCode_date: { assetCode: 'hk00700', date: '2026-04-24' },
        },
      })
    );
    expect(prisma.indexSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date_indexCode: { date: '2026-04-24', indexCode: 'sh000001' },
        },
      })
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('allows fact-write count changes for fact tables with matching upserts', async () => {
    const prisma = createPrismaMock();
    (prisma.exchangeRateSnapshot.count as jest.Mock)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

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
        allowFactWrite: true,
        confirmIsolatedDb: 'fact-count-copy.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/fact-count-copy.db',
        },
        now: () => new Date('2026-04-26T04:05:00.000Z'),
      }
    );

    expect(report.status).toBe('isolated_write_completed');
    expect(report.countVerification.changedTables).toEqual([
      'ExchangeRateSnapshot',
    ]);
    expect(report.countVerification.externalFactChangedTables).toEqual([
      'ExchangeRateSnapshot',
    ]);
    expect(report.blocked).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'isolated_write_fact_count_changed',
        }),
      ])
    );
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 1,
        exchangeRateSnapshotUpserts: 1,
        quoteSnapshotUpserts: 0,
        indexSnapshotUpserts: 0,
      })
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('keeps the isolated write fact count guard fail-closed without --allow-fact-write', async () => {
    const prisma = createPrismaMock();
    (prisma.exchangeRateSnapshot.count as jest.Mock)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

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
        allowFactWrite: false,
        confirmIsolatedDb: 'fact-count-no-flag.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/fact-count-no-flag.db',
        },
        now: () => new Date('2026-04-26T04:10:00.000Z'),
      }
    );

    expect(report.status).toBe('blocked');
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'isolated_write_fact_count_changed',
          details: { changedTables: ['ExchangeRateSnapshot'] },
        }),
      ])
    );
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: false,
        totalUpserts: 0,
        exchangeRateSnapshotUpserts: 0,
      })
    );
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(getBackfillSourceDataExitCode(report)).toBe(4);
  });

  it('blocks fact-write count changes for external fact tables without matching upserts', async () => {
    const prisma = createPrismaMock();
    (prisma.yieldCurveSnapshot.count as jest.Mock)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    (prisma.macroIndicatorSnapshot.count as jest.Mock)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    (prisma.quoteSnapshot.count as jest.Mock)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

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
        allowFactWrite: true,
        confirmIsolatedDb: 'fact-count-unwritten.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/fact-count-unwritten.db',
        },
        now: () => new Date('2026-04-26T04:15:00.000Z'),
      }
    );

    expect(report.status).toBe('blocked');
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'isolated_write_fact_count_changed',
          details: {
            changedTables: [
              'YieldCurveSnapshot',
              'MacroIndicatorSnapshot',
              'QuoteSnapshot',
            ],
          },
        }),
      ])
    );
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 1,
        exchangeRateSnapshotUpserts: 1,
        quoteSnapshotUpserts: 0,
        indexSnapshotUpserts: 0,
      })
    );
    expect(prisma.exchangeRateSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.indexSnapshot.upsert).not.toHaveBeenCalled();
    expect(getBackfillSourceDataExitCode(report)).toBe(4);
  });

  it('skips fact upserts with warnings instead of synthesizing missing core values', async () => {
    const prisma = createPrismaMock();
    (prisma.exchangeRateSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      {
        date: '2026-04-24',
        pair: 'USD-CNY',
        rate: null,
        source: 'cache:test',
      },
    ]);
    (prisma.quoteSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      {
        date: '2026-04-24',
        assetCode: 'hk00700',
        currentPrice: null,
        timestamp: new Date('2026-04-24T08:00:00.000Z'),
      },
    ]);
    (prisma.indexSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      {
        date: '2026-04-24',
        indexCode: 'sh000001',
        name: '上证指数',
        currentPrice: null,
      },
    ]);

    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx', 'market_quote', 'index'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        confirmIsolatedDb: 'missing-values.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/missing-values.db',
        },
      }
    );

    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 0,
        skipped: 10,
        skipReasons: {
          missing_required_fact_value: 3,
          target_missing_source_value: 7,
        },
      })
    );
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.indexSnapshot.upsert).not.toHaveBeenCalled();
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'fact_write_skipped',
          domain: 'fx',
          details: expect.objectContaining({
            reason: 'missing_required_fact_value',
            missingFields: ['rate'],
          }),
        }),
        expect.objectContaining({
          code: 'fact_write_skipped',
          domain: 'market_quote',
          details: expect.objectContaining({
            reason: 'missing_required_fact_value',
            missingFields: ['currentPrice'],
          }),
        }),
        expect.objectContaining({
          code: 'fact_write_skipped',
          domain: 'index',
          details: expect.objectContaining({
            reason: 'missing_required_fact_value',
            missingFields: ['currentPrice'],
          }),
        }),
      ])
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('keeps dry-run read-only even if --allow-fact-write is provided', async () => {
    const prisma = createPrismaMock();
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: false,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['fx'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
      },
      { prisma, env: {} }
    );

    expect(report.mode).toBe('dry-run');
    expect(report.writeAttempted).toBe(false);
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: false,
        totalUpserts: 0,
        skipped: 2,
        skipReasons: { dry_run: 2 },
      })
    );
    expect(prisma.sourceRun.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceHealth.upsert).not.toHaveBeenCalled();
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.indexSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('fetches a missing market quote target from Tencent daily kline when explicitly allowed', async () => {
    const prisma = createPrismaMock();
    (prisma.positionSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      { date: '2026-04-24', assetCode: 'sh600276' },
    ]);
    const klineFetcher = jest.fn().mockResolvedValue([
      {
        date: '2026-04-24',
        open: 40,
        high: 43,
        low: 39,
        close: 42.5,
        volume: 1234,
      },
    ]);

    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['market_quote'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        allowSourceFetch: true,
        confirmIsolatedDb: 'market-kline.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/market-kline.db',
        },
        klineFetcher,
      }
    );

    expect(klineFetcher).toHaveBeenCalledWith(
      'sh600276',
      'daily',
      '2026-04-24',
      '2026-04-24',
      'qfq',
      1
    );
    expect(report.plans).toEqual([
      expect.objectContaining({
        domain: 'market_quote',
        sourceId: 'tencent.kline',
        existingRows: 1,
        missingRows: 0,
      }),
    ]);
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 1,
        quoteSnapshotUpserts: 1,
        skipped: 0,
      })
    );
    expect(prisma.quoteSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetCode_date: { assetCode: 'sh600276', date: '2026-04-24' },
        },
        create: expect.objectContaining({
          currentPrice: 42.5,
          openPrice: 40,
          highPrice: 43,
          lowPrice: 39,
          volume: 1234,
          timestamp: new Date('2026-04-24T00:00:00.000Z'),
        }),
        update: expect.objectContaining({
          currentPrice: 42.5,
          openPrice: 40,
          highPrice: 43,
          lowPrice: 39,
          volume: 1234,
          timestamp: new Date('2026-04-24T00:00:00.000Z'),
        }),
      })
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('fetches a missing index target from Tencent daily kline when explicitly allowed', async () => {
    const prisma = createPrismaMock();
    const klineFetcher = jest.fn().mockImplementation((code: string) =>
      Promise.resolve(
        code === 'sh000001'
          ? [
              {
                date: '2026-04-24',
                open: 3100,
                high: 3120,
                low: 3090,
                close: 3111.5,
                volume: 5678,
              },
            ]
          : []
      )
    );

    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['index'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        allowSourceFetch: true,
        confirmIsolatedDb: 'index-kline.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/index-kline.db',
        },
        klineFetcher,
      }
    );

    expect(klineFetcher).toHaveBeenCalledTimes(6);
    expect(klineFetcher).toHaveBeenCalledWith(
      'sh000001',
      'daily',
      '2026-04-24',
      '2026-04-24',
      'qfq',
      1
    );
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 1,
        indexSnapshotUpserts: 1,
        skipped: 5,
        skipReasons: { target_missing_source_value: 5 },
      })
    );
    expect(prisma.indexSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date_indexCode: { date: '2026-04-24', indexCode: 'sh000001' },
        },
        create: expect.objectContaining({
          name: '上证指数',
          currentPrice: 3111.5,
        }),
        update: expect.objectContaining({
          name: '上证指数',
          currentPrice: 3111.5,
        }),
      })
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('skips with warning when kline has no target-date point', async () => {
    const prisma = createPrismaMock();
    (prisma.positionSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      { date: '2026-04-24', assetCode: 'sh600276' },
    ]);
    const klineFetcher = jest.fn().mockResolvedValue([
      {
        date: '2026-04-23',
        open: 40,
        high: 43,
        low: 39,
        close: 42.5,
        volume: 1234,
      },
    ]);

    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['market_quote'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        allowSourceFetch: true,
        confirmIsolatedDb: 'market-no-date.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/market-no-date.db',
        },
        klineFetcher,
      }
    );

    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 0,
        skipped: 1,
        skipReasons: { target_missing_source_value: 1 },
      })
    );
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'market_quote',
          code: 'source_fetch_target_date_missing',
          details: expect.objectContaining({
            targetDate: '2026-04-24',
            returnedDates: ['2026-04-23'],
          }),
        }),
      ])
    );
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('hydrates missing fx targets from the Frankfurter history seam when source fetch is enabled', async () => {
    const prisma = createPrismaMock();
    (prisma.exchangeRateSnapshot.findMany as jest.Mock).mockResolvedValueOnce(
      []
    );
    const fxHistoryFetcher = jest.fn().mockResolvedValue([
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
        allowFactWrite: true,
        allowSourceFetch: true,
        confirmIsolatedDb: 'fx-no-fetch.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/fx-no-fetch.db',
        },
        fxHistoryFetcher,
      }
    );

    expect(fxHistoryFetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        pairs: ['USD-CNY', 'HKD-CNY'],
        date: '2026-04-24',
        timeoutMs: 5000,
      })
    );
    expect(report.plans).toEqual([
      expect.objectContaining({
        domain: 'fx',
        sourceId: 'frankfurter.fx.v1',
        existingRows: 2,
        missingRows: 0,
      }),
    ]);
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 2,
        exchangeRateSnapshotUpserts: 2,
        skipped: 0,
      })
    );
    expect(prisma.exchangeRateSnapshot.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not write fetched source facts without --allow-fact-write', async () => {
    const prisma = createPrismaMock();
    (prisma.positionSnapshot.findMany as jest.Mock).mockResolvedValueOnce([
      { date: '2026-04-24', assetCode: 'sh600276' },
    ]);
    const klineFetcher = jest.fn().mockResolvedValue([
      {
        date: '2026-04-24',
        open: 40,
        high: 43,
        low: 39,
        close: 42.5,
        volume: 1234,
      },
    ]);

    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['market_quote'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: false,
        allowSourceFetch: true,
        confirmIsolatedDb: 'market-no-fact-flag.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/market-no-fact-flag.db',
        },
        klineFetcher,
      }
    );

    expect(klineFetcher).toHaveBeenCalledTimes(1);
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: false,
        totalUpserts: 0,
        skipped: 1,
        skipReasons: { fact_write_flag_missing: 1 },
      })
    );
    expect(report.writeAttempted).toBe(true);
    expect(getBackfillSourceDataExitCode(report)).toBe(0);
  });

  it('keeps yield_curve and macro blocked/not_configured and outside fact writes', async () => {
    const prisma = createPrismaMock();
    const yieldCurveGateway = {
      execute: jest.fn().mockRejectedValue({
        code: 'SOURCE_NOT_CONFIGURED',
        message: 'Python runtime dependency missing: akshare',
      }),
    };
    const macroProductionFetcher = jest.fn().mockResolvedValue({
      ok: false,
      sourceId: 'fred-macro',
      requestedIndicatorIds: ['DXY', 'US_CPI', 'US_PMI', 'US_POLICY_RATE'],
      catalog: [],
      records: [],
      failClosed: true,
      blocked: {
        code: 'SOURCE_NOT_CONFIGURED',
        message:
          'FRED_API_KEY is not configured; macro production fetch is fail-closed.',
      },
      persisted: { attempted: false, rowsWritten: 0 },
    });
    const report = await runBackfillSourceData(
      {
        dryRun: true,
        write: true,
        portfolioId: 'portfolio-2026',
        dateFrom: '2026-04-24',
        dateTo: '2026-04-24',
        domains: ['yield_curve', 'macro'],
        maxRows: 64,
        failOnMissingConfig: false,
        allowIsolatedWrite: true,
        allowFactWrite: true,
        allowSourceFetch: true,
        confirmIsolatedDb: 'blocked-domains.db',
      },
      {
        prisma,
        env: {
          DATABASE_URL:
            'file:/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch/blocked-domains.db',
        },
        yieldCurveGateway,
        macroProductionFetcher,
      }
    );

    expect(report.status).toBe('isolated_write_completed_with_blocks');
    expect(report.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'yield_curve',
          code: 'not_configured',
        }),
        expect.objectContaining({ domain: 'macro', code: 'not_configured' }),
      ])
    );
    expect(report.factWriteSummary).toEqual(
      expect.objectContaining({
        enabled: true,
        totalUpserts: 0,
        skipped: 12,
        skipReasons: { plan_blocked: 12 },
      })
    );
    expect(prisma.sourceRun.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.sourceHealth.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.exchangeRateSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.quoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.indexSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.yieldCurveSnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.macroIndicatorSnapshot.upsert).not.toHaveBeenCalled();
    expect(yieldCurveGateway.execute).toHaveBeenCalledWith({
      asOfDate: '2026-04-24',
    });
    expect(macroProductionFetcher).toHaveBeenCalledWith({
      indicatorIds: ['DXY', 'US_CPI', 'US_PMI', 'US_POLICY_RATE'],
      dateFrom: '2026-01-24',
      dateTo: '2026-04-24',
      asOfDate: '2026-04-24',
    });
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
        allowFactWrite: false,
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
        allowFactWrite: false,
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
          allowFactWrite: false,
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
