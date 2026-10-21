import schedule from 'node-schedule';
import { container } from '../../container';
import { prisma } from '../../lib/prisma';
import { Transaction, TransactionType } from '../../types';
import { getExchangeRate } from '../currencyService';
import { portfolioStatsService } from '../portfolioStatsService';
import {
  computeDividendEntitlements,
  resolveDividendTaxRates,
  toBeijingDate,
} from './dividendEntitlement';
import { DividendHttpGet, fetchDividendEvents } from './dividendSources';
import {
  DividendEntitlement,
  DividendEvent,
  DividendSettlementStatus,
  DividendTaxRates,
  DividendWarning,
} from './types';

/** 列表里每条分红的处理状态 */
export type DividendItemState =
  | DividendSettlementStatus
  /** 本次同步（或 dry-run 时将会）入账 */
  | 'TO_SETTLE'
  /** 未到派息日 / 未除权 */
  | 'PENDING'
  /** 早于自动入账窗口的历史分红，需一次性补录 */
  | 'BACKFILL_AVAILABLE';

export interface DividendReportItem extends DividendEntitlement {
  assetName: string | null;
  state: DividendItemState;
  transactionId: string | null;
  exchangeRate: number | null;
  amountCny: number | null;
}

export interface DividendReport {
  portfolioId: string;
  generatedAt: string;
  today: string;
  dryRun: boolean;
  taxRates: DividendTaxRates;
  items: DividendReportItem[];
  created: number;
  matched: number;
  warnings: DividendWarning[];
}

export interface DividendSyncOptions {
  dryRun?: boolean;
  /** 只入账派息日不早于此日的分红；省略则入账全部可入账分红 */
  payDateFrom?: string;
  today?: string;
}

interface SettlementRow {
  eventKey: string;
  status: DividendSettlementStatus;
  transactionId: string | null;
  amountCny: unknown;
}

/** 自动入账窗口：调度只处理最近 30 天派息的分红，更早的需在页面上确认补录 */
export const AUTO_SETTLE_WINDOW_DAYS = 30;
const EVENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** 手工记录的分红：同资产、除权日前 3 天至派息日后 30 天内的 DIVIDEND 视为同一笔 */
const MANUAL_MATCH_BEFORE_DAYS = 3;
const MANUAL_MATCH_AFTER_DAYS = 30;
export const AUTO_DIVIDEND_NOTE_PREFIX = '自动分红';

const eventCache = new Map<
  string,
  {
    expiresAt: number;
    value: { events: DividendEvent[]; warnings: DividendWarning[] };
  }
>();
const runningPortfolios = new Set<string>();

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  HKD: 'HK$',
  USD: 'US$',
};

function money(currency: string, value: number): string {
  return `${CURRENCY_SYMBOL[currency] ?? currency}${value.toFixed(2)}`;
}

export function buildAutoDividendNote(item: DividendEntitlement): string {
  const { event } = item;
  const tax =
    item.taxRate > 0
      ? `，预扣${Math.round(item.taxRate * 1000) / 10}%（${money(event.currency, item.taxAmount)}）`
      : '';
  return (
    `${AUTO_DIVIDEND_NOTE_PREFIX}｜${event.description}；${item.quantity}股 × ${event.cashPerShare} = ` +
    `税前${money(event.currency, item.grossAmount)}${tax}，到账${money(event.currency, item.netAmount)}` +
    `｜除权${event.exDate} 派息${event.payDate ?? '待定'}`
  );
}

async function loadEvents(
  assetCode: string,
  httpGet?: DividendHttpGet
): Promise<{ events: DividendEvent[]; warnings: DividendWarning[] }> {
  const cached = eventCache.get(assetCode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchDividendEvents(assetCode, httpGet);
  eventCache.set(assetCode, {
    expiresAt: Date.now() + EVENT_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function resolvePayDateRate(
  currency: string,
  payDate: string,
  warnings: DividendWarning[],
  assetCode: string
): Promise<number> {
  if (currency === 'CNY') return 1;
  const pair = `${currency}-CNY`;
  const rows = await prisma.$queryRawUnsafe<Array<{ rate: unknown }>>(
    `SELECT "rate" FROM "ExchangeRateSnapshot"
      WHERE "pair" = ? AND "date" <= ? AND "rate" IS NOT NULL
      ORDER BY "date" DESC LIMIT 1`,
    pair,
    payDate
  );
  const historical = Number(rows[0]?.rate);
  if (Number.isFinite(historical) && historical > 0) return historical;

  const current = getExchangeRate(pair);
  if (current === null || !(current > 0)) {
    throw new Error(`缺少 ${pair} 汇率，无法折算 ${assetCode} 分红`);
  }
  warnings.push({
    code: 'dividend_fx_fallback',
    assetCode,
    message: `${assetCode} 派息日 ${payDate} 无历史 ${pair} 汇率，按当前汇率 ${current} 折算`,
  });
  return current;
}

function findManualMatch(
  item: DividendEntitlement,
  transactions: Transaction[],
  linkedTransactionIds: Set<string>
): Transaction | null {
  const from = shiftDate(item.event.exDate, -MANUAL_MATCH_BEFORE_DAYS);
  const to = shiftDate(
    item.event.payDate ?? item.event.exDate,
    MANUAL_MATCH_AFTER_DAYS
  );
  return (
    transactions.find((tx) => {
      if (tx.type !== TransactionType.DIVIDEND) return false;
      if (tx.assetCode !== item.event.assetCode) return false;
      if (linkedTransactionIds.has(tx.id)) return false;
      const date = toBeijingDate(tx.date);
      return date >= from && date <= to;
    }) ?? null
  );
}

async function insertSettlement(
  portfolioId: string,
  item: DividendEntitlement,
  status: DividendSettlementStatus,
  transactionId: string,
  exchangeRate: number | null,
  amountCny: number | null
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "DividendSettlement" (
        "portfolioId", "eventKey", "assetCode", "exDate", "payDate", "status",
        "transactionId", "quantity", "cashPerShare", "currency", "grossAmount",
        "taxAmount", "netAmount", "amountCny", "sourceId"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    portfolioId,
    item.eventKey,
    item.event.assetCode,
    item.event.exDate,
    item.event.payDate,
    status,
    transactionId,
    item.quantity,
    item.event.cashPerShare,
    item.event.currency,
    item.grossAmount,
    item.taxAmount,
    item.netAmount,
    amountCny ?? (exchangeRate ? item.netAmount * exchangeRate : null),
    item.event.sourceId
  );
}

/**
 * 计算并（非 dry-run 时）入账组合的现金分红。
 * 幂等：每个分红事件在 DividendSettlement 中只登记一次；被用户删除的自动分红标记为 DISMISSED，不再重建。
 */
export async function syncPortfolioDividends(
  portfolioId: string,
  options: DividendSyncOptions = {},
  httpGet?: DividendHttpGet
): Promise<DividendReport> {
  const dryRun = options.dryRun ?? false;
  if (!dryRun && runningPortfolios.has(portfolioId)) {
    throw new Error(`组合 ${portfolioId} 的分红同步正在进行`);
  }
  if (!dryRun) runningPortfolios.add(portfolioId);

  try {
    const today = options.today ?? toBeijingDate(new Date());
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      throw new Error(`Portfolio not found: ${portfolioId}`);
    }
    const transactions = portfolio.transactions ?? [];
    const taxRates = resolveDividendTaxRates();
    const warnings: DividendWarning[] = [];

    const assetCodes = Array.from(
      new Set(
        transactions
          .filter(
            (tx) =>
              tx.assetCode &&
              (tx.type === TransactionType.BUY ||
                tx.type === TransactionType.SELL)
          )
          .map((tx) => tx.assetCode as string)
      )
    ).sort();

    const events: DividendEvent[] = [];
    for (const assetCode of assetCodes) {
      try {
        const loaded = await loadEvents(assetCode, httpGet);
        events.push(...loaded.events);
        warnings.push(...loaded.warnings);
      } catch (error) {
        warnings.push({
          code: 'dividend_source_failed',
          assetCode,
          message: `${assetCode} 分红数据获取失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const computed = computeDividendEntitlements({
      transactions,
      events,
      today,
      taxRates,
    });
    warnings.push(...computed.warnings);

    const settlements = await prisma.$queryRawUnsafe<SettlementRow[]>(
      `SELECT "eventKey", "status", "transactionId", "amountCny" FROM "DividendSettlement" WHERE "portfolioId" = ?`,
      portfolioId
    );
    const assetNames = new Map(
      (
        await prisma.$queryRawUnsafe<Array<{ code: string; name: string }>>(
          `SELECT "code", "name" FROM "Asset"`
        )
      ).map((row) => [row.code, row.name])
    );
    const settlementByKey = new Map(
      settlements.map((row) => [row.eventKey, row])
    );
    const linkedTransactionIds = new Set(
      settlements
        .map((row) => row.transactionId)
        .filter((id): id is string => Boolean(id))
    );

    const items: DividendReportItem[] = [];
    let created = 0;
    let matched = 0;
    // 仓储返回的交易列表可能按日期重排，补录的历史分红不一定在末尾，按 id 差集找新交易
    const knownTransactionIds = new Set(transactions.map((tx) => tx.id));

    for (const entitlement of computed.entitlements) {
      const assetName = assetNames.get(entitlement.event.assetCode) ?? null;
      const existing = settlementByKey.get(entitlement.eventKey);
      if (existing) {
        const amountCny = Number(existing.amountCny);
        items.push({
          ...entitlement,
          assetName,
          state: existing.status,
          transactionId: existing.transactionId,
          exchangeRate: null,
          amountCny: Number.isFinite(amountCny) ? amountCny : null,
        });
        continue;
      }

      if (entitlement.status !== 'PAYABLE') {
        items.push({
          ...entitlement,
          assetName,
          state: 'PENDING',
          transactionId: null,
          exchangeRate: null,
          amountCny: null,
        });
        continue;
      }

      const manual = findManualMatch(
        entitlement,
        transactions,
        linkedTransactionIds
      );
      if (manual) {
        if (!dryRun) {
          await insertSettlement(
            portfolioId,
            entitlement,
            'MATCHED_MANUAL',
            manual.id,
            null,
            Number(manual.amount ?? 0)
          );
          linkedTransactionIds.add(manual.id);
          matched++;
        }
        items.push({
          ...entitlement,
          assetName,
          state: 'MATCHED_MANUAL',
          transactionId: manual.id,
          exchangeRate: manual.exchangeRate ?? null,
          amountCny: Number(manual.amount ?? 0),
        });
        continue;
      }

      const payDate = entitlement.event.payDate as string;
      if (options.payDateFrom && payDate < options.payDateFrom) {
        items.push({
          ...entitlement,
          assetName,
          state: 'BACKFILL_AVAILABLE',
          transactionId: null,
          exchangeRate: null,
          amountCny: null,
        });
        continue;
      }

      const exchangeRate = await resolvePayDateRate(
        entitlement.event.currency,
        payDate,
        warnings,
        entitlement.event.assetCode
      );
      const amountCny =
        Math.round(entitlement.netAmount * exchangeRate * 100) / 100;

      let transactionId: string | null = null;
      if (!dryRun) {
        const updated = await container.addTransactionUseCase.execute({
          portfolioId,
          transaction: {
            type: TransactionType.DIVIDEND,
            // 派息日北京时间中午，避免时区换算跨日
            date: new Date(`${payDate}T12:00:00+08:00`).toISOString(),
            assetCode: entitlement.event.assetCode,
            amount: entitlement.netAmount,
            currency: entitlement.event.currency,
            exchangeRate,
            notes: buildAutoDividendNote(entitlement),
          },
        });
        const createdTx = updated.transactions.find(
          (tx) => !knownTransactionIds.has(tx.id)
        );
        if (
          !createdTx ||
          createdTx.type !== TransactionType.DIVIDEND ||
          createdTx.assetCode !== entitlement.event.assetCode
        ) {
          throw new Error(
            `${entitlement.event.assetCode} ${entitlement.event.exDate} 分红入账后未找到新交易`
          );
        }
        knownTransactionIds.add(createdTx.id);
        transactionId = createdTx.id;
        await insertSettlement(
          portfolioId,
          entitlement,
          'SETTLED',
          transactionId,
          exchangeRate,
          amountCny
        );
        linkedTransactionIds.add(transactionId);
        created++;
      }

      items.push({
        ...entitlement,
        assetName,
        state: dryRun ? 'TO_SETTLE' : 'SETTLED',
        transactionId,
        exchangeRate,
        amountCny,
      });
    }

    if (created > 0 || matched > 0) {
      portfolioStatsService.clearCache(portfolioId);
    }

    return {
      portfolioId,
      generatedAt: new Date().toISOString(),
      today,
      dryRun,
      taxRates,
      items,
      created,
      matched,
      warnings,
    };
  } finally {
    if (!dryRun) runningPortfolios.delete(portfolioId);
  }
}

/** 用户删除一笔自动/匹配的分红交易后，记为 DISMISSED，以后不再自动入账 */
export async function dismissDividendSettlementByTransaction(
  portfolioId: string,
  transactionId: string
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "DividendSettlement"
        SET "status" = 'DISMISSED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "portfolioId" = ? AND "transactionId" = ?`,
    portfolioId,
    transactionId
  );
}

// ==================== 定时任务 ====================

let dailyJob: schedule.Job | null = null;
let startupTimer: NodeJS.Timeout | null = null;

export function isDividendAutoSettleEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.UHT_DIVIDEND_AUTO_SETTLE !== '0';
}

async function settleRecentDividendsForAll(): Promise<void> {
  const today = toBeijingDate(new Date());
  const payDateFrom = shiftDate(today, -AUTO_SETTLE_WINDOW_DAYS);
  const portfolios = await container.listPortfoliosUseCase.execute();
  for (const portfolio of portfolios) {
    try {
      const report = await syncPortfolioDividends(portfolio.id, {
        payDateFrom,
        today,
      });
      console.log(
        `[DividendService] ✅ ${portfolio.id}: 新入账 ${report.created} 笔，匹配手工 ${report.matched} 笔，警告 ${report.warnings.length} 条`
      );
    } catch (error) {
      console.error(
        `[DividendService] ❌ 组合 ${portfolio.id} 分红同步失败:`,
        error
      );
    }
  }
}

/**
 * 每日 09:30（北京时间）入账最近 30 天派息的分红；启动 2 分钟后补跑一次。
 * UHT_DIVIDEND_AUTO_SETTLE=0 关闭。
 */
export function startDividendScheduler(): void {
  if (!isDividendAutoSettleEnabled()) {
    console.log(
      '[DividendService] 自动分红已关闭（UHT_DIVIDEND_AUTO_SETTLE=0）'
    );
    return;
  }
  dailyJob = schedule.scheduleJob(
    { rule: '30 9 * * *', tz: 'Asia/Shanghai' },
    () => void settleRecentDividendsForAll()
  );
  startupTimer = setTimeout(
    () => void settleRecentDividendsForAll(),
    2 * 60 * 1000
  );
  startupTimer.unref();
  console.log(
    '[DividendService] ✅ Dividend scheduler started: "30 9 * * *" (Asia/Shanghai)'
  );
}

export function stopDividendScheduler(): void {
  dailyJob?.cancel();
  dailyJob = null;
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
}

export function clearDividendEventCache(): void {
  eventCache.clear();
}
