import { Router, Request, Response, NextFunction } from 'express';
import type { M2DataRepository, SourceHealthStatus } from '@uht/domain';
import { PrismaM2DataRepository } from '@uht/infra';
import { prisma as defaultPrisma } from '../lib/prisma';
import { getPortfolioOverviewContext } from '../services/overviewContextService';
import type {
  PortfolioOverviewContextRequest,
  PortfolioOverviewContextResponse,
} from '../services/overviewContextService';

type ApiWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type AgentToolsPrisma = {
  portfolioSnapshot: {
    findFirst(
      args: Record<string, unknown>
    ): Promise<{ portfolioId: string; date: string } | null>;
  };
};

type OverviewContextGetter = (
  request: PortfolioOverviewContextRequest
) => Promise<PortfolioOverviewContextResponse>;

type AgentToolsDependencies = {
  prisma: AgentToolsPrisma;
  repository: Pick<M2DataRepository, 'listSourceHealth'>;
  getOverviewContext: OverviewContextGetter;
};

const SOURCE_HEALTH_STATUSES: SourceHealthStatus[] = [
  'HEALTHY',
  'DEGRADED',
  'DOWN',
  'UNKNOWN',
];

const TOOL_DESCRIPTORS = [
  {
    name: 'get_latest_data_date',
    path: '/api/agent-tools/latest-data-date',
    method: 'GET',
    read_only: true,
    description: 'Return the latest available PortfolioSnapshot date.',
    params: ['portfolioId?'],
  },
  {
    name: 'get_portfolio_overview_context',
    path: '/api/agent-tools/portfolio-overview-context',
    method: 'GET',
    read_only: true,
    description: 'Return the full M5 overview-context envelope data.',
    params: ['portfolioId', 'date?'],
  },
  {
    name: 'get_fx_context',
    path: '/api/agent-tools/fx-context',
    method: 'GET',
    read_only: true,
    description: 'Return only the FX block from M5 overview-context.',
    params: ['portfolioId', 'date?'],
  },
  {
    name: 'get_yield_context',
    path: '/api/agent-tools/yield-context',
    method: 'GET',
    read_only: true,
    description: 'Return only the yield block from M5 overview-context.',
    params: ['portfolioId', 'date?'],
  },
  {
    name: 'get_quote_diagnostics',
    path: '/api/agent-tools/quote-diagnostics',
    method: 'GET',
    read_only: true,
    description:
      'Return the market diagnostics block from M5 overview-context.',
    params: ['portfolioId', 'date?'],
  },
  {
    name: 'get_macro_context',
    path: '/api/agent-tools/macro-context',
    method: 'GET',
    read_only: true,
    description: 'Return only the macro block from M5 overview-context.',
    params: ['portfolioId', 'date?'],
  },
  {
    name: 'get_source_health',
    path: '/api/agent-tools/source-health',
    method: 'GET',
    read_only: true,
    description: 'Return M2 SourceHealth records with optional filters.',
    params: ['domain?', 'sourceId?', 'status?'],
  },
];

const defaultDependencies: AgentToolsDependencies = {
  prisma: defaultPrisma as unknown as AgentToolsPrisma,
  repository: new PrismaM2DataRepository(),
  getOverviewContext: getPortfolioOverviewContext,
};

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function createAgentToolsRouter(
  dependencies: AgentToolsDependencies = defaultDependencies
): Router {
  const router = Router();

  router.get(
    '/agent-tools',
    asyncHandler(async (_req: Request, res: Response): Promise<void> => {
      res.json(
        envelope(
          { tools: TOOL_DESCRIPTORS },
          { tool: 'list_agent_tools', count: TOOL_DESCRIPTORS.length }
        )
      );
    })
  );

  router.get(
    '/agent-tools/latest-data-date',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
      const portfolioId = queryString(req.query.portfolioId);
      const snapshot = await dependencies.prisma.portfolioSnapshot.findFirst({
        where: portfolioId ? { portfolioId } : {},
        orderBy: { date: 'desc' },
        select: { portfolioId: true, date: true },
      });

      if (!snapshot) {
        res.status(404).json(
          envelope(
            null,
            {
              tool: 'get_latest_data_date',
              portfolioId: portfolioId ?? null,
              latest_available_date: null,
            },
            [],
            [
              {
                code: 'latest_data_date_not_found',
                message: 'No PortfolioSnapshot records are available.',
                details: { portfolioId: portfolioId ?? null },
              },
            ]
          )
        );
        return;
      }

      res.json(
        envelope(
          {
            portfolioId: snapshot.portfolioId,
            latest_available_date: snapshot.date,
          },
          {
            tool: 'get_latest_data_date',
            portfolioId: snapshot.portfolioId,
            latest_available_date: snapshot.date,
          }
        )
      );
    })
  );

  router.get(
    '/agent-tools/portfolio-overview-context',
    overviewBlockHandler(
      dependencies,
      'get_portfolio_overview_context',
      (data) => data
    )
  );
  router.get(
    '/agent-tools/fx-context',
    overviewBlockHandler(dependencies, 'get_fx_context', (data) => ({
      fx: data.fx,
    }))
  );
  router.get(
    '/agent-tools/yield-context',
    overviewBlockHandler(dependencies, 'get_yield_context', (data) => ({
      yield: data.yield,
    }))
  );
  router.get(
    '/agent-tools/quote-diagnostics',
    overviewBlockHandler(dependencies, 'get_quote_diagnostics', (data) => ({
      market: data.market,
    }))
  );
  router.get(
    '/agent-tools/macro-context',
    overviewBlockHandler(dependencies, 'get_macro_context', (data) => ({
      macro: data.macro,
    }))
  );

  router.get(
    '/agent-tools/source-health',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
      const status = parseSourceHealthStatus(req.query.status, res);
      if (status === null) return;

      const sources = await dependencies.repository.listSourceHealth({
        domain: queryString(req.query.domain),
        sourceId: queryString(req.query.sourceId),
        status,
      });

      res.json(
        envelope(
          { sources },
          {
            tool: 'get_source_health',
            filters: {
              domain: queryString(req.query.domain) ?? null,
              sourceId: queryString(req.query.sourceId) ?? null,
              status: status ?? null,
            },
          }
        )
      );
    })
  );

  return router;
}

const defaultRouter = createAgentToolsRouter();

export default defaultRouter;

function overviewBlockHandler(
  dependencies: AgentToolsDependencies,
  tool: string,
  selectData: (
    data: NonNullable<PortfolioOverviewContextResponse['body']['data']>
  ) => Record<string, unknown>
) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const portfolioId = queryString(req.query.portfolioId);
    if (!portfolioId) {
      sendAgentToolError(res, 400, tool, [
        {
          code: 'missing_portfolio_id',
          message: 'Query parameter portfolioId is required.',
        },
      ]);
      return;
    }

    const date = queryString(req.query.date);
    if (date && !isValidDateOnly(date)) {
      sendAgentToolError(
        res,
        400,
        tool,
        [
          {
            code: 'invalid_date',
            message:
              'Query parameter date must be a real calendar date in YYYY-MM-DD format.',
            details: { date },
          },
        ],
        { portfolioId, requested_date: date }
      );
      return;
    }

    const overview = await dependencies.getOverviewContext({
      portfolioId,
      requestedDate: date,
    });

    if (!overview.body.data) {
      res.status(overview.statusCode).json(
        envelope(
          null,
          {
            ...overview.body.meta,
            tool,
            upstream_source: overview.body.meta.source,
          },
          overview.body.warnings,
          overview.body.errors
        )
      );
      return;
    }

    res.status(overview.statusCode).json(
      envelope(
        selectData(overview.body.data),
        {
          ...overview.body.meta,
          tool,
          upstream_source: overview.body.meta.source,
        },
        overview.body.warnings,
        overview.body.errors
      )
    );
  });
}

function envelope<T>(
  data: T | null,
  meta: Record<string, unknown>,
  warnings: ApiWarning[] = [],
  errors: ApiError[] = []
) {
  return {
    data,
    meta: {
      generated_at: new Date().toISOString(),
      ...meta,
      source: 'uht.agent-tools',
    },
    warnings,
    errors,
  };
}

function sendAgentToolError(
  res: Response,
  statusCode: number,
  tool: string,
  errors: ApiError[],
  meta: Record<string, unknown> = {}
): void {
  res.status(statusCode).json(envelope(null, { tool, ...meta }, [], errors));
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseSourceHealthStatus(
  value: unknown,
  res: Response
): SourceHealthStatus | undefined | null {
  const parsed = queryString(value);
  if (!parsed) return undefined;
  if (SOURCE_HEALTH_STATUSES.includes(parsed as SourceHealthStatus)) {
    return parsed as SourceHealthStatus;
  }

  sendAgentToolError(res, 400, 'get_source_health', [
    {
      code: 'invalid_status',
      message: `Query parameter status must be one of: ${SOURCE_HEALTH_STATUSES.join(', ')}`,
      details: { status: parsed },
    },
  ]);
  return null;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
