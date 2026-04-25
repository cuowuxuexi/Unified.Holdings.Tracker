import express from 'express';
import request from 'supertest';
import { M2DataRepository } from '@uht/domain';
import { createAgentToolsRouter } from '../agentTools';

function createDependencies() {
  return {
    prisma: {
      portfolioSnapshot: {
        findFirst: jest.fn(),
      },
    },
    repository: {
      listSourceHealth: jest.fn().mockResolvedValue([]),
    },
    getOverviewContext: jest.fn(),
    getHistoryContext: jest.fn(),
  };
}

function createApp(dependencies: ReturnType<typeof createDependencies>) {
  const app = express();
  app.use(
    '/api',
    createAgentToolsRouter({
      ...dependencies,
      repository: dependencies.repository as unknown as Pick<
        M2DataRepository,
        'listSourceHealth'
      >,
    })
  );
  return app;
}

describe('M6 agent tools readonly facade', () => {
  it('lists readonly tool descriptors', async () => {
    const dependencies = createDependencies();

    const response = await request(createApp(dependencies)).get(
      '/api/agent-tools'
    );

    expect(response.status).toBe(200);
    expect(response.body.data.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'get_portfolio_overview_context',
          read_only: true,
        }),
        expect.objectContaining({
          name: 'get_portfolio_history_context',
          read_only: true,
        }),
        expect.objectContaining({
          name: 'get_source_health',
          read_only: true,
        }),
      ])
    );
  });

  it('returns the latest portfolio snapshot date', async () => {
    const dependencies = createDependencies();
    dependencies.prisma.portfolioSnapshot.findFirst.mockResolvedValue({
      portfolioId: 'p1',
      date: '2026-04-24',
    });

    const response = await request(createApp(dependencies)).get(
      '/api/agent-tools/latest-data-date?portfolioId=p1'
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      portfolioId: 'p1',
      latest_available_date: '2026-04-24',
    });
    expect(response.body.meta.tool).toBe('get_latest_data_date');
    expect(
      dependencies.prisma.portfolioSnapshot.findFirst
    ).toHaveBeenCalledWith({
      where: { portfolioId: 'p1' },
      orderBy: { date: 'desc' },
      select: { portfolioId: true, date: true },
    });
  });

  it('wraps M5 overview-context for fx context without copying aggregation', async () => {
    const dependencies = createDependencies();
    dependencies.getOverviewContext.mockResolvedValue({
      statusCode: 200,
      body: {
        data: {
          portfolio: { portfolioId: 'p1' },
          fx: { pairs: [{ pair: 'USD-CNY', rate: 7.2 }] },
          yield: null,
          market: { requested: [] },
          macro: null,
          source_health: { sources: [] },
        },
        meta: {
          portfolioId: 'p1',
          requested_date: '2026-04-25',
          resolved_date: '2026-04-24',
          latest_available_date: '2026-04-24',
          source: 'uht.overview-context',
          generated_at: '2026-04-25T10:00:00.000Z',
        },
        warnings: [
          {
            code: 'date_resolved_to_latest_available',
            message: 'resolved',
          },
        ],
        errors: [],
      },
    });

    const response = await request(createApp(dependencies)).get(
      '/api/agent-tools/fx-context?portfolioId=p1&date=2026-04-25'
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      fx: { pairs: [{ pair: 'USD-CNY', rate: 7.2 }] },
    });
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        source: 'uht.agent-tools',
        tool: 'get_fx_context',
        upstream_source: 'uht.overview-context',
        resolved_date: '2026-04-24',
      })
    );
    expect(response.body.warnings[0].code).toBe(
      'date_resolved_to_latest_available'
    );
    expect(dependencies.getOverviewContext).toHaveBeenCalledWith({
      portfolioId: 'p1',
      requestedDate: '2026-04-25',
    });
  });

  it('rejects invalid dates before calling M5 overview-context', async () => {
    const dependencies = createDependencies();

    const response = await request(createApp(dependencies)).get(
      '/api/agent-tools/yield-context?portfolioId=p1&date=2026-99-99'
    );

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe('invalid_date');
    expect(dependencies.getOverviewContext).not.toHaveBeenCalled();
  });

  it('wraps M7 history-context as a thin facade without copying aggregation', async () => {
    const dependencies = createDependencies();
    dependencies.getHistoryContext.mockResolvedValue({
      statusCode: 200,
      body: {
        data: {
          portfolio_year_window: {
            year: 2026,
            planned_start: '2026-01-01',
            effective_start: '2026-04-24',
            requested_end: '2026-04-25',
            resolved_end: '2026-04-24',
            latest_available_date: '2026-04-24',
            snapshot_days: 1,
            missing_days: [],
          },
          external_data_window: {
            start: '2026-01-01',
            end: '2026-04-24',
            first_phase_min_start: '2024-01-01',
          },
          portfolio: { series: [], cashflows: [], positions_by_date: [] },
          fx: { pairs: [] },
          market: { requested_assets: [] },
          yield: { records: [], spreads: {} },
          macro: { records: [] },
          source_health: { current: [], runs: [] },
        },
        meta: {
          portfolioId: 'p1',
          year: 2026,
          requested_date: '2026-04-25',
          resolved_date: '2026-04-24',
          latest_available_date: '2026-04-24',
          source: 'uht.history-context',
          contract_version: 'm7.v0.1',
          generated_at: '2026-04-25T10:00:00.000Z',
        },
        warnings: [],
        errors: [],
      },
    });

    const response = await request(createApp(dependencies)).get(
      '/api/agent-tools/portfolio-history-context?portfolioId=p1&year=2026&date=2026-04-25&include=portfolio,fx'
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        source: 'uht.history-context',
        contract_version: 'm7.v0.1',
        tool: 'get_portfolio_history_context',
      })
    );
    expect(dependencies.getHistoryContext).toHaveBeenCalledWith({
      portfolioId: 'p1',
      year: 2026,
      requestedDate: '2026-04-25',
      include: 'portfolio,fx',
    });
    expect(dependencies.getOverviewContext).not.toHaveBeenCalled();
  });

  it('returns source health through the readonly facade', async () => {
    const dependencies = createDependencies();
    dependencies.repository.listSourceHealth.mockResolvedValue([
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

    const response = await request(createApp(dependencies)).get(
      '/api/agent-tools/source-health?domain=macro&status=HEALTHY'
    );

    expect(response.status).toBe(200);
    expect(response.body.data.sources).toHaveLength(1);
    expect(response.body.meta.tool).toBe('get_source_health');
    expect(dependencies.repository.listSourceHealth).toHaveBeenCalledWith({
      domain: 'macro',
      sourceId: undefined,
      status: 'HEALTHY',
    });
  });
});
