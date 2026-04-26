import fs from 'fs';
import path from 'path';
import type { SourceGatewayRepository } from '@uht/domain/repositories';
import {
  fetchExchangeRatesHistory,
  type HistoricalRateRecord,
} from '@uht/infra';
import type { KlinePoint } from '../types';
import { SourceGatewayFailureError } from '../services/sourceGateway';
import {
  FRANKFURTER_FX_SOURCE_ID,
  FX_PAIRS,
  type FxPair,
} from '../services/sourceGateway/adapters/fx';
import {
  MACRO_INDICATORS,
  type MacroIndicatorId,
  type MacroIndicatorSnapshot,
  type MacroProductionFetchResult,
} from '../services/sourceGateway/adapters/macro';
import {
  type YieldCurveRecord,
  YIELD_CURVE_COUNTRIES,
  YIELD_CURVE_TENORS,
} from '../services/sourceGateway/adapters/yieldCurve';

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

type UpsertModel = CountModel & {
  upsert(args: unknown): Promise<unknown>;
};

type FindManyModel<TRow> = CountModel & {
  findMany(args: unknown): Promise<TRow[]>;
};

type FactSnapshotModel<TRow> = FindManyModel<TRow> & {
  upsert(args: unknown): Promise<unknown>;
};

type SourceRunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
type SourceHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
type BackfillKlinePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
type BackfillFqType = 'qfq' | 'hfq' | 'none';

export type BackfillKlineFetcher = (
  code: string,
  period: BackfillKlinePeriod,
  startDate: string | undefined,
  endDate: string | undefined,
  fq: BackfillFqType,
  count: number
) => Promise<KlinePoint[]>;

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
  openPrice?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
  volume?: unknown;
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
  yieldPercent?: unknown;
  sourceTime?: Date | string | null;
  errorSummary?: string | null;
};

type MacroIndicatorSnapshotRow = {
  date: string;
  indicatorId: string;
  sourceId: string;
  status: string;
  value?: unknown;
  unit?: string | null;
  sourceTime?: Date | string | null;
  errorSummary?: string | null;
};

type PositionSnapshotRow = {
  date: string;
  assetCode: string;
};

export type BackfillSourceDataPrisma = {
  sourceRun: UpsertModel;
  sourceHealth: UpsertModel;
  yieldCurveSnapshot: FactSnapshotModel<YieldCurveSnapshotRow>;
  macroIndicatorSnapshot: FactSnapshotModel<MacroIndicatorSnapshotRow>;
  exchangeRateSnapshot: FactSnapshotModel<ExchangeRateSnapshotRow>;
  quoteSnapshot: FactSnapshotModel<QuoteSnapshotRow>;
  indexSnapshot: FactSnapshotModel<IndexSnapshotRow>;
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
  allowIsolatedWrite: boolean;
  allowFactWrite: boolean;
  allowSourceFetch?: boolean;
  confirmIsolatedDb?: string;
};

export type BackfillSourceDataDependencies = {
  prisma: BackfillSourceDataPrisma;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  klineFetcher?: BackfillKlineFetcher;
  fxHistoryFetcher?: BackfillFxHistoryFetcher;
  yieldCurveGateway?: BackfillYieldCurveGateway;
  macroProductionFetcher?: BackfillMacroProductionFetcher;
};

export type BackfillSourceDataCliIo = {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
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

type BackfillTargetStatus = 'existing' | 'missing' | 'fetched';

type BackfillTarget = {
  status: BackfillTargetStatus;
  key: string;
  date: string;
  attributes: Record<string, unknown>;
};

type BackfillFactWriteSkip = {
  domain: BackfillSourceDataDomain;
  key: string;
  reason: string;
  message: string;
  details?: Record<string, unknown>;
};

type BackfillFactWriteSummary = {
  enabled: boolean;
  totalUpserts: number;
  exchangeRateSnapshotUpserts: number;
  quoteSnapshotUpserts: number;
  indexSnapshotUpserts: number;
  yieldCurveSnapshotUpserts: number;
  macroIndicatorSnapshotUpserts: number;
  skipped: number;
  skipReasons: Record<string, number>;
  skips: BackfillFactWriteSkip[];
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
  mode: 'dry-run' | 'write-rejected' | 'isolated-write';
  status:
    | 'dry_run_completed'
    | 'dry_run_completed_with_blocks'
    | 'isolated_write_completed'
    | 'isolated_write_completed_with_blocks'
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
    sourceFetchEnabled: boolean;
  };
  preCounts: CountMap;
  postCounts: CountMap;
  countVerification: {
    unchanged: boolean;
    changedTables: CountedTable[];
    externalFactsUnchanged: boolean;
    externalFactChangedTables: CountedTable[];
    auditTableChangedTables: CountedTable[];
  };
  auditWriteSummary: {
    sourceRunUpserts: number;
    sourceHealthUpserts: number;
  };
  factWriteSummary: BackfillFactWriteSummary;
  plans: BackfillDomainPlan[];
  blocked: BackfillBlockedItem[];
  warnings: BackfillWarning[];
  writeAttempted: boolean;
};

type ParsedCliFlag =
  | 'dry-run'
  | 'write'
  | 'portfolio-id'
  | 'date-from'
  | 'date-to'
  | 'domains'
  | 'max-rows'
  | 'fail-on-missing-config'
  | 'allow-isolated-write'
  | 'allow-fact-write'
  | 'allow-source-fetch'
  | 'confirm-isolated-db';

const COUNTED_TABLES: CountedTable[] = [
  'SourceRun',
  'SourceHealth',
  'YieldCurveSnapshot',
  'MacroIndicatorSnapshot',
  'ExchangeRateSnapshot',
  'QuoteSnapshot',
  'IndexSnapshot',
];

const AUDIT_TABLES: CountedTable[] = ['SourceRun', 'SourceHealth'];
const EXTERNAL_FACT_TABLES: CountedTable[] = COUNTED_TABLES.filter(
  (table) => !AUDIT_TABLES.includes(table)
);

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
const TENCENT_KLINE_SOURCE_ID = 'tencent.kline';
const DAILY_KLINE_FETCH_COUNT = 1;
const FX_SOURCE_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_MACRO_FETCH_LOOKBACK_DAYS = 90;
const DEFAULT_ISOLATED_BACKFILL_ROOT =
  '/mnt/d/cxks/任务工作台/T0425-UHT投资数据中台优化提案/scratch';
const ISOLATED_BACKFILL_ROOT_ENV = 'UHT_BACKFILL_ISOLATED_ROOT';

type BackfillFxHistoryFetcher = (request: {
  pairs: FxPair[];
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}) => Promise<HistoricalRateRecord[]>;

type BackfillYieldCurveGateway = {
  execute(request: { asOfDate: string }): Promise<{
    sourceId: string;
    data: YieldCurveRecord[];
  }>;
};

type BackfillMacroProductionFetcher = (request: {
  indicatorIds: MacroIndicatorId[];
  dateFrom: string;
  dateTo: string;
  asOfDate: string;
}) => Promise<MacroProductionFetchResult>;

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
  const confirmIsolatedDb = raw['confirm-isolated-db'];
  if (
    confirmIsolatedDb !== undefined &&
    typeof confirmIsolatedDb !== 'string'
  ) {
    throw new Error('--confirm-isolated-db must be a database name or path');
  }

  return {
    dryRun: true,
    write,
    portfolioId,
    dateFrom,
    dateTo,
    domains,
    maxRows,
    failOnMissingConfig: raw['fail-on-missing-config'] === true,
    allowIsolatedWrite: raw['allow-isolated-write'] === true,
    allowFactWrite: raw['allow-fact-write'] === true,
    allowSourceFetch: raw['allow-source-fetch'] === true,
    confirmIsolatedDb: confirmIsolatedDb?.trim(),
  };
}

export async function runBackfillSourceData(
  options: BackfillSourceDataOptions,
  dependencies: BackfillSourceDataDependencies
): Promise<BackfillSourceDataReport> {
  const now = dependencies.now ?? (() => new Date());
  const env = dependencies.env ?? process.env;
  const generatedAt = now().toISOString();
  const writeGate = evaluateIsolatedWriteGate(options, env);
  const mode: BackfillSourceDataReport['mode'] = !options.write
    ? 'dry-run'
    : writeGate.allowed
      ? 'isolated-write'
      : 'write-rejected';
  const preCounts = await collectCounts(dependencies.prisma);
  const warnings: BackfillWarning[] = [];
  const blocked: BackfillBlockedItem[] = [...writeGate.blocked];

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

  const dates = enumerateDates(options.dateFrom, options.dateTo);
  const plans = portfolio
    ? await buildDomainPlans(options, dates, dependencies, warnings)
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
    options.allowSourceFetch &&
    mode !== 'write-rejected' &&
    !hasFatalPreWriteBlock(blocked)
  ) {
    await hydratePlansWithSourceFetch(plans, dependencies, warnings, blocked);
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

  const auditWriteSummary =
    mode === 'isolated-write' && !hasFatalPreWriteBlock(blocked)
      ? await upsertAuditRecords(
          plans,
          dependencies.prisma,
          new Date(generatedAt)
        )
      : { sourceRunUpserts: 0, sourceHealthUpserts: 0 };
  const factWriteSummary = await buildFactWriteSummary({
    plans,
    prisma: dependencies.prisma,
    warnings,
    enabled: mode === 'isolated-write' && options.allowFactWrite,
    skipReason: buildGlobalFactWriteSkipReason(mode, options, blocked),
  });

  const postCounts = await collectCounts(dependencies.prisma);
  const changedTables = diffCounts(preCounts, postCounts);
  const externalFactChangedTables = changedTables.filter((table) =>
    EXTERNAL_FACT_TABLES.includes(table)
  );
  const disallowedExternalFactChangedTables =
    getDisallowedExternalFactChangedTables(
      externalFactChangedTables,
      factWriteSummary
    );
  const auditTableChangedTables = changedTables.filter((table) =>
    AUDIT_TABLES.includes(table)
  );
  if (mode === 'dry-run' && changedTables.length > 0) {
    blocked.push({
      code: 'dry_run_count_changed',
      message:
        'Dry-run verification failed: one or more guarded table counts changed.',
      details: { changedTables },
    });
  }
  if (mode === 'isolated-write' && externalFactChangedTables.length > 0) {
    if (disallowedExternalFactChangedTables.length > 0) {
      blocked.push({
        code: 'isolated_write_fact_count_changed',
        message:
          'Isolated write verification failed: external fact table counts changed without matching allowed fact upserts.',
        details: { changedTables: disallowedExternalFactChangedTables },
      });
    }
  }

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
      sourceFetchEnabled: options.allowSourceFetch === true,
    },
    preCounts,
    postCounts,
    countVerification: {
      unchanged: changedTables.length === 0,
      changedTables,
      externalFactsUnchanged: externalFactChangedTables.length === 0,
      externalFactChangedTables,
      auditTableChangedTables,
    },
    auditWriteSummary,
    factWriteSummary,
    plans,
    blocked,
    warnings,
    writeAttempted:
      auditWriteSummary.sourceRunUpserts > 0 ||
      auditWriteSummary.sourceHealthUpserts > 0 ||
      factWriteSummary.totalUpserts > 0,
  };
}

export function getBackfillSourceDataExitCode(
  report: BackfillSourceDataReport
): number {
  if (report.mode === 'write-rejected') return 2;
  if (
    report.blocked.some((item) =>
      ['dry_run_count_changed', 'isolated_write_fact_count_changed'].includes(
        item.code
      )
    )
  ) {
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

function buildGlobalFactWriteSkipReason(
  mode: BackfillSourceDataReport['mode'],
  options: BackfillSourceDataOptions,
  blocked: BackfillBlockedItem[]
): { reason: string; message: string } | null {
  if (mode === 'dry-run') {
    return {
      reason: 'dry_run',
      message: 'Dry-run mode never writes fact tables.',
    };
  }

  if (mode === 'write-rejected') {
    return {
      reason: 'write_gate_rejected',
      message: 'Fact writes are skipped because the write gate failed closed.',
    };
  }

  if (hasFatalPreWriteBlock(blocked)) {
    return {
      reason: 'pre_write_blocked',
      message:
        'Fact writes are skipped because a fatal pre-write block exists.',
    };
  }

  if (!options.allowFactWrite) {
    return {
      reason: 'fact_write_flag_missing',
      message: 'Fact writes require --allow-fact-write.',
    };
  }

  return null;
}

async function buildFactWriteSummary(input: {
  plans: BackfillDomainPlan[];
  prisma: BackfillSourceDataPrisma;
  warnings: BackfillWarning[];
  enabled: boolean;
  skipReason: { reason: string; message: string } | null;
}): Promise<BackfillFactWriteSummary> {
  const summary = createFactWriteSummary(input.enabled);
  if (input.skipReason) {
    for (const plan of input.plans) {
      for (const target of plan.targets) {
        addFactWriteSkip(summary, {
          domain: plan.domain,
          key: target.key,
          reason: input.skipReason.reason,
          message: input.skipReason.message,
        });
      }
    }
    return summary;
  }

  for (const plan of input.plans) {
    if (plan.blocked.length > 0) {
      for (const target of plan.targets) {
        addFactWriteSkip(summary, {
          domain: plan.domain,
          key: target.key,
          reason: 'plan_blocked',
          message:
            'Fact writes are skipped because this domain plan remains blocked.',
          details: {
            blockedCodes: plan.blocked.map((item) => item.code),
          },
        });
      }
      continue;
    }

    if (plan.domain === 'fx') {
      await upsertFxFacts(plan, input.prisma, summary, input.warnings);
      continue;
    }

    if (plan.domain === 'market_quote') {
      await upsertMarketQuoteFacts(plan, input.prisma, summary, input.warnings);
      continue;
    }

    if (plan.domain === 'index') {
      await upsertIndexFacts(plan, input.prisma, summary, input.warnings);
      continue;
    }

    if (plan.domain === 'yield_curve') {
      await upsertYieldCurveFacts(plan, input.prisma, summary, input.warnings);
      continue;
    }

    if (plan.domain === 'macro') {
      await upsertMacroFacts(plan, input.prisma, summary, input.warnings);
    }
  }

  return summary;
}

function createFactWriteSummary(enabled: boolean): BackfillFactWriteSummary {
  return {
    enabled,
    totalUpserts: 0,
    exchangeRateSnapshotUpserts: 0,
    quoteSnapshotUpserts: 0,
    indexSnapshotUpserts: 0,
    yieldCurveSnapshotUpserts: 0,
    macroIndicatorSnapshotUpserts: 0,
    skipped: 0,
    skipReasons: {},
    skips: [],
  };
}

async function upsertFxFacts(
  plan: BackfillDomainPlan,
  prisma: BackfillSourceDataPrisma,
  summary: BackfillFactWriteSummary,
  warnings: BackfillWarning[]
): Promise<void> {
  for (const target of plan.targets) {
    const pair = readStringAttribute(target, 'pair');
    const rate = target.attributes.rate;
    if (!pair || !hasRealFactValue(rate)) {
      addMissingFactValueSkip({
        summary,
        warnings,
        domain: plan.domain,
        target,
        missingFields: [
          ...(!pair ? ['pair'] : []),
          ...(!hasRealFactValue(rate) ? ['rate'] : []),
        ],
      });
      continue;
    }

    await prisma.exchangeRateSnapshot.upsert({
      where: { date_pair: { date: target.date, pair } },
      create: {
        date: target.date,
        pair,
        rate,
        source: readOptionalStringAttribute(target, 'source') ?? null,
      },
      update: {
        rate,
        source: readOptionalStringAttribute(target, 'source') ?? null,
      },
    });
    summary.exchangeRateSnapshotUpserts += 1;
    summary.totalUpserts += 1;
  }
}

async function upsertMarketQuoteFacts(
  plan: BackfillDomainPlan,
  prisma: BackfillSourceDataPrisma,
  summary: BackfillFactWriteSummary,
  warnings: BackfillWarning[]
): Promise<void> {
  for (const target of plan.targets) {
    const assetCode = readStringAttribute(target, 'assetCode');
    const currentPrice = target.attributes.currentPrice;
    const timestamp = parseFactTimestamp(target.attributes.timestamp);
    if (!assetCode || !hasRealFactValue(currentPrice) || !timestamp) {
      addMissingFactValueSkip({
        summary,
        warnings,
        domain: plan.domain,
        target,
        missingFields: [
          ...(!assetCode ? ['assetCode'] : []),
          ...(!hasRealFactValue(currentPrice) ? ['currentPrice'] : []),
          ...(!timestamp ? ['timestamp'] : []),
        ],
      });
      continue;
    }

    const klineFields = buildMarketQuoteKlineFactFields(target);
    const payload = {
      timestamp,
      currentPrice,
      ...klineFields,
    };

    await prisma.quoteSnapshot.upsert({
      where: { assetCode_date: { assetCode, date: target.date } },
      create: {
        assetCode,
        date: target.date,
        ...payload,
      },
      update: payload,
    });
    summary.quoteSnapshotUpserts += 1;
    summary.totalUpserts += 1;
  }
}

function buildMarketQuoteKlineFactFields(
  target: BackfillTarget
): Record<string, unknown> {
  return {
    ...optionalFactField(target, 'openPrice'),
    ...optionalFactField(target, 'highPrice'),
    ...optionalFactField(target, 'lowPrice'),
    ...optionalFactField(target, 'volume'),
  };
}

function optionalFactField(
  target: BackfillTarget,
  key: string
): Record<string, unknown> {
  const value = target.attributes[key];
  return hasRealFactValue(value) ? { [key]: value } : {};
}

async function upsertIndexFacts(
  plan: BackfillDomainPlan,
  prisma: BackfillSourceDataPrisma,
  summary: BackfillFactWriteSummary,
  warnings: BackfillWarning[]
): Promise<void> {
  for (const target of plan.targets) {
    const indexCode = readStringAttribute(target, 'indexCode');
    const name = readStringAttribute(target, 'name');
    const currentPrice = target.attributes.currentPrice;
    if (!indexCode || !name || !hasRealFactValue(currentPrice)) {
      addMissingFactValueSkip({
        summary,
        warnings,
        domain: plan.domain,
        target,
        missingFields: [
          ...(!indexCode ? ['indexCode'] : []),
          ...(!name ? ['name'] : []),
          ...(!hasRealFactValue(currentPrice) ? ['currentPrice'] : []),
        ],
      });
      continue;
    }

    await prisma.indexSnapshot.upsert({
      where: { date_indexCode: { date: target.date, indexCode } },
      create: {
        date: target.date,
        indexCode,
        name,
        currentPrice,
      },
      update: {
        name,
        currentPrice,
      },
    });
    summary.indexSnapshotUpserts += 1;
    summary.totalUpserts += 1;
  }
}

async function upsertYieldCurveFacts(
  plan: BackfillDomainPlan,
  prisma: BackfillSourceDataPrisma,
  summary: BackfillFactWriteSummary,
  warnings: BackfillWarning[]
): Promise<void> {
  for (const target of plan.targets) {
    const country = readStringAttribute(target, 'country');
    const tenor = readStringAttribute(target, 'tenor');
    const sourceId = readStringAttribute(target, 'sourceId');
    const sourceDate =
      readOptionalStringAttribute(target, 'sourceDate') ?? target.date;
    const status = readSnapshotStatusAttribute(target);
    const sourceTime = parseFactTimestamp(target.attributes.sourceTime);
    const errorSummary = readOptionalStringAttribute(target, 'errorSummary');
    const yieldPercent = readOptionalNumberAttribute(target, 'yieldPercent');

    if (
      !country ||
      !tenor ||
      !sourceId ||
      !status ||
      (requiresNumericSnapshotValue(status) && yieldPercent === undefined)
    ) {
      addMissingFactValueSkip({
        summary,
        warnings,
        domain: plan.domain,
        target,
        missingFields: [
          ...(!country ? ['country'] : []),
          ...(!tenor ? ['tenor'] : []),
          ...(!sourceId ? ['sourceId'] : []),
          ...(!status ? ['status'] : []),
          ...(requiresNumericSnapshotValue(status) && yieldPercent === undefined
            ? ['yieldPercent']
            : []),
        ],
      });
      continue;
    }

    await prisma.yieldCurveSnapshot.upsert({
      where: {
        date_country_tenor_sourceId: {
          date: sourceDate,
          country,
          tenor,
          sourceId,
        },
      },
      create: {
        date: sourceDate,
        country,
        tenor,
        yieldPercent: yieldPercent ?? null,
        sourceId,
        sourceTime: sourceTime ?? null,
        status,
        errorSummary: errorSummary ?? null,
      },
      update: {
        yieldPercent: yieldPercent ?? null,
        sourceTime: sourceTime ?? null,
        status,
        errorSummary: errorSummary ?? null,
      },
    });
    summary.yieldCurveSnapshotUpserts += 1;
    summary.totalUpserts += 1;
  }
}

async function upsertMacroFacts(
  plan: BackfillDomainPlan,
  prisma: BackfillSourceDataPrisma,
  summary: BackfillFactWriteSummary,
  warnings: BackfillWarning[]
): Promise<void> {
  for (const target of plan.targets) {
    const indicatorId = readStringAttribute(target, 'indicatorId');
    const sourceId = readStringAttribute(target, 'sourceId');
    const sourceDate =
      readOptionalStringAttribute(target, 'sourceDate') ?? target.date;
    const status = readSnapshotStatusAttribute(target);
    const unit =
      readOptionalStringAttribute(target, 'unit') ??
      (indicatorId
        ? MACRO_INDICATORS[indicatorId as keyof typeof MACRO_INDICATORS]?.unit
        : null);
    const sourceTime = parseFactTimestamp(target.attributes.sourceTime);
    const errorSummary = readOptionalStringAttribute(target, 'errorSummary');
    const value = readOptionalNumberAttribute(target, 'value');

    if (
      !indicatorId ||
      !sourceId ||
      !status ||
      !unit ||
      (requiresNumericSnapshotValue(status) && value === undefined)
    ) {
      addMissingFactValueSkip({
        summary,
        warnings,
        domain: plan.domain,
        target,
        missingFields: [
          ...(!indicatorId ? ['indicatorId'] : []),
          ...(!sourceId ? ['sourceId'] : []),
          ...(!status ? ['status'] : []),
          ...(!unit ? ['unit'] : []),
          ...(requiresNumericSnapshotValue(status) && value === undefined
            ? ['value']
            : []),
        ],
      });
      continue;
    }

    await prisma.macroIndicatorSnapshot.upsert({
      where: {
        date_indicatorId_sourceId: {
          date: sourceDate,
          indicatorId,
          sourceId,
        },
      },
      create: {
        date: sourceDate,
        indicatorId,
        value: value ?? null,
        unit,
        sourceId,
        sourceTime: sourceTime ?? null,
        status,
        errorSummary: errorSummary ?? null,
      },
      update: {
        value: value ?? null,
        unit,
        sourceTime: sourceTime ?? null,
        status,
        errorSummary: errorSummary ?? null,
      },
    });
    summary.macroIndicatorSnapshotUpserts += 1;
    summary.totalUpserts += 1;
  }
}

function addMissingFactValueSkip(input: {
  summary: BackfillFactWriteSummary;
  warnings: BackfillWarning[];
  domain: BackfillSourceDataDomain;
  target: BackfillTarget;
  missingFields: string[];
}): void {
  const skip = {
    domain: input.domain,
    key: input.target.key,
    reason:
      input.target.status === 'missing'
        ? 'target_missing_source_value'
        : 'missing_required_fact_value',
    message:
      input.target.status === 'missing'
        ? 'No source fact row exists for this target; fact upsert skipped.'
        : 'A source fact row exists but required real values are missing; fact upsert skipped.',
    details: { missingFields: input.missingFields },
  };
  addFactWriteSkip(input.summary, skip);
  input.warnings.push({
    domain: input.domain,
    code: 'fact_write_skipped',
    message: skip.message,
    details: {
      key: input.target.key,
      reason: skip.reason,
      missingFields: input.missingFields,
    },
  });
}

function addFactWriteSkip(
  summary: BackfillFactWriteSummary,
  skip: BackfillFactWriteSkip
): void {
  summary.skipped += 1;
  summary.skipReasons[skip.reason] =
    (summary.skipReasons[skip.reason] ?? 0) + 1;
  summary.skips.push(skip);
}

function readStringAttribute(
  target: BackfillTarget,
  key: string
): string | null {
  const value = target.attributes[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readOptionalStringAttribute(
  target: BackfillTarget,
  key: string
): string | null {
  const value = target.attributes[key];
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readOptionalNumberAttribute(
  target: BackfillTarget,
  key: string
): number | undefined {
  const value = target.attributes[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readSnapshotStatusAttribute(
  target: BackfillTarget
): 'SUCCESS' | 'MISSING' | 'STALE' | 'SOURCE_FAILED' | null {
  const value = readOptionalStringAttribute(target, 'status');
  if (
    value === 'SUCCESS' ||
    value === 'MISSING' ||
    value === 'STALE' ||
    value === 'SOURCE_FAILED'
  ) {
    return value;
  }
  return null;
}

function requiresNumericSnapshotValue(
  status: 'SUCCESS' | 'MISSING' | 'STALE' | 'SOURCE_FAILED' | null
): boolean {
  return status === 'SUCCESS' || status === 'STALE';
}

function hasRealFactValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || value.trim().length > 0)
  );
}

function parseFactTimestamp(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function upsertAuditRecords(
  plans: BackfillDomainPlan[],
  prisma: BackfillSourceDataPrisma,
  auditAt: Date
): Promise<BackfillSourceDataReport['auditWriteSummary']> {
  const sourceHealthByKey = new Map<
    string,
    {
      sourceId: string;
      domain: BackfillSourceDataDomain;
      status: SourceHealthStatus;
      errorCode?: string;
      errorMessage?: string;
    }
  >();
  let sourceRunUpserts = 0;

  for (const plan of plans) {
    const auditStatus = buildAuditStatus(plan);
    await prisma.sourceRun.upsert({
      where: { runKey: plan.runKey },
      create: {
        runKey: plan.runKey,
        sourceId: plan.sourceId,
        domain: plan.domain,
        job: 'm8.2.3b-isolated-audit-write',
        targetDate: plan.date,
        startedAt: auditAt,
        finishedAt: auditAt,
        status: auditStatus.sourceRunStatus,
        rowsWritten: 0,
        errorCode: auditStatus.errorCode ?? null,
        errorMessage: auditStatus.errorMessage ?? null,
        payloadHash: null,
      },
      update: {
        sourceId: plan.sourceId,
        domain: plan.domain,
        job: 'm8.2.3b-isolated-audit-write',
        targetDate: plan.date,
        startedAt: auditAt,
        finishedAt: auditAt,
        status: auditStatus.sourceRunStatus,
        rowsWritten: 0,
        errorCode: auditStatus.errorCode ?? null,
        errorMessage: auditStatus.errorMessage ?? null,
        payloadHash: null,
      },
    });
    sourceRunUpserts += 1;

    const healthKey = `${plan.sourceId}:${plan.domain}`;
    const previous = sourceHealthByKey.get(healthKey);
    const next = {
      sourceId: plan.sourceId,
      domain: plan.domain,
      status: auditStatus.sourceHealthStatus,
      errorCode: auditStatus.errorCode,
      errorMessage: auditStatus.errorMessage,
    };
    sourceHealthByKey.set(
      healthKey,
      previous ? mergeSourceHealth(previous, next) : next
    );
  }

  let sourceHealthUpserts = 0;
  for (const health of sourceHealthByKey.values()) {
    const healthy = health.status === 'HEALTHY';
    await prisma.sourceHealth.upsert({
      where: {
        sourceId_domain: {
          sourceId: health.sourceId,
          domain: health.domain,
        },
      },
      create: {
        sourceId: health.sourceId,
        domain: health.domain,
        status: health.status,
        checkedAt: auditAt,
        lastSuccessAt: healthy ? auditAt : null,
        lastFailureAt: healthy ? null : auditAt,
        consecutiveFailures: healthy ? 0 : 1,
        latencyMs: null,
        errorCode: health.errorCode ?? null,
        errorMessage: health.errorMessage ?? null,
      },
      update: {
        status: health.status,
        checkedAt: auditAt,
        lastSuccessAt: healthy ? auditAt : null,
        lastFailureAt: healthy ? null : auditAt,
        consecutiveFailures: healthy ? 0 : 1,
        latencyMs: null,
        errorCode: health.errorCode ?? null,
        errorMessage: health.errorMessage ?? null,
      },
    });
    sourceHealthUpserts += 1;
  }

  return { sourceRunUpserts, sourceHealthUpserts };
}

function buildAuditStatus(plan: BackfillDomainPlan): {
  sourceRunStatus: SourceRunStatus;
  sourceHealthStatus: SourceHealthStatus;
  errorCode?: string;
  errorMessage?: string;
} {
  const firstBlock = plan.blocked[0];
  if (firstBlock) {
    return {
      sourceRunStatus: 'FAILED',
      sourceHealthStatus: 'DEGRADED',
      errorCode: firstBlock.code,
      errorMessage: firstBlock.message,
    };
  }

  if (plan.missingRows > 0) {
    return {
      sourceRunStatus: 'PARTIAL',
      sourceHealthStatus: 'DEGRADED',
      errorCode: 'external_fact_missing_no_write',
      errorMessage:
        'External fact rows are missing after optional source fetch; the runner does not synthesize facts.',
    };
  }

  const snapshotStatuses = unique(
    plan.targets
      .map((target) => readSnapshotStatusAttribute(target))
      .filter(
        (status): status is 'SUCCESS' | 'MISSING' | 'STALE' | 'SOURCE_FAILED' =>
          Boolean(status)
      )
  );

  if (snapshotStatuses.includes('SOURCE_FAILED')) {
    return {
      sourceRunStatus: 'FAILED',
      sourceHealthStatus: 'DEGRADED',
      errorCode: 'source_fetch_source_failed',
      errorMessage:
        'One or more fetched source records reported SOURCE_FAILED status.',
    };
  }

  if (
    snapshotStatuses.includes('MISSING') ||
    snapshotStatuses.includes('STALE')
  ) {
    return {
      sourceRunStatus: 'PARTIAL',
      sourceHealthStatus: 'DEGRADED',
      errorCode: snapshotStatuses.includes('STALE')
        ? 'source_fetch_stale_value'
        : 'source_fetch_missing_value',
      errorMessage: snapshotStatuses.includes('STALE')
        ? 'One or more fetched source records are stale for the requested date.'
        : 'One or more fetched source records still have missing values.',
    };
  }

  return {
    sourceRunStatus: 'SUCCESS',
    sourceHealthStatus: 'HEALTHY',
  };
}

function mergeSourceHealth<
  T extends {
    status: SourceHealthStatus;
    errorCode?: string;
    errorMessage?: string;
  },
>(previous: T, next: T): T {
  const healthRank: Record<SourceHealthStatus, number> = {
    HEALTHY: 0,
    UNKNOWN: 1,
    DEGRADED: 2,
    DOWN: 3,
  };
  if (healthRank[next.status] > healthRank[previous.status]) return next;
  return previous;
}

function addPlanBlock(
  plan: BackfillDomainPlan,
  block: BackfillBlockedItem,
  blocked: BackfillBlockedItem[]
): void {
  if (
    !plan.blocked.some(
      (item) =>
        item.domain === block.domain &&
        item.code === block.code &&
        item.message === block.message
    )
  ) {
    plan.blocked.push(block);
  }
  plan.status = 'blocked';

  if (
    !blocked.some(
      (item) =>
        item.domain === block.domain &&
        item.code === block.code &&
        item.message === block.message
    )
  ) {
    blocked.push(block);
  }
}

async function buildDomainPlans(
  options: BackfillSourceDataOptions,
  dates: string[],
  dependencies: BackfillSourceDataDependencies,
  warnings: BackfillWarning[]
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
    plans.push(...(await planYieldCurve(options, dates, dependencies.prisma)));
  }

  if (options.domains.includes('macro')) {
    plans.push(...(await planMacro(options, dates, dependencies.prisma)));
  }

  return plans;
}

async function hydratePlansWithSourceFetch(
  plans: BackfillDomainPlan[],
  dependencies: BackfillSourceDataDependencies,
  warnings: BackfillWarning[],
  blocked: BackfillBlockedItem[]
): Promise<void> {
  await hydrateFxPlansWithSourceFetch(plans, dependencies, warnings);
  await hydrateYieldCurvePlansWithSourceFetch(
    plans,
    dependencies,
    warnings,
    blocked
  );
  await hydrateMacroPlansWithSourceFetch(
    plans,
    dependencies,
    warnings,
    blocked
  );

  const klineFetcher = dependencies.klineFetcher;
  if (!klineFetcher) {
    warnings.push({
      code: 'source_fetcher_not_configured',
      message:
        '--allow-source-fetch was set, but no kline fetcher is configured for this runner invocation.',
      details: { sourceId: TENCENT_KLINE_SOURCE_ID },
    });
    return;
  }

  for (const plan of plans) {
    if (plan.domain !== 'market_quote' && plan.domain !== 'index') continue;

    let attempted = false;
    for (const target of plan.targets) {
      if (target.status !== 'missing') continue;

      attempted = true;
      await hydrateMissingTargetFromKline(
        plan.domain,
        target,
        klineFetcher,
        warnings
      );
    }

    if (attempted) {
      plan.sourceId = TENCENT_KLINE_SOURCE_ID;
      refreshPlanTargetCounts(plan);
    }
  }
}

async function hydrateFxPlansWithSourceFetch(
  plans: BackfillDomainPlan[],
  dependencies: BackfillSourceDataDependencies,
  warnings: BackfillWarning[]
): Promise<void> {
  const fxPlans = plans.filter((plan) => plan.domain === 'fx');
  if (fxPlans.length === 0) return;

  const fxHistoryFetcher = dependencies.fxHistoryFetcher;
  if (!fxHistoryFetcher) {
    warnings.push({
      domain: 'fx',
      code: 'source_fetcher_not_configured',
      message:
        '--allow-source-fetch was set, but no FX history fetcher is configured for this runner invocation.',
      details: { sourceId: FRANKFURTER_FX_SOURCE_ID },
    });
    return;
  }

  try {
    const request = buildFxHistoryFetchRequest(fxPlans);
    const rows = await fxHistoryFetcher({
      ...request,
      pairs: [...FX_PAIRS],
      signal: new AbortController().signal,
      timeoutMs: FX_SOURCE_FETCH_TIMEOUT_MS,
    });
    const rowsByKey = new Map(
      rows.map((row) => [fxKey(row.date, row.pair), row] as const)
    );

    for (const plan of fxPlans) {
      let hydrated = false;
      for (const target of plan.targets) {
        if (target.status !== 'missing') continue;

        const pair = readStringAttribute(target, 'pair') as FxPair | null;
        if (!pair) continue;

        const row = rowsByKey.get(fxKey(plan.date, pair));
        if (!row) continue;

        target.status = 'fetched';
        target.attributes = {
          ...target.attributes,
          rate: row.rate,
          source: FRANKFURTER_FX_SOURCE_ID,
          sourceTime: row.timestamp,
        };
        hydrated = true;
      }

      if (hydrated) {
        plan.sourceId = FRANKFURTER_FX_SOURCE_ID;
        refreshPlanTargetCounts(plan);
      }
    }
  } catch (error) {
    warnings.push({
      domain: 'fx',
      code: 'source_fetch_failed',
      message:
        'Frankfurter FX source fetch failed; runner kept missing FX targets read-only.',
      details: {
        sourceId: FRANKFURTER_FX_SOURCE_ID,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function buildFxHistoryFetchRequest(plans: BackfillDomainPlan[]): {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
} {
  const planDates = plans.map((plan) => plan.date).sort();
  const firstDate = planDates[0];
  const lastDate = planDates[planDates.length - 1];

  if (firstDate === lastDate) {
    return { date: firstDate };
  }

  return {
    dateFrom: firstDate,
    dateTo: lastDate,
  };
}

async function hydrateYieldCurvePlansWithSourceFetch(
  plans: BackfillDomainPlan[],
  dependencies: BackfillSourceDataDependencies,
  warnings: BackfillWarning[],
  blocked: BackfillBlockedItem[]
): Promise<void> {
  const yieldPlans = plans.filter((plan) => plan.domain === 'yield_curve');
  if (yieldPlans.length === 0) return;

  const gateway = dependencies.yieldCurveGateway;
  if (!gateway) {
    for (const plan of yieldPlans) {
      addPlanBlock(
        plan,
        notConfiguredBlock(
          'yield_curve',
          'Yield curve production gateway is not available for this runner invocation.'
        ),
        blocked
      );
    }
    return;
  }

  for (const plan of yieldPlans) {
    if (plan.missingRows === 0) continue;

    try {
      const response = await gateway.execute({ asOfDate: plan.date });
      const recordByKey = new Map(
        response.data.map((record) => [
          yieldCurveCountryTenorKey(record.country, record.tenor),
          record,
        ])
      );

      plan.sourceId = response.sourceId;

      let hydrated = false;
      for (const target of plan.targets) {
        if (target.status !== 'missing') continue;

        const country = readStringAttribute(target, 'country');
        const tenor = readStringAttribute(target, 'tenor');
        if (!country || !tenor) continue;

        const record = recordByKey.get(
          yieldCurveCountryTenorKey(country, tenor)
        );
        if (!record) continue;

        target.status = 'fetched';
        target.attributes = {
          ...target.attributes,
          sourceId: response.sourceId,
          sourceDate: record.date,
          sourceTime: record.sourceTime,
          status: record.status,
          yieldPercent: record.yieldPercent,
          errorSummary: record.errorSummary,
        };
        hydrated = true;
      }

      if (hydrated) {
        refreshPlanTargetCounts(plan);
      }
    } catch (error) {
      handleSourceFetchError({
        plan,
        domain: 'yield_curve',
        blocked,
        warnings,
        error,
        notConfiguredMessage:
          'Yield curve source fetch is fail-closed because the AkShare bridge is not configured.',
        failureMessage:
          'Yield curve source fetch failed; runner kept missing yield targets read-only.',
      });
    }
  }
}

async function hydrateMacroPlansWithSourceFetch(
  plans: BackfillDomainPlan[],
  dependencies: BackfillSourceDataDependencies,
  warnings: BackfillWarning[],
  blocked: BackfillBlockedItem[]
): Promise<void> {
  const macroPlans = plans.filter((plan) => plan.domain === 'macro');
  if (macroPlans.length === 0) return;

  const macroProductionFetcher = dependencies.macroProductionFetcher;
  if (!macroProductionFetcher) {
    for (const plan of macroPlans) {
      addPlanBlock(
        plan,
        notConfiguredBlock(
          'macro',
          'Macro production fetch seam is not available for this runner invocation.'
        ),
        blocked
      );
    }
    return;
  }

  for (const plan of macroPlans) {
    if (plan.missingRows === 0) continue;

    const indicatorIds = plan.targets
      .map((target) => readStringAttribute(target, 'indicatorId'))
      .filter((value): value is MacroIndicatorId => Boolean(value));

    try {
      const response = await macroProductionFetcher({
        indicatorIds,
        dateFrom: shiftIsoDate(plan.date, -DEFAULT_MACRO_FETCH_LOOKBACK_DAYS),
        dateTo: plan.date,
        asOfDate: plan.date,
      });

      plan.sourceId = response.sourceId;

      if (!response.ok) {
        addPlanBlock(
          plan,
          notConfiguredBlock('macro', response.blocked.message),
          blocked
        );
        continue;
      }

      const latestByIndicator = latestMacroRecordsByIndicator(response.records);
      let hydrated = false;
      for (const target of plan.targets) {
        if (target.status !== 'missing') continue;

        const indicatorId = readStringAttribute(target, 'indicatorId');
        if (!indicatorId) continue;

        const record = latestByIndicator.get(indicatorId as MacroIndicatorId);
        if (!record) continue;

        target.status = 'fetched';
        target.attributes = {
          ...target.attributes,
          sourceId: response.sourceId,
          sourceDate: record.date,
          sourceTime: toIsoString(record.sourceTime),
          status: record.status,
          value: record.value,
          unit: record.unit,
          errorSummary: record.errorSummary,
        };
        hydrated = true;
      }

      if (hydrated) {
        refreshPlanTargetCounts(plan);
      }
    } catch (error) {
      handleSourceFetchError({
        plan,
        domain: 'macro',
        blocked,
        warnings,
        error,
        notConfiguredMessage:
          'Macro source fetch is fail-closed because FRED_API_KEY is not configured.',
        failureMessage:
          'Macro source fetch failed; runner kept missing macro targets read-only.',
      });
    }
  }
}

function latestMacroRecordsByIndicator(
  records: MacroIndicatorSnapshot[]
): Map<MacroIndicatorId, MacroIndicatorSnapshot> {
  const latestByIndicator = new Map<MacroIndicatorId, MacroIndicatorSnapshot>();

  for (const record of records) {
    const previous = latestByIndicator.get(record.indicatorId);
    if (!previous || compareMacroRecords(record, previous) > 0) {
      latestByIndicator.set(record.indicatorId, record);
    }
  }

  return latestByIndicator;
}

function compareMacroRecords(
  left: MacroIndicatorSnapshot,
  right: MacroIndicatorSnapshot
): number {
  const dateCompare = left.date.localeCompare(right.date);
  if (dateCompare !== 0) return dateCompare;
  const leftSourceTime = toIsoString(left.sourceTime) ?? '';
  const rightSourceTime = toIsoString(right.sourceTime) ?? '';
  return leftSourceTime.localeCompare(rightSourceTime);
}

function handleSourceFetchError(input: {
  plan: BackfillDomainPlan;
  domain: Extract<BackfillSourceDataDomain, 'yield_curve' | 'macro'>;
  blocked: BackfillBlockedItem[];
  warnings: BackfillWarning[];
  error: unknown;
  notConfiguredMessage: string;
  failureMessage: string;
}): void {
  const firstError = getFirstSourceGatewayError(input.error);
  if (firstError?.code === 'SOURCE_NOT_CONFIGURED') {
    addPlanBlock(
      input.plan,
      notConfiguredBlock(
        input.domain,
        firstError.message || input.notConfiguredMessage
      ),
      input.blocked
    );
    return;
  }

  input.warnings.push({
    domain: input.domain,
    code: 'source_fetch_failed',
    message: input.failureMessage,
    details: {
      runKey: input.plan.runKey,
      errorCode: firstError?.code,
      error:
        firstError?.message ??
        (input.error instanceof Error
          ? input.error.message
          : String(input.error)),
    },
  });
}

function getFirstSourceGatewayError(
  error: unknown
): { code?: string; message?: string } | null {
  if (error instanceof SourceGatewayFailureError) {
    return error.errors[0] ?? null;
  }

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error
  ) {
    const candidate = error as { code?: string; message?: string };
    return {
      code: candidate.code,
      message: candidate.message,
    };
  }

  return null;
}

async function hydrateMissingTargetFromKline(
  domain: Extract<BackfillSourceDataDomain, 'market_quote' | 'index'>,
  target: BackfillTarget,
  klineFetcher: BackfillKlineFetcher,
  warnings: BackfillWarning[]
): Promise<void> {
  const code =
    domain === 'market_quote'
      ? readStringAttribute(target, 'assetCode')
      : readStringAttribute(target, 'indexCode');

  if (!code) {
    warnings.push({
      domain,
      code: 'source_fetch_target_code_missing',
      message:
        'Kline source fetch skipped because the missing target has no asset/index code.',
      details: { key: target.key, targetDate: target.date },
    });
    return;
  }

  let points: KlinePoint[];
  try {
    points = await klineFetcher(
      code,
      'daily',
      target.date,
      target.date,
      'qfq',
      DAILY_KLINE_FETCH_COUNT
    );
  } catch (error) {
    warnings.push({
      domain,
      code: 'source_fetch_failed',
      message:
        'Tencent kline source fetch failed; target fact remains missing.',
      details: {
        key: target.key,
        targetDate: target.date,
        sourceCode: code,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }

  const matched = points.find((point) => isTargetDateKline(point, target.date));
  if (!matched) {
    warnings.push({
      domain,
      code: 'source_fetch_target_date_missing',
      message:
        'Tencent kline returned no valid daily point for the requested target date; fact upsert skipped.',
      details: {
        key: target.key,
        targetDate: target.date,
        sourceCode: code,
        returnedDates: points.map((point) => point.date).filter(Boolean),
      },
    });
    return;
  }

  target.status = 'fetched';
  target.attributes = {
    ...target.attributes,
    ...klinePointToTargetAttributes(matched),
    source: TENCENT_KLINE_SOURCE_ID,
  };
}

function isTargetDateKline(point: KlinePoint, targetDate: string): boolean {
  return point.date === targetDate && safeNumber(point.close) !== undefined;
}

function klinePointToTargetAttributes(
  point: KlinePoint
): Record<string, unknown> {
  return {
    currentPrice: safeNumber(point.close),
    openPrice: safeNumber(point.open),
    highPrice: safeNumber(point.high),
    lowPrice: safeNumber(point.low),
    volume: safeNumber(point.volume),
    timestamp: `${point.date}T00:00:00.000Z`,
    sourceDate: point.date,
  };
}

function safeNumber(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function refreshPlanTargetCounts(plan: BackfillDomainPlan): void {
  const existingRows = plan.targets.filter(
    (target) => target.status !== 'missing'
  ).length;
  plan.existingRows = existingRows;
  plan.missingRows = plan.targets.length - existingRows;
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
            openPrice: true,
            highPrice: true,
            lowPrice: true,
            volume: true,
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
          openPrice: row ? toJsonValue(row.openPrice) : undefined,
          highPrice: row ? toJsonValue(row.highPrice) : undefined,
          lowPrice: row ? toJsonValue(row.lowPrice) : undefined,
          volume: row ? toJsonValue(row.volume) : undefined,
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
  prisma: BackfillSourceDataPrisma
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
      yieldPercent: true,
      sourceTime: true,
      errorSummary: true,
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
            sourceDate: row?.date,
            yieldPercent: row ? toJsonValue(row.yieldPercent) : undefined,
            sourceTime: toIsoString(row?.sourceTime),
            errorSummary: row?.errorSummary ?? undefined,
          },
        } satisfies BackfillTarget;
      })
    );

    return buildPlan({
      domain: 'yield_curve',
      date,
      scope: 'global',
      sourceId: 'akshare-yield-curve',
      targets,
    });
  });
}

async function planMacro(
  options: BackfillSourceDataOptions,
  dates: string[],
  prisma: BackfillSourceDataPrisma
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
      value: true,
      unit: true,
      sourceTime: true,
      errorSummary: true,
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
          sourceDate: row?.date,
          value: row ? toJsonValue(row.value) : undefined,
          unit: row?.unit ?? undefined,
          sourceTime: toIsoString(row?.sourceTime),
          errorSummary: row?.errorSummary ?? undefined,
        },
      } satisfies BackfillTarget;
    });

    return buildPlan({
      domain: 'macro',
      date,
      scope: 'global',
      sourceId: 'fred-macro',
      targets,
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
    (target) => target.status !== 'missing'
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

function getDisallowedExternalFactChangedTables(
  externalFactChangedTables: CountedTable[],
  factWriteSummary: BackfillFactWriteSummary
): CountedTable[] {
  const allowedChangedTables = new Set<CountedTable>();
  if (factWriteSummary.enabled) {
    if (factWriteSummary.exchangeRateSnapshotUpserts > 0) {
      allowedChangedTables.add('ExchangeRateSnapshot');
    }
    if (factWriteSummary.quoteSnapshotUpserts > 0) {
      allowedChangedTables.add('QuoteSnapshot');
    }
    if (factWriteSummary.indexSnapshotUpserts > 0) {
      allowedChangedTables.add('IndexSnapshot');
    }
    if (factWriteSummary.yieldCurveSnapshotUpserts > 0) {
      allowedChangedTables.add('YieldCurveSnapshot');
    }
    if (factWriteSummary.macroIndicatorSnapshotUpserts > 0) {
      allowedChangedTables.add('MacroIndicatorSnapshot');
    }
  }

  return externalFactChangedTables.filter(
    (table) => !allowedChangedTables.has(table)
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
    'isolated_write_fact_count_changed',
    'fail_on_missing_config',
  ]);
  if (input.blocked.some((item) => fatalBlockCodes.has(item.code))) {
    return 'blocked';
  }
  if (input.mode === 'isolated-write') {
    if (input.blocked.length > 0) return 'isolated_write_completed_with_blocks';
    return 'isolated_write_completed';
  }
  if (input.blocked.length > 0) return 'dry_run_completed_with_blocks';
  return 'dry_run_completed';
}

function hasFatalPreWriteBlock(blocked: BackfillBlockedItem[]): boolean {
  const fatalBlockCodes = new Set([
    'portfolio_not_found',
    'max_rows_exceeded',
    'fail_on_missing_config',
  ]);
  return blocked.some((item) => fatalBlockCodes.has(item.code));
}

function evaluateIsolatedWriteGate(
  options: BackfillSourceDataOptions,
  env: NodeJS.ProcessEnv
): {
  allowed: boolean;
  blocked: BackfillBlockedItem[];
} {
  if (!options.write) return { allowed: false, blocked: [] };

  const blocked: BackfillBlockedItem[] = [];
  const databasePath = resolveSqliteDatabasePathFromUrl(env.DATABASE_URL);
  const isolatedRoot = resolveIsolatedBackfillRoot(env);

  if (!options.allowIsolatedWrite) {
    blocked.push({
      code: 'isolated_write_gate_missing_flag',
      message:
        '--write requires --allow-isolated-write for M8.2.3B isolated audit writes.',
    });
  }

  if (!options.confirmIsolatedDb) {
    blocked.push({
      code: 'isolated_write_confirm_missing',
      message:
        '--write requires --confirm-isolated-db <expected-db-name-or-path>.',
    });
  }

  if (!databasePath) {
    blocked.push({
      code: 'isolated_write_database_url_not_file',
      message: 'DATABASE_URL must be a file: SQLite URL for isolated writes.',
    });
  } else {
    if (isKnownProductionDatabasePath(databasePath)) {
      blocked.push({
        code: 'isolated_write_production_path_rejected',
        message:
          'DATABASE_URL points at a known production/default portfolio.db path; isolated write is rejected.',
        details: { databasePath },
      });
    }

    if (!isPathInsideDirectory(databasePath, isolatedRoot)) {
      blocked.push({
        code: 'isolated_write_database_not_under_isolated_root',
        message:
          'DATABASE_URL must point to a SQLite copy under the configured isolated backfill root.',
        details: {
          databasePath,
          isolatedRoot,
          rootEnv: ISOLATED_BACKFILL_ROOT_ENV,
        },
      });
    }

    const confirmedBy =
      options.confirmIsolatedDb &&
      matchConfirmedDatabase(options.confirmIsolatedDb, databasePath);
    if (!confirmedBy) {
      blocked.push({
        code: 'isolated_write_confirmation_mismatch',
        message:
          '--confirm-isolated-db must match the isolated database file name or absolute path.',
        details: {
          databasePath,
          confirmed: options.confirmIsolatedDb,
        },
      });
    }
  }

  if (blocked.length > 0) {
    blocked.unshift({
      code: 'write_not_enabled_without_isolated_gate',
      message:
        '--write is fail-closed unless the explicit M8.2.3B isolated database gate is satisfied.',
    });
  }

  return { allowed: blocked.length === 0, blocked };
}

function resolveIsolatedBackfillRoot(env: NodeJS.ProcessEnv): string {
  const configuredRoot = env[ISOLATED_BACKFILL_ROOT_ENV]?.trim();
  const rawRoot =
    configuredRoot && configuredRoot.length > 0
      ? configuredRoot
      : DEFAULT_ISOLATED_BACKFILL_ROOT;
  const withoutScheme = rawRoot.startsWith('file:')
    ? rawRoot.slice('file:'.length)
    : rawRoot;

  return path.normalize(
    path.isAbsolute(withoutScheme)
      ? withoutScheme
      : path.resolve(process.cwd(), withoutScheme)
  );
}

function resolveSqliteDatabasePathFromUrl(
  rawUrl: string | undefined
): string | null {
  const resolvedUrl = resolveSqliteDatabaseUrl(rawUrl);
  if (!resolvedUrl.startsWith('file:')) return null;

  const rawPath = resolvedUrl.slice('file:'.length).trim();
  if (rawPath.length === 0) return null;
  return path.normalize(rawPath);
}

function isKnownProductionDatabasePath(databasePath: string): boolean {
  const normalized = path.normalize(databasePath);
  const knownExactPaths = [
    '/app/prisma/data/portfolio.db',
    '/root/tracker/Unified.Holdings.Tracker-server/apps/backend/prisma/data/portfolio.db',
    '/root/tracker/Unified.Holdings.Tracker-server/prisma/data/portfolio.db',
  ].map((item) => path.normalize(item));

  return (
    knownExactPaths.includes(normalized) ||
    normalized.endsWith(
      path.normalize('/apps/backend/prisma/data/portfolio.db')
    )
  );
}

function isPathInsideDirectory(childPath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

function matchConfirmedDatabase(
  confirmed: string,
  databasePath: string
): 'database-name' | 'database-path' | null {
  const trimmed = confirmed.trim();
  if (trimmed.length === 0) return null;

  const withoutScheme = trimmed.startsWith('file:')
    ? trimmed.slice('file:'.length)
    : trimmed;
  if (!withoutScheme.includes('/') && !withoutScheme.includes('\\')) {
    return withoutScheme === path.basename(databasePath)
      ? 'database-name'
      : null;
  }

  const normalizedConfirmed = path.normalize(
    path.isAbsolute(withoutScheme)
      ? withoutScheme
      : path.resolve(process.cwd(), withoutScheme)
  );
  return normalizedConfirmed === databasePath ? 'database-path' : null;
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
    'allow-isolated-write',
    'allow-fact-write',
    'allow-source-fetch',
    'confirm-isolated-db',
  ].includes(value);
}

function isBooleanCliFlag(flag: ParsedCliFlag): boolean {
  return [
    'dry-run',
    'write',
    'fail-on-missing-config',
    'allow-isolated-write',
    'allow-fact-write',
    'allow-source-fetch',
  ].includes(flag);
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

function shiftIsoDate(date: string, deltaDays: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted.toISOString().slice(0, 10);
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

function yieldCurveCountryTenorKey(country: string, tenor: string): string {
  return `${country}:${tenor}`;
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

const NOOP_SOURCE_GATEWAY_REPOSITORY: SourceGatewayRepository = {
  async recordSourceRun() {
    return undefined;
  },
  async upsertSourceHealth() {
    return undefined;
  },
};

async function loadDefaultDependencies(): Promise<BackfillSourceDataDependencies> {
  await import('../config/env');
  const { PrismaClient } = await import('@prisma/client');
  const { createProductionYieldCurveGateway } = await import(
    '../services/sourceGateway/adapters/yieldCurve'
  );
  const { runMacroProductionFetch } = await import(
    '../services/sourceGateway/adapters/macro'
  );
  const prisma = new PrismaClient({
    datasources: {
      db: { url: resolveSqliteDatabaseUrl(process.env.DATABASE_URL) },
    },
  });
  const yieldCurveGateway = createProductionYieldCurveGateway({
    repository: NOOP_SOURCE_GATEWAY_REPOSITORY,
    retryPolicy: { maxAttempts: 1 },
  });

  return {
    prisma: prisma as unknown as BackfillSourceDataPrisma,
    env: process.env,
    now: () => new Date(),
    klineFetcher: async (...args) => {
      const { fetchKline } = await import('../services/tencentApi');
      return (fetchKline as BackfillKlineFetcher)(...args);
    },
    fxHistoryFetcher: fetchExchangeRatesHistory,
    yieldCurveGateway,
    macroProductionFetcher: (request) =>
      runMacroProductionFetch(request, {
        gatewayRepository: NOOP_SOURCE_GATEWAY_REPOSITORY,
        retryPolicy: { maxAttempts: 1 },
      }),
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

async function writeCliStream(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  content: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onComplete = (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    stream.write(
      content,
      onComplete as (error: Error | null | undefined) => void
    );
  });
}

function buildCliErrorReport(error: unknown): string {
  return `${JSON.stringify(
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
  )}\n`;
}

export async function runBackfillSourceDataCli(
  argv: string[],
  dependenciesFactory: () => Promise<BackfillSourceDataDependencies> = loadDefaultDependencies,
  io: BackfillSourceDataCliIo = {}
): Promise<number> {
  const options = parseBackfillSourceDataArgs(argv);
  const dependencies = await dependenciesFactory();
  const stdout = io.stdout ?? process.stdout;
  try {
    const report = await runBackfillSourceData(options, dependencies);
    await writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`);
    return getBackfillSourceDataExitCode(report);
  } finally {
    await dependencies.prisma.$disconnect?.();
  }
}

if (require.main === module) {
  (async () => {
    try {
      const exitCode = await runBackfillSourceDataCli(process.argv.slice(2));
      process.exit(exitCode);
    } catch (error) {
      try {
        await writeCliStream(process.stderr, buildCliErrorReport(error));
      } finally {
        process.exit(1);
      }
    }
  })();
}
