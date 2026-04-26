import fs from 'fs';
import path from 'path';
import { FX_PAIRS } from '../services/sourceGateway/adapters/fx/types';
import { MACRO_INDICATORS } from '../services/sourceGateway/adapters/macro/catalog';
import {
  YIELD_CURVE_COUNTRIES,
  YIELD_CURVE_TENORS,
} from '../services/sourceGateway/adapters/yieldCurve/types';

export const BACKFILL_SOURCE_DATA_DOMAINS = [
  'fx',
  'market_quote',
  'index',
  'yield_curve',
  'macro',
] as const;

export type BackfillSourceDataDomain =
  (typeof BACKFILL_SOURCE_DATA_DOMAINS)[number];

type CountedTable =
  | 'SourceRun'
  | 'SourceHealth'
  | 'YieldCurveSnapshot'
  | 'MacroIndicatorSnapshot'
  | 'ExchangeRateSnapshot'
  | 'QuoteSnapshot'
  | 'IndexSnapshot';

type CountMap = Record<CountedTable, number>;

type CountModel = {
  count(): Promise<number>;
};

type FindManyModel<TRow> = CountModel & {
  findMany(args: unknown): Promise<TRow[]>;
};

export type BackfillSourceDataPortfolioRow = {
  id: string;
  name?: string | null;
  snapshotEnabled?: boolean | null;
};

type ExchangeRateSnapshotRow = {
  date: string;
  pair: string;
  rate?: unknown;
  source?: string | null;
};

type QuoteSnapshotRow = {
  date: string | null;
  assetCode: string;
  currentPrice?: unknown;
  timestamp?: Date | string | null;
};

type IndexSnapshotRow = {
  date: string;
  indexCode: string;
  name?: string | null;
  currentPrice?: unknown;
};

type YieldCurveSnapshotRow = {
  date: string;
  country: string;
  tenor: string;
  sourceId: string;
  status: string;
};

type MacroIndicatorSnapshotRow = {
  date: string;
  indicatorId: string;
  sourceId: string;
  status: string;
};

type PositionSnapshotRow = {
  date: string;
  assetCode: string;
};

export type BackfillSourceDataPrisma = {
  sourceRun: CountModel;
  sourceHealth: CountModel;
  yieldCurveSnapshot: FindManyModel<YieldCurveSnapshotRow>;
  macroIndicatorSnapshot: FindManyModel<MacroIndicatorSnapshotRow>;
  exchangeRateSnapshot: FindManyModel<ExchangeRateSnapshotRow>;
  quoteSnapshot: FindManyModel<QuoteSnapshotRow>;
  indexSnapshot: FindManyModel<IndexSnapshotRow>;
  portfolio: {
    findUnique(args: unknown): Promise<BackfillSourceDataPortfolioRow | null>;
  };
  positionSnapshot: {
    findMany(args: unknown): Promise<PositionSnapshotRow[]>;
  };
  $disconnect?(): Promise<void>;
};

export type BackfillSourceDataOptions = {
  dryRun: boolean;
  write: boolean;
  portfolioId: string;
  dateFrom: string;
  dateTo: string;
  domains: BackfillSourceDataDomain[];
  maxRows: number;
  failOnMissingConfig: boolean;
};

export type BackfillSourceDataDependencies = {
  prisma: BackfillSourceDataPrisma;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

type BackfillBlockedItem = {
  domain?: BackfillSourceDataDomain;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type BackfillWarning = {
  domain?: BackfillSourceDataDomain;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type BackfillTargetStatus = 'existing' | 'missing';

type BackfillTarget = {
  status: BackfillTargetStatus;
  key: string;
  date: string;
  attributes: Record<string, unknown>;
};

export type BackfillDomainPlan = {
  domain: BackfillSourceDataDomain;
  date: string;
  scope: 'global' | 'portfolio';
  portfolioId?: string;
  runKey: string;
  sourceId: string;
  status: 'planned' | 'blocked';
  targetRows: number;
  existingRows: number;
  missingRows: number;
  targets: BackfillTarget[];
  blocked: BackfillBlockedItem[];
};

export type BackfillSourceDataReport = {
  mode: 'dry-run' | 'write-rejected';
  status:
    | 'dry_run_completed'
    | 'dry_run_completed_with_blocks'
    | 'blocked'
    | 'failed_closed';
  generatedAt: string;
  portfolioId: string;
  portfolio?: BackfillSourceDataPortfolioRow;
  dateFrom: string;
  dateTo: string;
  domains: BackfillSourceDataDomain[];
  maxRows: number;
  config: {
    fredApiKeyConfigured: boolean;
  };
  preCounts: CountMap;
  postCounts: CountMap;
  countVerification: {
    unchanged: boolean;
    changedTables: CountedTable[];
  };
  plans: BackfillDomainPlan[];
  blocked: BackfillBlockedItem[];
  warnings: BackfillWarning[];
  writeAttempted: false;
};

type ParsedCliFlag =
  | 'dry-run'
  | 'write'
  | 'portfolio-id'
  | 'date-from'
  | 'date-to'
  | 'domains'
  | 'max-rows'
  | 'fail-on-missing-config';

const COUNTED_TABLES: CountedTable[] = [
  'SourceRun',
  'SourceHealth',
  'YieldCurveSnapshot',
  'MacroIndicatorSnapshot',
  'ExchangeRateSnapshot',
  'QuoteSnapshot',
  'IndexSnapshot',
];

const INDEX_TARGETS = [
  { indexCode: 'sh000001', name: '上证指数' },
  { indexCode: 'sz399001', name: '深证成指' },
  { indexCode: 'hkHSI', name: '恒生指数' },
  { indexCode: 'usDJI', name: '道琼斯' },
  { indexCode: 'usIXIC', name: '纳斯达克' },
  { indexCode: 'usINX', name: '标普500' },
] as const;

const DEFAULT_MAX_ROWS = 256;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseBackfillSourceDataArgs(
  argv: string[]
): BackfillSourceDataOptions {
  const raw: Partial<Record<ParsedCliFlag, string | boolean>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const parsed = parseCliToken(token);
    if (parsed.value !== undefined) {
      raw[parsed.flag] = parsed.value;
      continue;
    }

    if (isBooleanCliFlag(parsed.flag)) {
      raw[parsed.flag] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${parsed.flag}`);
    }
    raw[parsed.flag] = value;
    index += 1;
  }

  const portfolioId = requireString(raw['portfolio-id'], '--portfolio-id');
  const dateFrom = requireDate(requireString(raw['date-from'], '--date-from'));
  const dateTo = requireDate(requireString(raw['date-to'], '--date-to'));
  if (dateFrom > dateTo) {
    throw new Error('--date-from must be earlier than or equal to --date-to');
  }

  const write = raw.write === true;
  const domains = parseDomains(raw.domains);
  const maxRows = parseMaxRows(raw['max-rows']);

  return {
    dryRun: true,
    write,
    portfolioId,
    dateFrom,
    dateTo,
    domains,
    maxRows,
    failOnMissingConfig: raw['fail-on-missing-config'] === true,
  };
}

export async function runBackfillSourceData(
  options: BackfillSourceDataOptions,
  dependencies: BackfillSourceDataDependencies
): Promise<BackfillSourceDataReport> {
  const now = dependencies.now ?? (() => new Date());
  const env = dependencies.env ?? process.env;
  const generatedAt = now().toISOString();
  const preCounts = await collectCounts(dependencies.prisma);
  const warnings: BackfillWarning[] = [];
  const blocked: BackfillBlockedItem[] = [];

  const portfolio = await dependencies.prisma.portfolio.findUnique({
    where: { id: options.portfolioId },
    select: { id: true, name: true, snapshotEnabled: true },
  });

  if (!portfolio) {
    blocked.push({
      code: 'portfolio_not_found',
      message: 'No portfolio exists for the requested source-data backfill.',
      details: { portfolioId: options.portfolioId },
    });
  } else if (portfolio.snapshotEnabled === false) {
    warnings.push({
      code: 'portfolio_snapshot_disabled',
      message: 'The requested portfolio has snapshotEnabled=false.',
      details: { portfolioId: options.portfolioId },
    });
  }

  if (options.write) {
    blocked.push({
      code: 'write_not_enabled_m8_2_1',
      message:
        '--write is intentionally fail-closed in M8.2.1. This runner only supports auditable dry-run planning.',
    });
  }

  const dates = enumerateDates(options.dateFrom, options.dateTo);
  const plans = portfolio
    ? await buildDomainPlans(options, dates, dependencies, warnings, blocked)
    : [];

  const plannedRows = plans.reduce((sum, plan) => sum + plan.targetRows, 0);
  if (plannedRows > options.maxRows) {
    blocked.push({
      code: 'max_rows_exceeded',
      message: 'Planned target rows exceed --max-rows safety cap.',
      details: { plannedRows, maxRows: options.maxRows },
    });
  }

  if (
    options.failOnMissingConfig &&
    blocked.some((item) => item.code === 'not_configured')
  ) {
    blocked.push({
      code: 'fail_on_missing_config',
      message:
        '--fail-on-missing-config was set and at least one requested domain is not configured.',
    });
  }

  const postCounts = await collectCounts(dependencies.prisma);
  const changedTables = diffCounts(preCounts, postCounts);
  if (changedTables.length > 0) {
    blocked.push({
      code: 'dry_run_count_changed',
      message:
        'Dry-run verification failed: one or more guarded table counts changed.',
      details: { changedTables },
    });
  }

  const mode = options.write ? 'write-rejected' : 'dry-run';
  const status = buildReportStatus({ mode, blocked, options });

  return {
    mode,
    status,
    generatedAt,
    portfolioId: options.portfolioId,
    portfolio: portfolio ?? undefined,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    domains: options.domains,
    maxRows: options.maxRows,
    config: {
      fredApiKeyConfigured: isConfigured(env.FRED_API_KEY),
    },
    preCounts,
    postCounts,
    countVerification: {
      unchanged: changedTables.length === 0,
      changedTables,
    },
    plans,
    blocked,
    warnings,
    writeAttempted: false,
  };
}

export function getBackfillSourceDataExitCode(
  report: BackfillSourceDataReport
): number {
  if (report.mode === 'write-rejected') return 2;
  if (report.blocked.some((item) => item.code === 'dry_run_count_changed')) {
    return 4;
  }
  if (report.blocked.some((item) => item.code === 'fail_on_missing_config')) {
    return 3;
  }
  if (
    report.blocked.some((item) =>
      ['portfolio_not_found', 'max_rows_exceeded'].includes(item.code)
    )
  ) {
    return 1;
  }
  return 0;
}

async function buildDomainPlans(
  options: BackfillSourceDataOptions,
  dates: string[],
  dependencies: BackfillSourceDataDependencies,
  warnings: BackfillWarning[],
  blocked: BackfillBlockedItem[]
): Promise<BackfillDomainPlan[]> {
  const plans: BackfillDomainPlan[] = [];

  if (options.domains.includes('fx')) {
    plans.push(...(await planFx(options, dates, dependencies.prisma)));
  }

  if (options.domains.includes('market_quote')) {
    plans.push(
      ...(await planMarketQuote(options, dates, dependencies.prisma, warnings))
    );
  }

  if (options.domains.includes('index')) {
    plans.push(...(await planIndex(options, dates, dependencies.prisma)));
  }

  if (options.domains.includes('yield_curve')) {
    const domainBlocked = notConfiguredBlock(
      'yield_curve',
      'Yield curve production fetcher is not wired in M8.2.1; dry-run only audits existing/missing targets.'
    );
    blocked.push(domainBlocked);
    plans.push(
      ...(await planYieldCurve(options, dates, dependencies.prisma, [
        domainBlocked,
      ]))
    );
  }

  if (options.domains.includes('macro')) {
    const fredConfigured = isConfigured(
      (dependencies.env ?? process.env).FRED_API_KEY
    );
    if (!fredConfigured) {
      const domainBlocked = notConfiguredBlock(
        'macro',
        'FRED_API_KEY_CONFIGURED=no; macro dry-run cannot plan a real FRED fetch.'
      );
      blocked.push(domainBlocked);
      plans.push(
        ...(await planMacro(options, dates, dependencies.prisma, [
          domainBlocked,
        ]))
      );
    } else {
      plans.push(...(await planMacro(options, dates, dependencies.prisma, [])));
    }
  }

  return plans;
}

async function planFx(
  options: BackfillSourceDataOptions,
  dates: string[],
  prisma: BackfillSourceDataPrisma
): Promise<BackfillDomainPlan[]> {
  const existingRows = await prisma.exchangeRateSnapshot.findMany({
    where: {
      date: { gte: options.dateFrom, lte: options.dateTo },
      pair: { in: [...FX_PAIRS] },
    },
    orderBy: [{ date: 'asc' }, { pair: 'asc' }],
    select: { date: true, pair: true, rate: true, source: true },
  });
  const existing = new Map(
    existingRows.map((row) => [fxKey(row.date, row.pair), row])
  );

  return dates.map((date) => {
    const targets = FX_PAIRS.map((pair) => {
      const row = existing.get(fxKey(date, pair));
      return {
        status: row ? 'existing' : 'missing',
        key: fxKey(date, pair),
        date,
        attributes: {
          pair,
          rate: row ? toJsonValue(row.rate) : undefined,
          source: row?.source ?? undefined,
        },
      } satisfies BackfillTarget;
    });

    return buildPlan({
      domain: 'fx',
      date,
      scope: 'global',
      sourceId: 'exchange-rate-snapshot',
      targets,
    });
  });
}

async function planMarketQuote(
  options: BackfillSourceDataOptions,
  dates: string[],
  prisma: BackfillSourceDataPrisma,
  warnings: BackfillWarning[]
): Promise<BackfillDomainPlan[]> {
  const positionRows = await prisma.positionSnapshot.findMany({
    where: {
      portfolioId: options.portfolioId,
      date: { gte: options.dateFrom, lte: options.dateTo },
    },
    orderBy: [{ date: 'asc' }, { assetCode: 'asc' }],
    select: { date: true, assetCode: true },
  });
  const assetCodesByDate = groupAssetCodesByDate(positionRows);
  const allAssetCodes = unique(positionRows.map((row) => row.assetCode));

  if (allAssetCodes.length === 0) {
    warnings.push({
      domain: 'market_quote',
      code: 'no_position_snapshot_targets',
      message:
        'No PositionSnapshot rows were found for the requested portfolio/date window.',
      details: {
        portfolioId: options.portfolioId,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
      },
    });
  }

  const existingRows =
    allAssetCodes.length === 0
      ? []
      : await prisma.quoteSnapshot.findMany({
          where: {
            assetCode: { in: allAssetCodes },
            date: { gte: options.dateFrom, lte: options.dateTo },
          },
          orderBy: [{ date: 'asc' }, { assetCode: 'asc' }],
          select: {
            date: true,
            assetCode: true,
            currentPrice: true,
            timestamp: true,
          },
        });
  const existing = new Map(
    existingRows
      .filter((row) => row.date)
      .map((row) => [marketKey(row.date as string, row.assetCode), row])
  );

  return dates.map((date) => {
    const targets = (assetCodesByDate.get(date) ?? []).map((assetCode) => {
      const row = existing.get(marketKey(date, assetCode));
      return {
        status: row ? 'existing' : 'missing',
        key: marketKey(date, assetCode),
        date,
        attributes: {
          assetCode,
          currentPrice: row ? toJsonValue(row.currentPrice) : undefined,
          timestamp: toIsoString(row?.timestamp),
        },
      } satisfies BackfillTarget;
    });

    return buildPlan({
      domain: 'market_quote',
      date,
      scope: 'portfolio',
      portfolioId: options.portfolioId,
      sourceId: 'quote-snapshot',
      targets,
    });
  });
}

async function planIndex(
  options: BackfillSourceDataOptions,
  dates: string[],
  prisma: BackfillSourceDataPrisma
): Promise<BackfillDomainPlan[]> {
  const indexCodes = INDEX_TARGETS.map((target) => target.indexCode);
  const existingRows = await prisma.indexSnapshot.findMany({
    where: {
      date: { gte: options.dateFrom, lte: options.dateTo },
      indexCode: { in: indexCodes },
    },
    orderBy: [{ date: 'asc' }, { indexCode: 'asc' }],
    select: { date: true, indexCode: true, name: true, currentPrice: true },
  });
  const existing = new Map(
    existingRows.map((row) => [indexKey(row.date, row.indexCode), row])
  );

  return dates.map((date) => {
    const targets = INDEX_TARGETS.map((target) => {
      const row = existing.get(indexKey(date, target.indexCode));
      return {
        status: row ? 'existing' : 'missing',
        key: indexKey(date, target.indexCode),
        date,
        attributes: {
          indexCode: target.indexCode,
          name: row?.name ?? target.name,
          currentPrice: row ? toJsonValue(row.currentPrice) : undefined,
        },
      } satisfies BackfillTarget;
    });

    return buildPlan({
      domain: 'index',
      date,
      scope: 'global',
      sourceId: 'index-snapshot',
      targets,
    });
  });
}

async function planYieldCurve(
  options: BackfillSourceDataOptions,
  dates: string[],
  prisma: BackfillSourceDataPrisma,
  domainBlocked: BackfillBlockedItem[]
): Promise<BackfillDomainPlan[]> {
  const countries = [...YIELD_CURVE_COUNTRIES];
  const tenors = [...YIELD_CURVE_TENORS];
  const existingRows = await prisma.yieldCurveSnapshot.findMany({
    where: {
      date: { gte: options.dateFrom, lte: options.dateTo },
      country: { in: countries },
      tenor: { in: tenors },
    },
    orderBy: [{ date: 'asc' }, { country: 'asc' }, { tenor: 'asc' }],
    select: {
      date: true,
      country: true,
      tenor: true,
      sourceId: true,
      status: true,
    },
  });
  const existing = new Map(
    existingRows.map((row) => [
      yieldCurveKey(row.date, row.country, row.tenor),
      row,
    ])
  );

  return dates.map((date) => {
    const targets = countries.flatMap((country) =>
      tenors.map((tenor) => {
        const row = existing.get(yieldCurveKey(date, country, tenor));
        return {
          status: row ? 'existing' : 'missing',
          key: yieldCurveKey(date, country, tenor),
          date,
          attributes: {
            country,
            tenor,
            sourceId: row?.sourceId,
            status: row?.status,
          },
        } satisfies BackfillTarget;
      })
    );

    return buildPlan({
      domain: 'yield_curve',
      date,
      scope: 'global',
      sourceId: 'yield-curve-source-not-configured',
      targets,
      blocked: domainBlocked,
    });
  });
}

async function planMacro(
  options: BackfillSourceDataOptions,
  dates: string[],
  prisma: BackfillSourceDataPrisma,
  domainBlocked: BackfillBlockedItem[]
): Promise<BackfillDomainPlan[]> {
  const indicatorIds = Object.keys(MACRO_INDICATORS);
  const existingRows = await prisma.macroIndicatorSnapshot.findMany({
    where: {
      date: { gte: options.dateFrom, lte: options.dateTo },
      indicatorId: { in: indicatorIds },
    },
    orderBy: [{ date: 'asc' }, { indicatorId: 'asc' }],
    select: {
      date: true,
      indicatorId: true,
      sourceId: true,
      status: true,
    },
  });
  const existing = new Map(
    existingRows.map((row) => [macroKey(row.date, row.indicatorId), row])
  );

  return dates.map((date) => {
    const targets = indicatorIds.map((indicatorId) => {
      const row = existing.get(macroKey(date, indicatorId));
      return {
        status: row ? 'existing' : 'missing',
        key: macroKey(date, indicatorId),
        date,
        attributes: {
          indicatorId,
          sourceSeriesId:
            MACRO_INDICATORS[indicatorId as keyof typeof MACRO_INDICATORS]
              .sourceSeriesId,
          sourceId: row?.sourceId,
          status: row?.status,
        },
      } satisfies BackfillTarget;
    });

    return buildPlan({
      domain: 'macro',
      date,
      scope: 'global',
      sourceId: domainBlocked.length > 0 ? 'fred-not-configured' : 'fred-macro',
      targets,
      blocked: domainBlocked,
    });
  });
}

function buildPlan(input: {
  domain: BackfillSourceDataDomain;
  date: string;
  scope: 'global' | 'portfolio';
  portfolioId?: string;
  sourceId: string;
  targets: BackfillTarget[];
  blocked?: BackfillBlockedItem[];
}): BackfillDomainPlan {
  const blocked = input.blocked ?? [];
  const existingRows = input.targets.filter(
    (target) => target.status === 'existing'
  ).length;
  return {
    domain: input.domain,
    date: input.date,
    scope: input.scope,
    portfolioId: input.portfolioId,
    runKey: buildBackfillRunKey(
      input.domain,
      input.date,
      input.scope === 'portfolio' ? input.portfolioId : undefined
    ),
    sourceId: input.sourceId,
    status: blocked.length > 0 ? 'blocked' : 'planned',
    targetRows: input.targets.length,
    existingRows,
    missingRows: input.targets.length - existingRows,
    targets: input.targets,
    blocked,
  };
}

export function buildBackfillRunKey(
  domain: BackfillSourceDataDomain,
  date: string,
  portfolioId?: string
): string {
  return `backfill:${domain}:${date}:${portfolioId ?? 'global'}`;
}

async function collectCounts(
  prisma: BackfillSourceDataPrisma
): Promise<CountMap> {
  return {
    SourceRun: await prisma.sourceRun.count(),
    SourceHealth: await prisma.sourceHealth.count(),
    YieldCurveSnapshot: await prisma.yieldCurveSnapshot.count(),
    MacroIndicatorSnapshot: await prisma.macroIndicatorSnapshot.count(),
    ExchangeRateSnapshot: await prisma.exchangeRateSnapshot.count(),
    QuoteSnapshot: await prisma.quoteSnapshot.count(),
    IndexSnapshot: await prisma.indexSnapshot.count(),
  };
}

function diffCounts(preCounts: CountMap, postCounts: CountMap): CountedTable[] {
  return COUNTED_TABLES.filter(
    (table) => preCounts[table] !== postCounts[table]
  );
}

function buildReportStatus(input: {
  mode: BackfillSourceDataReport['mode'];
  blocked: BackfillBlockedItem[];
  options: BackfillSourceDataOptions;
}): BackfillSourceDataReport['status'] {
  if (input.mode === 'write-rejected') return 'failed_closed';

  const fatalBlockCodes = new Set([
    'portfolio_not_found',
    'max_rows_exceeded',
    'dry_run_count_changed',
    'fail_on_missing_config',
  ]);
  if (input.blocked.some((item) => fatalBlockCodes.has(item.code))) {
    return 'blocked';
  }
  if (input.blocked.length > 0) return 'dry_run_completed_with_blocks';
  return 'dry_run_completed';
}

function parseCliToken(token: string): {
  flag: ParsedCliFlag;
  value?: string;
} {
  const trimmed = token.replace(/^--/, '');
  const separatorIndex = trimmed.indexOf('=');
  const rawFlag =
    separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
  if (!isParsedCliFlag(rawFlag)) {
    throw new Error(`Unknown argument: --${rawFlag}`);
  }
  return {
    flag: rawFlag,
    value: separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : undefined,
  };
}

function isParsedCliFlag(value: string): value is ParsedCliFlag {
  return [
    'dry-run',
    'write',
    'portfolio-id',
    'date-from',
    'date-to',
    'domains',
    'max-rows',
    'fail-on-missing-config',
  ].includes(value);
}

function isBooleanCliFlag(flag: ParsedCliFlag): boolean {
  return ['dry-run', 'write', 'fail-on-missing-config'].includes(flag);
}

function requireString(
  value: string | boolean | undefined,
  flag: string
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required argument ${flag}`);
  }
  return value.trim();
}

function requireDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return value;
}

function parseDomains(
  raw: string | boolean | undefined
): BackfillSourceDataDomain[] {
  if (raw === undefined) return [...BACKFILL_SOURCE_DATA_DOMAINS];
  if (typeof raw !== 'string') {
    throw new Error('--domains must be a comma-separated string');
  }
  const domains = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (domains.length === 0) {
    throw new Error('--domains must include at least one domain');
  }

  const uniqueDomains = unique(domains);
  const invalid = uniqueDomains.filter(
    (item) =>
      !BACKFILL_SOURCE_DATA_DOMAINS.includes(item as BackfillSourceDataDomain)
  );
  if (invalid.length > 0) {
    throw new Error(`Unsupported --domains value(s): ${invalid.join(', ')}`);
  }

  return uniqueDomains as BackfillSourceDataDomain[];
}

function parseMaxRows(raw: string | boolean | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_ROWS;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error('--max-rows must be a positive integer');
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('--max-rows must be a positive integer');
  }
  return parsed;
}

function enumerateDates(dateFrom: string, dateTo: string): string[] {
  const start = new Date(`${dateFrom}T00:00:00.000Z`).getTime();
  const end = new Date(`${dateTo}T00:00:00.000Z`).getTime();
  const dates: string[] = [];
  for (let time = start; time <= end; time += MILLISECONDS_PER_DAY) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

function groupAssetCodesByDate(
  rows: PositionSnapshotRow[]
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    grouped.set(
      row.date,
      unique([...(grouped.get(row.date) ?? []), row.assetCode])
    );
  }
  return grouped;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function notConfiguredBlock(
  domain: BackfillSourceDataDomain,
  message: string
): BackfillBlockedItem {
  return {
    domain,
    code: 'not_configured',
    message,
  };
}

function isConfigured(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function fxKey(date: string, pair: string): string {
  return `${date}:${pair}`;
}

function marketKey(date: string, assetCode: string): string {
  return `${date}:${assetCode}`;
}

function indexKey(date: string, indexCode: string): string {
  return `${date}:${indexCode}`;
}

function yieldCurveKey(date: string, country: string, tenor: string): string {
  return `${date}:${country}:${tenor}`;
}

function macroKey(date: string, indicatorId: string): string {
  return `${date}:${indicatorId}`;
}

function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object' && 'toNumber' in value) {
    const maybeNumber = (value as { toNumber?: () => number }).toNumber;
    if (typeof maybeNumber === 'function') return maybeNumber.call(value);
  }
  if (typeof value === 'object' && 'toString' in value) {
    return String(value);
  }
  return value;
}

function toIsoString(
  value: Date | string | null | undefined
): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function loadDefaultDependencies(): Promise<BackfillSourceDataDependencies> {
  await import('../config/env');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: {
      db: { url: resolveSqliteDatabaseUrl(process.env.DATABASE_URL) },
    },
  });

  return {
    prisma: prisma as unknown as BackfillSourceDataPrisma,
    env: process.env,
    now: () => new Date(),
  };
}

function resolveSqliteDatabaseUrl(rawUrl: string | undefined): string {
  const fallbackUrl = 'file:./prisma/data/portfolio.db';
  const normalized = rawUrl?.trim() || fallbackUrl;
  if (!normalized.startsWith('file:')) return normalized;

  const rawPath = normalized.slice('file:'.length).trim();
  const databasePath =
    rawPath.length > 0 ? rawPath : fallbackUrl.slice('file:'.length);
  return `file:${resolveSqlitePath(databasePath)}`;
}

function resolveSqlitePath(databasePath: string): string {
  if (path.isAbsolute(databasePath)) return path.normalize(databasePath);

  const normalizedPath = databasePath.replace(/^\.\//, '');
  const repoRoot = findRepoRoot();
  const candidateBases = [
    process.cwd(),
    repoRoot,
    repoRoot ? path.join(repoRoot, 'apps', 'backend') : null,
    repoRoot ? path.join(repoRoot, 'apps', 'backend', 'prisma') : null,
  ].filter((base): base is string => Boolean(base));

  for (const base of candidateBases) {
    const candidate = path.resolve(base, normalizedPath);
    if (fs.existsSync(path.dirname(candidate))) return candidate;
  }

  return path.resolve(process.cwd(), normalizedPath);
}

function findRepoRoot(): string | null {
  const starts = [process.cwd(), __dirname];
  for (const start of starts) {
    let current = path.resolve(start);
    while (true) {
      if (
        fs.existsSync(path.join(current, 'package.json')) &&
        fs.existsSync(
          path.join(current, 'apps', 'backend', 'prisma', 'schema.prisma')
        )
      ) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return null;
}

async function main(): Promise<void> {
  const options = parseBackfillSourceDataArgs(process.argv.slice(2));
  const dependencies = await loadDefaultDependencies();
  try {
    const report = await runBackfillSourceData(options, dependencies);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = getBackfillSourceDataExitCode(report);
  } finally {
    await dependencies.prisma.$disconnect?.();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          mode: 'dry-run',
          status: 'blocked',
          errors: [
            {
              code: 'backfill_source_data_cli_error',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
          writeAttempted: false,
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 1;
  });
}
