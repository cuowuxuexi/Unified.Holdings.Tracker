import type { M2DataRepository } from '@uht/domain';
import { PrismaM2DataRepository } from '@uht/infra';
import { prisma as defaultPrisma } from '../lib/prisma';
import {
  buildPortfolioYearHistory,
  type PortfolioYearHistoryPortfolioRow,
  type PortfolioYearHistoryPositionRow,
  type PortfolioYearHistorySnapshotRow,
  type PortfolioYearHistoryTransactionRow,
} from './history/portfolioYearHistory';
import {
  buildFxHistoryWindow,
  type ExchangeRateSnapshotLike,
} from './history/fxHistory';
import {
  buildMarketHistory,
  type IndexSnapshotLikeRow,
  type QuoteSnapshotLikeRow,
} from './history/marketHistory';
import {
  buildYieldHistory,
  type YieldCurveSnapshotLike,
} from './history/yieldHistory';
import {
  buildMacroHistory,
  type MacroIndicatorSnapshotLike,
} from './history/macroHistory';
import {
  buildSourceHealthHistory,
  type SourceHealthLikeRow,
  type SourceRunLikeRow,
} from './history/sourceHealthHistory';

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

type PortfolioHistoryContextPrisma = {
  portfolio: {
    findUnique(
      args: Record<string, unknown>
    ): Promise<PortfolioYearHistoryPortfolioRow | null>;
  };
  transaction: {
    findMany(
      args: Record<string, unknown>
    ): Promise<PortfolioYearHistoryTransactionRow[]>;
  };
  portfolioSnapshot: {
    findMany(
      args: Record<string, unknown>
    ): Promise<PortfolioYearHistorySnapshotRow[]>;
  };
  positionSnapshot: {
    findMany(
      args: Record<string, unknown>
    ): Promise<PortfolioYearHistoryPositionRow[]>;
  };
  exchangeRateSnapshot: {
    findMany(
      args: Record<string, unknown>
    ): Promise<ExchangeRateSnapshotLike[]>;
  };
  quoteSnapshot: {
    findMany(args: Record<string, unknown>): Promise<QuoteSnapshotLikeRow[]>;
  };
  indexSnapshot: {
    findMany(args: Record<string, unknown>): Promise<IndexSnapshotLikeRow[]>;
  };
  sourceRun: {
    findMany(args: Record<string, unknown>): Promise<SourceRunLikeRow[]>;
  };
};

type PortfolioHistoryContextM2Repository = Pick<
  M2DataRepository,
  'listSourceHealth' | 'listYieldCurveSnapshots' | 'listMacroIndicatorSnapshots'
>;

type PortfolioHistoryContextDependencies = {
  prisma: PortfolioHistoryContextPrisma;
  m2Repository: PortfolioHistoryContextM2Repository;
  now: () => Date;
};

export type PortfolioHistoryContextRequest = {
  portfolioId: string;
  year: number | string;
  requestedDate?: string;
  include?: string;
};

export type PortfolioHistoryContextData = {
  portfolio_year_window: ReturnType<
    typeof buildPortfolioYearHistory
  >['portfolio_year_window'];
  external_data_window: {
    start: string;
    end: string;
    first_phase_min_start: string;
  };
  portfolio: ReturnType<typeof buildPortfolioYearHistory>['portfolio'];
  fx: ReturnType<typeof buildFxHistoryWindow>;
  market: ReturnType<typeof buildMarketHistory>;
  yield: ReturnType<typeof buildYieldHistory>;
  macro: ReturnType<typeof buildMacroHistory>;
  source_health: ReturnType<typeof buildSourceHealthHistory>;
};

export type PortfolioHistoryContextResponse = {
  statusCode: 200 | 400 | 404;
  body: {
    data: PortfolioHistoryContextData | null;
    meta: {
      portfolioId: string;
      year: number | null;
      requested_date: string | null;
      resolved_date: string | null;
      latest_available_date: string | null;
      source: 'uht.history-context';
      contract_version: 'm7.v0.1';
      generated_at: string;
      tool?: string;
    };
    warnings: ApiWarning[];
    errors: ApiError[];
  };
};

const CONTRACT_SOURCE = 'uht.history-context' as const;
const CONTRACT_VERSION = 'm7.v0.1' as const;
const FIRST_PHASE_MIN_START = '2024-01-01';

const DEFAULT_DEPENDENCIES: PortfolioHistoryContextDependencies = {
  prisma: defaultPrisma as unknown as PortfolioHistoryContextPrisma,
  m2Repository: new PrismaM2DataRepository(),
  now: () => new Date(),
};

const SUPPORTED_INCLUDES = new Set([
  'portfolio',
  'positions',
  'cashflows',
  'fx',
  'market',
  'yield',
  'macro',
  'source_health',
]);

export async function getPortfolioHistoryContext(
  request: PortfolioHistoryContextRequest,
  dependencies: PortfolioHistoryContextDependencies = DEFAULT_DEPENDENCIES
): Promise<PortfolioHistoryContextResponse> {
  const parsedYear = parseHistoryContextYear(request.year);
  const parsedDate = request.requestedDate
    ? parseHistoryContextDate(request.requestedDate)
    : { ok: true as const, value: undefined };

  const invalidRequestErrors = [parsedYear, parsedDate]
    .filter((result) => !result.ok)
    .flatMap((result) => (result.ok ? [] : [result.error]));

  if (invalidRequestErrors.length > 0 || !parsedYear.ok || !parsedDate.ok) {
    return response(400, null, {
      portfolioId: request.portfolioId,
      year: parsedYear.ok ? parsedYear.value : null,
      requested_date: request.requestedDate ?? null,
      resolved_date: null,
      latest_available_date: null,
      generated_at: dependencies.now().toISOString(),
      warnings: [],
      errors: invalidRequestErrors,
    });
  }

  const year = parsedYear.value;
  const requestedDate = parsedDate.value;
  if (requestedDate && requestedDate < yearStart(year)) {
    return response(400, null, {
      portfolioId: request.portfolioId,
      year,
      requested_date: requestedDate,
      resolved_date: null,
      latest_available_date: null,
      generated_at: dependencies.now().toISOString(),
      warnings: [],
      errors: [
        {
          code: 'date_out_of_year_window',
          message:
            'Query parameter date must not be earlier than the requested natural year.',
          details: { year, date: requestedDate },
        },
      ],
    });
  }

  const portfolio = await dependencies.prisma.portfolio.findUnique({
    where: { id: request.portfolioId },
    select: { id: true, name: true, createdAt: true },
  });

  if (!portfolio) {
    return response(404, null, {
      portfolioId: request.portfolioId,
      year,
      requested_date: requestedDate ?? null,
      resolved_date: null,
      latest_available_date: null,
      generated_at: dependencies.now().toISOString(),
      warnings: [],
      errors: [
        {
          code: 'portfolio_not_found',
          message: 'No portfolio exists for the requested history context.',
          details: { portfolioId: request.portfolioId },
        },
      ],
    });
  }

  const start = yearStart(year);
  const end = yearEnd(year);
  const [portfolioSnapshots, positionSnapshots, transactions] =
    await Promise.all([
      dependencies.prisma.portfolioSnapshot.findMany({
        where: {
          portfolioId: request.portfolioId,
          date: { gte: start, lte: end },
        },
        orderBy: { date: 'asc' },
        select: portfolioSnapshotSelect,
      }),
      dependencies.prisma.positionSnapshot.findMany({
        where: {
          portfolioId: request.portfolioId,
          date: { gte: start, lte: end },
        },
        orderBy: [{ date: 'asc' }, { marketValue: 'desc' }],
        select: positionSnapshotSelect,
      }),
      dependencies.prisma.transaction.findMany({
        where: {
          portfolioId: request.portfolioId,
          date: {
            gte: dateTimeAtStart(start),
            lt: dateTimeAtStart(nextYearStart(year)),
          },
        },
        orderBy: { date: 'asc' },
        select: transactionSelect,
      }),
    ]);

  const portfolioHistory = buildPortfolioYearHistory({
    portfolio,
    year,
    requestedDate,
    transactions,
    portfolioSnapshots,
    positionSnapshots,
  });

  const requestedEnd = portfolioHistory.portfolio_year_window.requested_end;
  const externalEnd =
    portfolioHistory.portfolio_year_window.resolved_end ?? requestedEnd;
  const assetCodes = unique(
    positionSnapshots
      .filter(
        (position) => position.date >= start && position.date <= externalEnd
      )
      .map((position) => position.assetCode)
  );

  const [
    exchangeRates,
    quoteRows,
    indexRows,
    yieldRows,
    macroRows,
    runs,
    current,
  ] = await Promise.all([
    dependencies.prisma.exchangeRateSnapshot.findMany({
      where: { date: { gte: start, lte: externalEnd } },
      orderBy: [{ pair: 'asc' }, { date: 'asc' }],
      select: { date: true, pair: true, rate: true, source: true },
    }),
    assetCodes.length > 0
      ? dependencies.prisma.quoteSnapshot.findMany({
          where: {
            assetCode: { in: assetCodes },
            date: { gte: start, lte: externalEnd },
          },
          orderBy: [{ assetCode: 'asc' }, { date: 'asc' }],
          select: quoteSnapshotSelect,
        })
      : Promise.resolve([]),
    dependencies.prisma.indexSnapshot.findMany({
      where: { date: { gte: start, lte: externalEnd } },
      orderBy: [{ indexCode: 'asc' }, { date: 'asc' }],
      select: indexSnapshotSelect,
    }),
    dependencies.m2Repository.listYieldCurveSnapshots({
      dateFrom: start,
      dateTo: externalEnd,
    }),
    dependencies.m2Repository.listMacroIndicatorSnapshots({
      dateFrom: start,
      dateTo: externalEnd,
    }),
    dependencies.prisma.sourceRun.findMany({
      where: {
        OR: [
          { targetDate: { gte: start, lte: externalEnd } },
          {
            startedAt: {
              gte: dateTimeAtStart(start),
              lt: dateTimeAtStart(addDays(externalEnd, 1)),
            },
          },
        ],
      },
      orderBy: { startedAt: 'asc' },
      select: sourceRunSelect,
    }),
    dependencies.m2Repository.listSourceHealth(),
  ]);

  const fx = buildFxHistoryWindow(exchangeRates, {
    year,
    endDate: externalEnd,
  });
  const market = buildMarketHistory({
    assetCodes,
    startDate: start,
    endDate: externalEnd,
    quoteRows,
    indexRows,
  });
  const yieldHistory = buildYieldHistory({
    rows: yieldRows as YieldCurveSnapshotLike[],
    year,
    requestedEnd: externalEnd,
  });
  const macro = buildMacroHistory({
    rows: macroRows as MacroIndicatorSnapshotLike[],
    year,
    requestedDate: externalEnd,
  });
  const sourceHealth = buildSourceHealthHistory({
    year,
    requestedDate: externalEnd,
    runs,
    current: current as SourceHealthLikeRow[],
  });

  const includeWarnings = buildIncludeWarnings(request.include);
  const warnings = normalizeWarnings([
    ...portfolioHistory.warnings,
    ...fx.warnings,
    ...market.warnings,
    ...yieldHistory.warnings,
    ...macro.warnings,
    ...sourceHealth.warnings,
    ...includeWarnings,
  ]);

  return response(
    200,
    {
      portfolio_year_window: portfolioHistory.portfolio_year_window,
      external_data_window: {
        start,
        end: externalEnd,
        first_phase_min_start: FIRST_PHASE_MIN_START,
      },
      portfolio: portfolioHistory.portfolio,
      fx,
      market,
      yield: yieldHistory,
      macro,
      source_health: sourceHealth,
    },
    {
      portfolioId: request.portfolioId,
      year,
      requested_date: requestedEnd,
      resolved_date: portfolioHistory.portfolio_year_window.resolved_end,
      latest_available_date:
        portfolioHistory.portfolio_year_window.latest_available_date,
      generated_at: dependencies.now().toISOString(),
      warnings,
      errors: [],
    }
  );
}

export function parseHistoryContextYear(
  value: unknown
): { ok: true; value: number } | { ok: false; error: ApiError } {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return invalidYear(value);
  }

  const raw = String(value).trim();
  if (!/^\d{4}$/.test(raw)) return invalidYear(value);

  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    return invalidYear(value);
  }

  return { ok: true, value: year };
}

export function parseHistoryContextDate(
  value: unknown
): { ok: true; value: string } | { ok: false; error: ApiError } {
  if (typeof value !== 'string' || !isValidDateOnly(value.trim())) {
    return {
      ok: false,
      error: {
        code: 'invalid_date',
        message:
          'Query parameter date must be a real calendar date in YYYY-MM-DD format.',
        details: { date: typeof value === 'string' ? value : null },
      },
    };
  }

  return { ok: true, value: value.trim() };
}

const portfolioSnapshotSelect = {
  date: true,
  totalMarketValue: true,
  netAssets: true,
  totalPnl: true,
  dailyPnl: true,
  cash: true,
  leverageUsed: true,
  leverageTotal: true,
  leverageCostRate: true,
  leverageCumulativeCost: true,
  realizedPnl: true,
  unrealizedPnl: true,
  totalCommission: true,
  netDepositedCash: true,
  totalDividendIncome: true,
  totalPnlPercent: true,
  dailyPnlPercent: true,
  weeklyReturnPercent: true,
  weeklyReturnValue: true,
  weeklyBaseDate: true,
  monthlyReturnPercent: true,
  monthlyReturnValue: true,
  monthlyBaseDate: true,
  yearlyReturnPercent: true,
  yearlyReturnValue: true,
  yearlyBaseDate: true,
  usdCny: true,
  hkdCny: true,
};

const positionSnapshotSelect = {
  date: true,
  assetCode: true,
  quantity: true,
  currentPrice: true,
  marketValue: true,
  costPrice: true,
  totalPnl: true,
  dailyPnl: true,
  dailyPct: true,
  totalPnlPercent: true,
  floatingPnl: true,
  floatingPnlPercent: true,
  asset: { select: { name: true, market: true } },
};

const transactionSelect = {
  id: true,
  date: true,
  type: true,
  amount: true,
  quantity: true,
  price: true,
  commission: true,
  leverageUsed: true,
  currency: true,
  exchangeRate: true,
  assetCode: true,
  notes: true,
};

const quoteSnapshotSelect = {
  assetCode: true,
  date: true,
  timestamp: true,
  currentPrice: true,
  changePercent: true,
  changeAmount: true,
  prevClosePrice: true,
  weeklyChangePercent: true,
  monthlyChangePercent: true,
  yearlyChangePercent: true,
};

const indexSnapshotSelect = {
  indexCode: true,
  date: true,
  name: true,
  currentPrice: true,
  changePercent: true,
  changeAmount: true,
  weeklyChangePercent: true,
  monthlyChangePercent: true,
  yearlyChangePercent: true,
};

const sourceRunSelect = {
  id: true,
  runKey: true,
  sourceId: true,
  domain: true,
  job: true,
  targetDate: true,
  startedAt: true,
  finishedAt: true,
  status: true,
  rowsWritten: true,
  errorCode: true,
  errorMessage: true,
  payloadHash: true,
};

function response(
  statusCode: PortfolioHistoryContextResponse['statusCode'],
  data: PortfolioHistoryContextData | null,
  params: {
    portfolioId: string;
    year: number | null;
    requested_date: string | null;
    resolved_date: string | null;
    latest_available_date: string | null;
    generated_at: string;
    warnings: ApiWarning[];
    errors: ApiError[];
  }
): PortfolioHistoryContextResponse {
  return {
    statusCode,
    body: {
      data,
      meta: {
        portfolioId: params.portfolioId,
        year: params.year,
        requested_date: params.requested_date,
        resolved_date: params.resolved_date,
        latest_available_date: params.latest_available_date,
        source: CONTRACT_SOURCE,
        contract_version: CONTRACT_VERSION,
        generated_at: params.generated_at,
      },
      warnings: params.warnings,
      errors: params.errors,
    },
  };
}

function invalidYear(value: unknown): { ok: false; error: ApiError } {
  return {
    ok: false,
    error: {
      code: 'invalid_year',
      message:
        'Query parameter year is required and must be a four-digit natural year.',
      details: { year: value ?? null },
    },
  };
}

function buildIncludeWarnings(include: string | undefined): ApiWarning[] {
  if (!include) return [];
  const unsupported = include
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && !SUPPORTED_INCLUDES.has(item));

  if (unsupported.length === 0) return [];
  return [
    {
      code: 'include_unsupported',
      message:
        'Unsupported include entries were ignored; history-context returned the full v0.1 envelope.',
      details: { include: unsupported },
    },
  ];
}

function normalizeWarnings(warnings: ApiWarning[]): ApiWarning[] {
  return warnings.map((warning) => {
    switch (warning.code) {
      case 'portfolio_snapshot_missing':
        return { ...warning, code: 'portfolio_history_missing' };
      case 'position_snapshot_missing':
        return { ...warning, code: 'position_history_missing' };
      case 'resolved_end_before_requested_end':
        return { ...warning, code: 'date_resolved_to_latest_available' };
      case 'macro_indicator_missing':
      case 'macro_indicator_unavailable':
        return { ...warning, code: 'macro_indicators_missing' };
      default:
        return warning;
    }
  });
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function yearStart(year: number): string {
  return `${year}-01-01`;
}

function nextYearStart(year: number): string {
  return `${year + 1}-01-01`;
}

function yearEnd(year: number): string {
  return `${year}-12-31`;
}

function dateTimeAtStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const next = dateTimeAtStart(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
