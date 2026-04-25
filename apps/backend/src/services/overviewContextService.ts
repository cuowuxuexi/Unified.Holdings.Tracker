import type {
  M2DataRepository,
  MacroIndicatorSnapshotRecord,
  SourceHealthRecord,
  YieldCurveSnapshotRecord,
} from '@uht/domain';
import { PrismaM2DataRepository } from '@uht/infra';
import { prisma as defaultPrisma } from '../lib/prisma';

type NumericLike =
  | number
  | string
  | bigint
  | null
  | undefined
  | { toNumber(): number };

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

type PortfolioSnapshotRow = {
  portfolioId: string;
  date: string;
  totalMarketValue: NumericLike;
  netAssets: NumericLike;
  totalPnl: NumericLike;
  dailyPnl: NumericLike;
  cash: NumericLike;
  leverageUsed?: NumericLike;
  leverageTotal?: NumericLike;
  leverageCostRate?: NumericLike;
  leverageCumulativeCost?: NumericLike;
  realizedPnl?: NumericLike;
  unrealizedPnl?: NumericLike;
  totalCommission?: NumericLike;
  netDepositedCash?: NumericLike;
  totalDividendIncome?: NumericLike;
  totalPnlPercent?: NumericLike;
  dailyPnlPercent?: NumericLike;
  weeklyReturnPercent?: NumericLike;
  weeklyReturnValue?: NumericLike;
  weeklyBaseDate?: string | null;
  monthlyReturnPercent?: NumericLike;
  monthlyReturnValue?: NumericLike;
  monthlyBaseDate?: string | null;
  yearlyReturnPercent?: NumericLike;
  yearlyReturnValue?: NumericLike;
  yearlyBaseDate?: string | null;
  usdCny?: NumericLike;
  hkdCny?: NumericLike;
  createdAt?: Date | string | null;
};

type PositionSnapshotRow = {
  assetCode: string;
  quantity: NumericLike;
  currentPrice: NumericLike;
  marketValue: NumericLike;
  totalPnl?: NumericLike;
  dailyPnl?: NumericLike;
  dailyPct?: NumericLike;
  asset?: {
    name: string;
    market: string;
  } | null;
};

type QuoteSnapshotRow = {
  assetCode: string;
  currentPrice: NumericLike;
  changePercent?: NumericLike;
  changeAmount?: NumericLike;
  weeklyChangePercent?: NumericLike;
  monthlyChangePercent?: NumericLike;
  yearlyChangePercent?: NumericLike;
};

type ExchangeRateSnapshotRow = {
  date: string;
  pair: string;
  rate?: NumericLike;
  source?: string | null;
};

type OverviewContextPrisma = {
  portfolioSnapshot: {
    findFirst(
      args: Record<string, unknown>
    ): Promise<PortfolioSnapshotRow | null>;
  };
  positionSnapshot: {
    findMany(args: Record<string, unknown>): Promise<PositionSnapshotRow[]>;
  };
  quoteSnapshot: {
    findMany(args: Record<string, unknown>): Promise<QuoteSnapshotRow[]>;
  };
  exchangeRateSnapshot: {
    findMany(args: Record<string, unknown>): Promise<ExchangeRateSnapshotRow[]>;
  };
};

type OverviewM2Repository = Pick<
  M2DataRepository,
  'listSourceHealth' | 'listYieldCurveSnapshots' | 'listMacroIndicatorSnapshots'
>;

type OverviewContextDependencies = {
  prisma: OverviewContextPrisma;
  m2Repository: OverviewM2Repository;
  now: () => Date;
};

export type PortfolioOverviewContextRequest = {
  portfolioId: string;
  requestedDate?: string;
};

export type PortfolioOverviewContextResponse = {
  statusCode: 200 | 404;
  body: {
    data: PortfolioOverviewContextData | null;
    meta: {
      portfolioId: string;
      requested_date: string | null;
      resolved_date: string | null;
      latest_available_date: string | null;
      source: string;
      generated_at: string;
    };
    warnings: ApiWarning[];
    errors: ApiError[];
  };
};

type PortfolioOverviewContextData = {
  portfolio: Record<string, unknown>;
  fx: Record<string, unknown>;
  yield: Record<string, unknown> | null;
  market: Record<string, unknown>;
  macro: Record<string, unknown> | null;
  source_health: Record<string, unknown>;
};

const FX_PAIRS = ['USD-CNY', 'HKD-CNY'] as const;
const TOP_POSITION_LIMIT = 10;

const defaultDependencies: OverviewContextDependencies = {
  prisma: defaultPrisma as unknown as OverviewContextPrisma,
  m2Repository: new PrismaM2DataRepository(),
  now: () => new Date(),
};

export async function getPortfolioOverviewContext(
  request: PortfolioOverviewContextRequest,
  dependencies: OverviewContextDependencies = defaultDependencies
): Promise<PortfolioOverviewContextResponse> {
  const latestSnapshot = await dependencies.prisma.portfolioSnapshot.findFirst({
    where: { portfolioId: request.portfolioId },
    orderBy: { date: 'desc' },
    select: portfolioSnapshotSelect,
  });

  const resolvedSnapshot = request.requestedDate
    ? await dependencies.prisma.portfolioSnapshot.findFirst({
        where: {
          portfolioId: request.portfolioId,
          date: { lte: request.requestedDate },
        },
        orderBy: { date: 'desc' },
        select: portfolioSnapshotSelect,
      })
    : latestSnapshot;

  const baseMeta = {
    portfolioId: request.portfolioId,
    requested_date: request.requestedDate ?? null,
    resolved_date: resolvedSnapshot?.date ?? null,
    latest_available_date: latestSnapshot?.date ?? null,
    source: 'uht.overview-context',
    generated_at: dependencies.now().toISOString(),
  };

  if (!resolvedSnapshot) {
    return {
      statusCode: 404,
      body: {
        data: null,
        meta: baseMeta,
        warnings: [],
        errors: [
          {
            code: 'overview_context_not_found',
            message:
              'No portfolio snapshot can be resolved for the requested portfolio/date.',
            details: {
              portfolioId: request.portfolioId,
              requested_date: request.requestedDate ?? null,
              latest_available_date: latestSnapshot?.date ?? null,
            },
          },
        ],
      },
    };
  }

  const warnings: ApiWarning[] = [];
  if (
    request.requestedDate !== undefined &&
    request.requestedDate !== resolvedSnapshot.date
  ) {
    warnings.push({
      code: 'date_resolved_to_latest_available',
      message:
        'Requested date has no portfolio snapshot; overview-context used the latest snapshot before it.',
      details: {
        requested_date: request.requestedDate,
        resolved_date: resolvedSnapshot.date,
      },
    });
  }

  const positions = await dependencies.prisma.positionSnapshot.findMany({
    where: {
      portfolioId: request.portfolioId,
      date: resolvedSnapshot.date,
    },
    orderBy: { marketValue: 'desc' },
    select: {
      assetCode: true,
      quantity: true,
      currentPrice: true,
      marketValue: true,
      totalPnl: true,
      dailyPnl: true,
      dailyPct: true,
      asset: {
        select: {
          name: true,
          market: true,
        },
      },
    },
  });

  const assetCodes = positions.map((position) => position.assetCode);
  const [quotes, exchangeRates, yieldRecords, macroRecords, sourceHealth] =
    await Promise.all([
      assetCodes.length > 0
        ? dependencies.prisma.quoteSnapshot.findMany({
            where: {
              assetCode: { in: assetCodes },
              date: resolvedSnapshot.date,
            },
            select: {
              assetCode: true,
              currentPrice: true,
              changePercent: true,
              changeAmount: true,
              weeklyChangePercent: true,
              monthlyChangePercent: true,
              yearlyChangePercent: true,
            },
          })
        : Promise.resolve([]),
      dependencies.prisma.exchangeRateSnapshot.findMany({
        where: {
          pair: { in: [...FX_PAIRS] },
          date: { lte: resolvedSnapshot.date },
        },
        orderBy: [{ pair: 'asc' }, { date: 'asc' }],
        select: {
          date: true,
          pair: true,
          rate: true,
          source: true,
        },
      }),
      dependencies.m2Repository.listYieldCurveSnapshots({
        dateTo: resolvedSnapshot.date,
      }),
      dependencies.m2Repository.listMacroIndicatorSnapshots({
        dateTo: resolvedSnapshot.date,
      }),
      dependencies.m2Repository.listSourceHealth(),
    ]);

  if (positions.length === 0) {
    warnings.push({
      code: 'positions_missing',
      message:
        'Portfolio snapshot exists but no position snapshots were found for the resolved date.',
      details: { resolved_date: resolvedSnapshot.date },
    });
  }

  return {
    statusCode: 200,
    body: {
      data: {
        portfolio: buildPortfolioBlock(resolvedSnapshot),
        fx: buildFxBlock(resolvedSnapshot, exchangeRates, warnings),
        yield: buildYieldBlock(yieldRecords, resolvedSnapshot.date, warnings),
        market: buildMarketBlock(positions, quotes, resolvedSnapshot, warnings),
        macro: buildMacroBlock(macroRecords, resolvedSnapshot.date, warnings),
        source_health: buildSourceHealthBlock(sourceHealth, warnings),
      },
      meta: baseMeta,
      warnings,
      errors: [],
    },
  };
}

const portfolioSnapshotSelect = {
  portfolioId: true,
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
  createdAt: true,
};

function buildPortfolioBlock(snapshot: PortfolioSnapshotRow) {
  return {
    portfolioId: snapshot.portfolioId,
    date: snapshot.date,
    total_market_value: toNumber(snapshot.totalMarketValue),
    net_assets: toNumber(snapshot.netAssets),
    cash: toNumber(snapshot.cash),
    pnl: {
      daily: toNumber(snapshot.dailyPnl),
      total: toNumber(snapshot.totalPnl),
      realized: toNullableNumber(snapshot.realizedPnl),
      unrealized: toNullableNumber(snapshot.unrealizedPnl),
      total_percent: toNullableNumber(snapshot.totalPnlPercent),
      daily_percent: toNullableNumber(snapshot.dailyPnlPercent),
    },
    returns: {
      weekly: buildReturnBlock(
        snapshot.weeklyReturnPercent,
        snapshot.weeklyReturnValue,
        snapshot.weeklyBaseDate
      ),
      monthly: buildReturnBlock(
        snapshot.monthlyReturnPercent,
        snapshot.monthlyReturnValue,
        snapshot.monthlyBaseDate
      ),
      ytd: buildReturnBlock(
        snapshot.yearlyReturnPercent,
        snapshot.yearlyReturnValue,
        snapshot.yearlyBaseDate
      ),
    },
    leverage: {
      used: toNullableNumber(snapshot.leverageUsed),
      total: toNullableNumber(snapshot.leverageTotal),
      cost_rate: toNullableNumber(snapshot.leverageCostRate),
      cumulative_cost: toNullableNumber(snapshot.leverageCumulativeCost),
    },
    fees: {
      total_commission: toNullableNumber(snapshot.totalCommission),
      total_dividend_income: toNullableNumber(snapshot.totalDividendIncome),
      net_deposited_cash: toNullableNumber(snapshot.netDepositedCash),
    },
    snapshot_created_at: toIsoStringOrNull(snapshot.createdAt),
  };
}

function buildFxBlock(
  snapshot: PortfolioSnapshotRow,
  rows: ExchangeRateSnapshotRow[],
  warnings: ApiWarning[]
) {
  const rates = FX_PAIRS.map((pair) => {
    const latest = findLatestRate(rows, pair, snapshot.date);
    const fallback =
      pair === 'USD-CNY'
        ? toNullableNumber(snapshot.usdCny)
        : toNullableNumber(snapshot.hkdCny);
    const currentRate = toNullableNumber(latest?.rate) ?? fallback;

    return {
      pair,
      date: latest?.date ?? snapshot.date,
      rate: currentRate,
      source:
        latest?.source ?? (fallback === null ? null : 'PortfolioSnapshot'),
      change_7d_percent: calculateRateChange(
        currentRate,
        rows,
        pair,
        subtractDays(snapshot.date, 7)
      ),
      change_30d_percent: calculateRateChange(
        currentRate,
        rows,
        pair,
        subtractDays(snapshot.date, 30)
      ),
      change_ytd_percent: calculateRateChange(
        currentRate,
        rows,
        pair,
        `${snapshot.date.slice(0, 4)}-01-01`
      ),
    };
  });

  if (rates.some((rate) => rate.rate === null)) {
    warnings.push({
      code: 'fx_rate_missing',
      message:
        'Some FX pairs have no ExchangeRateSnapshot and no PortfolioSnapshot fallback.',
      details: {
        missing: rates
          .filter((rate) => rate.rate === null)
          .map((rate) => rate.pair),
      },
    });
  }

  if (
    rates.some(
      (rate) =>
        rate.change_7d_percent === null ||
        rate.change_30d_percent === null ||
        rate.change_ytd_percent === null
    )
  ) {
    warnings.push({
      code: 'fx_window_incomplete',
      message:
        'Some FX window changes are null because historical baseline rates are missing.',
    });
  }

  return { pairs: rates };
}

function buildMarketBlock(
  positions: PositionSnapshotRow[],
  quotes: QuoteSnapshotRow[],
  snapshot: PortfolioSnapshotRow,
  warnings: ApiWarning[]
) {
  const quoteMap = new Map(quotes.map((quote) => [quote.assetCode, quote]));
  const requested = positions.map((position) => position.assetCode);
  const found = requested.filter((assetCode) => quoteMap.has(assetCode));
  const missing = requested.filter((assetCode) => !quoteMap.has(assetCode));

  if (missing.length > 0) {
    warnings.push({
      code: 'quote_snapshot_missing',
      message:
        'Some positions do not have QuoteSnapshot records for the resolved date.',
      details: { missing },
    });
  }

  const byMarket: Record<string, number> = {};
  const byCurrency: Record<string, number> = {};
  for (const position of positions) {
    const market = position.asset?.market ?? inferMarket(position.assetCode);
    const currency = currencyForMarket(market);
    byMarket[market] = (byMarket[market] ?? 0) + toNumber(position.marketValue);
    byCurrency[currency] =
      (byCurrency[currency] ?? 0) + toNumber(position.marketValue);
  }

  const netAssets = toNumber(snapshot.netAssets);

  return {
    requested,
    found,
    missing,
    invalid: [],
    position_count: positions.length,
    quote_count: quotes.length,
    market_value_by_market: byMarket,
    fx_exposure: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, marketValue]) => [
        currency,
        {
          market_value_cny: marketValue,
          net_assets_ratio:
            netAssets > 0 ? roundNumber(marketValue / netAssets) : null,
        },
      ])
    ),
    top_positions: positions.slice(0, TOP_POSITION_LIMIT).map((position) => {
      const quote = quoteMap.get(position.assetCode);
      return {
        asset_code: position.assetCode,
        asset_name: position.asset?.name ?? position.assetCode,
        market: position.asset?.market ?? inferMarket(position.assetCode),
        quantity: toNumber(position.quantity),
        market_value: toNumber(position.marketValue),
        current_price:
          toNullableNumber(quote?.currentPrice) ??
          toNullableNumber(position.currentPrice),
        daily_pnl: toNullableNumber(position.dailyPnl),
        total_pnl: toNullableNumber(position.totalPnl),
        daily_pct: toNullableNumber(position.dailyPct),
        weekly_change_percent: toNullableNumber(quote?.weeklyChangePercent),
        monthly_change_percent: toNullableNumber(quote?.monthlyChangePercent),
        yearly_change_percent: toNullableNumber(quote?.yearlyChangePercent),
      };
    }),
  };
}

function buildYieldBlock(
  records: YieldCurveSnapshotRecord[],
  resolvedDate: string,
  warnings: ApiWarning[]
) {
  const latestRecords = latestRecordsByKey(
    records,
    (record) => `${record.country}:${record.tenor}`
  );

  if (latestRecords.length === 0) {
    warnings.push({
      code: 'yield_curve_missing',
      message:
        'No YieldCurveSnapshot records are available at or before the resolved date.',
      details: { resolved_date: resolvedDate },
    });
    return null;
  }

  const latestDate = maxDate(latestRecords.map((record) => record.date));
  if (latestDate !== resolvedDate) {
    warnings.push({
      code: 'yield_curve_stale',
      message:
        'Yield curve facts are older than the resolved portfolio snapshot date.',
      details: { resolved_date: resolvedDate, latest_yield_date: latestDate },
    });
  }

  return {
    latest_date: latestDate,
    records: latestRecords.map(serializeYieldRecord),
    spreads: {
      us_10y_2y_bp: calculateYieldSpread(latestRecords, 'US', '10Y', '2Y'),
      cn_10y_2y_bp: calculateYieldSpread(latestRecords, 'CN', '10Y', '2Y'),
      cn_us_10y_bp: calculateCrossCountrySpread(
        latestRecords,
        'CN',
        'US',
        '10Y'
      ),
    },
  };
}

function buildMacroBlock(
  records: MacroIndicatorSnapshotRecord[],
  resolvedDate: string,
  warnings: ApiWarning[]
) {
  const latestRecords = latestRecordsByKey(
    records,
    (record) => record.indicatorId
  );

  if (latestRecords.length === 0) {
    warnings.push({
      code: 'macro_indicators_missing',
      message:
        'No MacroIndicatorSnapshot records are available at or before the resolved date.',
      details: { resolved_date: resolvedDate },
    });
    return null;
  }

  const latestDate = maxDate(latestRecords.map((record) => record.date));
  if (latestDate !== resolvedDate) {
    warnings.push({
      code: 'macro_indicators_stale',
      message:
        'Macro indicator facts are older than the resolved portfolio snapshot date.',
      details: { resolved_date: resolvedDate, latest_macro_date: latestDate },
    });
  }

  return {
    latest_date: latestDate,
    records: latestRecords.map(serializeMacroRecord),
  };
}

function buildSourceHealthBlock(
  records: SourceHealthRecord[],
  warnings: ApiWarning[]
) {
  if (records.length === 0) {
    warnings.push({
      code: 'source_health_missing',
      message: 'No SourceHealth records are available.',
    });
  }

  return {
    sources: records.map((record) => ({
      sourceId: record.sourceId,
      domain: record.domain,
      status: record.status,
      checkedAt: record.checkedAt.toISOString(),
      lastSuccessAt: record.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: record.lastFailureAt?.toISOString() ?? null,
      consecutiveFailures: record.consecutiveFailures,
      latencyMs: record.latencyMs ?? null,
      errorCode: record.errorCode ?? null,
      errorMessage: record.errorMessage ?? null,
    })),
  };
}

function buildReturnBlock(
  percent: NumericLike,
  value: NumericLike,
  baseDate: string | null | undefined
) {
  return {
    percent: toNullableNumber(percent),
    value: toNullableNumber(value),
    base_date: baseDate ?? null,
  };
}

function findLatestRate(
  rows: ExchangeRateSnapshotRow[],
  pair: (typeof FX_PAIRS)[number],
  date: string
): ExchangeRateSnapshotRow | undefined {
  return rows
    .filter((row) => row.pair === pair && row.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function calculateRateChange(
  currentRate: number | null,
  rows: ExchangeRateSnapshotRow[],
  pair: (typeof FX_PAIRS)[number],
  baselineDate: string
): number | null {
  if (currentRate === null) return null;
  const baseline = findLatestRate(rows, pair, baselineDate);
  const baselineRate = toNullableNumber(baseline?.rate);
  if (!baseline || (baseline.date === baselineDate && baselineRate === null)) {
    return null;
  }
  if (baselineRate === null || baselineRate <= 0) return null;
  return roundNumber(((currentRate - baselineRate) / baselineRate) * 100);
}

function calculateYieldSpread(
  records: YieldCurveSnapshotRecord[],
  country: string,
  longTenor: string,
  shortTenor: string
): number | null {
  const long = findYield(records, country, longTenor);
  const short = findYield(records, country, shortTenor);
  if (long === null || short === null) return null;
  return roundNumber((long - short) * 100);
}

function calculateCrossCountrySpread(
  records: YieldCurveSnapshotRecord[],
  leftCountry: string,
  rightCountry: string,
  tenor: string
): number | null {
  const left = findYield(records, leftCountry, tenor);
  const right = findYield(records, rightCountry, tenor);
  if (left === null || right === null) return null;
  return roundNumber((left - right) * 100);
}

function findYield(
  records: YieldCurveSnapshotRecord[],
  country: string,
  tenor: string
): number | null {
  const record = records.find(
    (item) => item.country === country && item.tenor === tenor
  );
  if (!record || record.status !== 'SUCCESS') return null;
  return record.yieldPercent ?? null;
}

function latestRecordsByKey<T extends { date: string }>(
  records: T[],
  keyFn: (record: T) => string
): T[] {
  const map = new Map<string, T>();
  for (const record of records) {
    const key = keyFn(record);
    const existing = map.get(key);
    if (!existing || record.date > existing.date) {
      map.set(key, record);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function serializeYieldRecord(record: YieldCurveSnapshotRecord) {
  return {
    date: record.date,
    country: record.country,
    tenor: record.tenor,
    yieldPercent: record.yieldPercent ?? null,
    sourceId: record.sourceId,
    sourceTime: record.sourceTime?.toISOString() ?? null,
    status: record.status,
    errorSummary: record.errorSummary ?? null,
  };
}

function serializeMacroRecord(record: MacroIndicatorSnapshotRecord) {
  return {
    date: record.date,
    indicatorId: record.indicatorId,
    value: record.value ?? null,
    unit: record.unit ?? null,
    sourceId: record.sourceId,
    sourceTime: record.sourceTime?.toISOString() ?? null,
    status: record.status,
    errorSummary: record.errorSummary ?? null,
  };
}

function maxDate(dates: string[]): string | null {
  return dates.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function inferMarket(assetCode: string): string {
  const prefix = assetCode.slice(0, 2).toLowerCase();
  if (prefix === 'hk') return 'HK';
  if (prefix === 'us') return 'US';
  return 'CN';
}

function currencyForMarket(market: string): string {
  if (market === 'HK') return 'HKD';
  if (market === 'US') return 'USD';
  return 'CNY';
}

function subtractDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function toNumber(value: NumericLike, fallback = 0): number {
  const next = toNullableNumber(value);
  return next ?? fallback;
}

function toNullableNumber(value: NumericLike): number | null {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === 'object' && 'toNumber' in value ? value.toNumber() : value;
  const next = Number(raw);
  return Number.isFinite(next) ? next : null;
}

function roundNumber(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toIsoStringOrNull(
  value: Date | string | null | undefined
): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
