/**
 * 组合快照服务
 * - 每日定时存储组合级别资产快照
 * - 提供快照查询接口
 * - 提供周报数据生成
 */

import schedule from 'node-schedule';
import { prisma } from '../lib/prisma';
import { container } from '../container';
import { portfolioStatsService } from './portfolioStatsService';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfYear,
  subWeeks,
  subDays,
} from 'date-fns';
import type { Portfolio, Position } from '../types';
import { calculateLeverageCostByDay } from './calculation';
import { calculatePeriodStats } from './calculation/period-stats';
import { fetchKline, fetchQuotes } from './tencentApi';
import {
  getExchangeRateForAssetToCNY,
  getExchangeRateInfo,
} from './currencyService';

type SnapshotDbClient = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(
    query: string,
    ...values: unknown[]
  ) => Promise<T>;
};

type ExchangeRateSnapshotInput = {
  pair: 'USD-CNY' | 'HKD-CNY';
  rate: number | null;
  source: string | null;
};

type QuoteSnapshotCandidate = {
  assetCode: string;
  date: string;
  timestamp: string;
  currentPrice: number;
  changePercent: number | null;
  changeAmount: number | null;
  prevClosePrice: number | null;
  weeklyChangePercent: number | null;
  monthlyChangePercent: number | null;
  yearlyChangePercent: number | null;
};

type IndexSnapshotCandidate = {
  date: string;
  indexCode: string;
  name: string;
  currentPrice: number;
  changeAmount: number | null;
  changePercent: number | null;
  weeklyChangePercent: number | null;
  monthlyChangePercent: number | null;
  yearlyChangePercent: number | null;
};

const INDEX_CODES = [
  'sh000001',
  'sz399001',
  'hkHSI',
  'usDJI',
  'usIXIC',
  'usINX',
] as const;

const INDEX_NAMES: Record<string, string> = {
  sh000001: '上证指数',
  sz399001: '深证成指',
  hkHSI: '恒生指数',
  usDJI: '道琼斯',
  usIXIC: '纳斯达克',
  usINX: '标普500',
};

// ==================== Webhook 告警 ====================

async function sendSnapshotAlert(message: string): Promise<void> {
  const webhookUrl = process.env.SNAPSHOT_ALERT_WEBHOOK;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'snapshot_failure',
        message,
        timestamp: new Date().toISOString(),
        source: 'uht-snapshot-service',
      }),
    });
  } catch (e) {
    console.error('[SnapshotService] Webhook delivery failed:', e);
  }
}

// ==================== 快照存储 ====================

/**
 * 快照日期 = 前一个日历日（即前一交易日）
 * 因为快照在早晨 06:30 执行，记录的是昨天的收盘数据
 */
function getSnapshotDate(): string {
  return format(subDays(new Date(), 1), 'yyyy-MM-dd');
}

function toSafeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getSnapshotTimestamp(snapshotDate: string): string {
  return new Date(`${snapshotDate}T15:00:00+08:00`).toISOString();
}

function isForeignAssetCode(assetCode: string): boolean {
  const lowerCode = assetCode.toLowerCase();
  return lowerCode.startsWith('hk') || lowerCode.startsWith('us');
}

async function resolveSnapshotFxRate(
  assetCode: string
): Promise<number | null> {
  if (!isForeignAssetCode(assetCode)) {
    return 1;
  }

  try {
    const rate = await getExchangeRateForAssetToCNY(assetCode);
    if (Number.isFinite(rate) && rate > 0) {
      return rate;
    }
  } catch (error) {
    console.warn(
      `[SnapshotService] Failed to resolve FX rate for ${assetCode}:`,
      error
    );
  }

  return null;
}

async function findDailyClosePrice(
  assetCode: string,
  snapshotDate: string
): Promise<number | null> {
  const points = await fetchKline(
    assetCode,
    'daily',
    snapshotDate,
    snapshotDate,
    'none',
    30
  );

  const target = points.find((point) => point.date === snapshotDate);
  const closePrice = target?.close;
  if (!Number.isFinite(closePrice) || !closePrice || closePrice <= 0) {
    return null;
  }

  return closePrice;
}

function calculateSnapshotLeverageCumulativeCost(
  portfolio: Portfolio,
  snapshotDate: string
): number | null {
  const transactions = portfolio.transactions ?? [];
  if (transactions.length === 0) {
    return 0;
  }

  const firstTxDate = transactions.reduce((earliest, current) => {
    const currentTs = new Date(current.date);
    return currentTs < earliest ? currentTs : earliest;
  }, new Date(transactions[0].date));

  const endDate = new Date(`${snapshotDate}T23:59:59.999+08:00`);
  if (Number.isNaN(firstTxDate.getTime()) || Number.isNaN(endDate.getTime())) {
    console.warn(
      `[SnapshotService] Invalid leverage cost date range: snapshotDate=${snapshotDate}`
    );
    return null;
  }

  return calculateLeverageCostByDay(portfolio, firstTxDate, endDate);
}

function buildExchangeRateSnapshotInputs(
  snapshotDate: string
): ExchangeRateSnapshotInput[] {
  return (['USD-CNY', 'HKD-CNY'] as const).map((pair) => {
    const info = getExchangeRateInfo(pair);
    if (!info || !Number.isFinite(info.rate) || info.rate <= 0) {
      console.warn(
        `[SnapshotService] Exchange rate snapshot unavailable for ${pair}, writing null`
      );
      return {
        pair,
        rate: null,
        source: null,
      };
    }

    return {
      pair,
      rate: info.rate,
      source: `cache:${info.timestamp ?? getSnapshotTimestamp(snapshotDate)}`,
    };
  });
}

function buildQuoteSnapshotCandidates(
  positions: Position[],
  snapshotDate: string
): QuoteSnapshotCandidate[] {
  const timestamp = getSnapshotTimestamp(snapshotDate);

  return positions
    .map((position) => {
      const currentPrice = toNullableNumber(position.currentPrice);
      if (currentPrice === null || currentPrice <= 0) {
        return null;
      }

      const quantity = Number(position.quantity ?? 0);
      const dailyChangeLocal = toNullableNumber(position.dailyChangeLocal);
      const changeAmount =
        dailyChangeLocal !== null && quantity > 0
          ? dailyChangeLocal / quantity
          : null;
      const prevClosePrice =
        changeAmount !== null ? currentPrice - changeAmount : null;

      return {
        assetCode: position.asset.code,
        date: snapshotDate,
        timestamp,
        currentPrice,
        changePercent: toNullableNumber(position.dailyChangePercent),
        changeAmount,
        prevClosePrice,
        weeklyChangePercent: toNullableNumber(position.weeklyChangePercent),
        monthlyChangePercent: toNullableNumber(position.monthlyChangePercent),
        yearlyChangePercent: toNullableNumber(position.yearlyChangePercent),
      } satisfies QuoteSnapshotCandidate;
    })
    .filter(
      (candidate): candidate is QuoteSnapshotCandidate => candidate !== null
    );
}

async function upsertPortfolioSnapshot(
  db: SnapshotDbClient,
  params: {
    portfolioId: string;
    date: string;
    totalMarketValue: number;
    netAssets: number;
    totalPnl: number;
    dailyPnl: number;
    cash: number;
    leverageUsed: number | null;
    leverageTotal: number | null;
    leverageCostRate: number | null;
    leverageCumulativeCost: number | null;
    usdCny: number | null;
    hkdCny: number | null;
    realizedPnl: number | null;
    unrealizedPnl: number | null;
    totalCommission: number | null;
    netDepositedCash: number | null;
    totalDividendIncome: number | null;
    totalPnlPercent: number | null;
    dailyPnlPercent: number | null;
    weeklyReturnPercent: number | null;
    weeklyReturnValue: number | null;
    weeklyBaseDate: string | null;
    monthlyReturnPercent: number | null;
    monthlyReturnValue: number | null;
    monthlyBaseDate: string | null;
    yearlyReturnPercent: number | null;
    yearlyReturnValue: number | null;
    yearlyBaseDate: string | null;
  }
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO "PortfolioSnapshot"
       ("portfolioId", "date", "totalMarketValue", "netAssets", "totalPnl", "dailyPnl", "cash",
        "leverageUsed", "leverageTotal", "leverageCostRate", "leverageCumulativeCost", "usdCny", "hkdCny",
        "realizedPnl", "unrealizedPnl", "totalCommission", "netDepositedCash", "totalDividendIncome",
        "totalPnlPercent", "dailyPnlPercent",
        "weeklyReturnPercent", "weeklyReturnValue", "weeklyBaseDate",
        "monthlyReturnPercent", "monthlyReturnValue", "monthlyBaseDate",
        "yearlyReturnPercent", "yearlyReturnValue", "yearlyBaseDate",
        "createdAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT ("portfolioId", "date") DO UPDATE SET
       "totalMarketValue"       = excluded."totalMarketValue",
       "netAssets"              = excluded."netAssets",
       "totalPnl"               = excluded."totalPnl",
       "dailyPnl"               = excluded."dailyPnl",
       "cash"                   = excluded."cash",
       "leverageUsed"           = excluded."leverageUsed",
       "leverageTotal"          = excluded."leverageTotal",
       "leverageCostRate"       = excluded."leverageCostRate",
       "leverageCumulativeCost" = excluded."leverageCumulativeCost",
       "usdCny"                 = excluded."usdCny",
       "hkdCny"                 = excluded."hkdCny",
       "realizedPnl"            = excluded."realizedPnl",
       "unrealizedPnl"          = excluded."unrealizedPnl",
       "totalCommission"        = excluded."totalCommission",
       "netDepositedCash"       = excluded."netDepositedCash",
       "totalDividendIncome"    = excluded."totalDividendIncome",
       "totalPnlPercent"        = excluded."totalPnlPercent",
       "dailyPnlPercent"        = excluded."dailyPnlPercent",
       "weeklyReturnPercent"    = excluded."weeklyReturnPercent",
       "weeklyReturnValue"      = excluded."weeklyReturnValue",
       "weeklyBaseDate"         = excluded."weeklyBaseDate",
       "monthlyReturnPercent"   = excluded."monthlyReturnPercent",
       "monthlyReturnValue"     = excluded."monthlyReturnValue",
       "monthlyBaseDate"        = excluded."monthlyBaseDate",
       "yearlyReturnPercent"    = excluded."yearlyReturnPercent",
       "yearlyReturnValue"      = excluded."yearlyReturnValue",
       "yearlyBaseDate"         = excluded."yearlyBaseDate",
       "createdAt"              = CURRENT_TIMESTAMP`,
    params.portfolioId,
    params.date,
    params.totalMarketValue,
    params.netAssets,
    params.totalPnl,
    params.dailyPnl,
    params.cash,
    params.leverageUsed,
    params.leverageTotal,
    params.leverageCostRate,
    params.leverageCumulativeCost,
    params.usdCny,
    params.hkdCny,
    params.realizedPnl,
    params.unrealizedPnl,
    params.totalCommission,
    params.netDepositedCash,
    params.totalDividendIncome,
    params.totalPnlPercent,
    params.dailyPnlPercent,
    params.weeklyReturnPercent,
    params.weeklyReturnValue,
    params.weeklyBaseDate,
    params.monthlyReturnPercent,
    params.monthlyReturnValue,
    params.monthlyBaseDate,
    params.yearlyReturnPercent,
    params.yearlyReturnValue,
    params.yearlyBaseDate
  );
}

async function upsertPositionSnapshot(
  db: SnapshotDbClient,
  portfolioId: string,
  date: string,
  pos: Position
): Promise<void> {
  const totalCost = toSafeNumber(pos.totalCost);
  const floatingPnl =
    toNullableNumber(pos.floatingPnl) ??
    (totalCost > 0 ? toSafeNumber(pos.marketValue) - totalCost : null);
  const floatingPnlPercent =
    toNullableNumber(pos.floatingPnlPercent) ??
    (floatingPnl !== null && totalCost > 0
      ? (floatingPnl / totalCost) * 100
      : null);
  const totalPnlPercent =
    toNullableNumber(pos.totalPnlPercent) ??
    (pos.totalBuyCost && pos.totalBuyCost > 0 && pos.totalPnl != null
      ? (toSafeNumber(pos.totalPnl) / pos.totalBuyCost) * 100
      : null);

  await db.$executeRawUnsafe(
    `INSERT INTO "PositionSnapshot"
       ("portfolioId", "date", "assetCode", "quantity", "currentPrice", "marketValue",
        "costPrice", "totalPnl", "dailyPnl", "dailyPct",
        "totalPnlPercent", "floatingPnl", "floatingPnlPercent")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT ("portfolioId", "date", "assetCode") DO UPDATE SET
       "quantity"          = excluded."quantity",
       "currentPrice"      = excluded."currentPrice",
       "marketValue"       = excluded."marketValue",
       "costPrice"         = excluded."costPrice",
       "totalPnl"          = excluded."totalPnl",
       "dailyPnl"          = excluded."dailyPnl",
       "dailyPct"          = excluded."dailyPct",
       "totalPnlPercent"   = excluded."totalPnlPercent",
       "floatingPnl"       = excluded."floatingPnl",
       "floatingPnlPercent" = excluded."floatingPnlPercent"`,
    portfolioId,
    date,
    pos.asset.code,
    pos.quantity,
    pos.currentPrice ?? 0,
    pos.marketValue ?? 0,
    toNullableNumber(pos.costPrice),
    toNullableNumber(pos.totalPnl),
    toNullableNumber(pos.dailyChange),
    toNullableNumber(pos.dailyChangePercent),
    totalPnlPercent,
    floatingPnl,
    floatingPnlPercent
  );
}

async function upsertExchangeRateSnapshot(
  db: SnapshotDbClient,
  snapshotDate: string,
  snapshot: ExchangeRateSnapshotInput
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO "ExchangeRateSnapshot"
       ("date", "pair", "rate", "source", "createdAt")
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT ("date", "pair") DO UPDATE SET
       "rate"      = excluded."rate",
       "source"    = excluded."source",
       "createdAt" = CURRENT_TIMESTAMP`,
    snapshotDate,
    snapshot.pair,
    snapshot.rate,
    snapshot.source
  );
}

async function buildIndexSnapshotCandidates(
  snapshotDate: string
): Promise<IndexSnapshotCandidate[]> {
  const codes = [...INDEX_CODES];
  try {
    const quotes = await fetchQuotes(codes);
    return quotes
      .map((q) => {
        const name = INDEX_NAMES[q.code] ?? q.name ?? q.code;
        const currentPrice = toNullableNumber(q.currentPrice);
        if (currentPrice === null || currentPrice <= 0) {
          return null;
        }
        return {
          date: snapshotDate,
          indexCode: q.code,
          name,
          currentPrice,
          changeAmount: toNullableNumber(q.changeAmount),
          changePercent: toNullableNumber(q.changePercent),
          weeklyChangePercent: toNullableNumber(q.weeklyChangePercent),
          monthlyChangePercent: toNullableNumber(q.monthlyChangePercent),
          yearlyChangePercent: toNullableNumber(q.yearlyChangePercent),
        } satisfies IndexSnapshotCandidate;
      })
      .filter((c): c is IndexSnapshotCandidate => c !== null);
  } catch (error) {
    console.warn(
      '[SnapshotService] Failed to fetch index quotes for IndexSnapshot:',
      error
    );
    return [];
  }
}

async function tryWriteIndexSnapshots(
  db: SnapshotDbClient,
  snapshots: IndexSnapshotCandidate[]
): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }
  try {
    for (const s of snapshots) {
      await db.$executeRawUnsafe(
        `INSERT INTO "IndexSnapshot"
           ("date", "indexCode", "name", "currentPrice", "changeAmount", "changePercent",
            "weeklyChangePercent", "monthlyChangePercent", "yearlyChangePercent", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT ("date", "indexCode") DO UPDATE SET
           "name"                = excluded."name",
           "currentPrice"        = excluded."currentPrice",
           "changeAmount"        = excluded."changeAmount",
           "changePercent"       = excluded."changePercent",
           "weeklyChangePercent" = excluded."weeklyChangePercent",
           "monthlyChangePercent" = excluded."monthlyChangePercent",
           "yearlyChangePercent" = excluded."yearlyChangePercent",
           "createdAt"           = CURRENT_TIMESTAMP`,
        s.date,
        s.indexCode,
        s.name,
        s.currentPrice,
        s.changeAmount,
        s.changePercent,
        s.weeklyChangePercent,
        s.monthlyChangePercent,
        s.yearlyChangePercent
      );
    }
    console.log(
      `[SnapshotService] ✅ IndexSnapshot written: ${snapshots.map((s) => s.indexCode).join(', ')}`
    );
  } catch (error) {
    console.warn(
      '[SnapshotService] Optional IndexSnapshot write failed, keep main snapshot committed.',
      error
    );
  }
}

async function tryWriteOptionalQuoteSnapshots(
  db: SnapshotDbClient,
  snapshots: QuoteSnapshotCandidate[]
): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  try {
    for (const snapshot of snapshots) {
      await db.$executeRawUnsafe(
        `INSERT INTO "QuoteSnapshot"
           ("assetCode", "date", "timestamp", "currentPrice", "changePercent", "changeAmount", "prevClosePrice", "weeklyChangePercent", "monthlyChangePercent", "yearlyChangePercent", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT ("assetCode", "date") DO UPDATE SET
           "timestamp"           = excluded."timestamp",
           "currentPrice"        = excluded."currentPrice",
           "changePercent"       = excluded."changePercent",
           "changeAmount"        = excluded."changeAmount",
           "prevClosePrice"      = excluded."prevClosePrice",
           "weeklyChangePercent" = excluded."weeklyChangePercent",
           "monthlyChangePercent" = excluded."monthlyChangePercent",
           "yearlyChangePercent" = excluded."yearlyChangePercent",
           "createdAt"           = CURRENT_TIMESTAMP`,
        snapshot.assetCode,
        snapshot.date,
        snapshot.timestamp,
        snapshot.currentPrice,
        snapshot.changePercent,
        snapshot.changeAmount,
        snapshot.prevClosePrice,
        snapshot.weeklyChangePercent,
        snapshot.monthlyChangePercent,
        snapshot.yearlyChangePercent
      );
    }
  } catch (error) {
    console.warn(
      '[SnapshotService] Optional QuoteSnapshot write failed, keep main snapshot committed.',
      error
    );
  }
}

/**
 * Phase 4: 重跑 Modified Dietz 周度/月度（K 线 only，不使用实时报价）
 * 确保周期收益字段与 K 线收盘价对齐。
 */
async function correctPeriodStatsWithKline(params: {
  portfolioId: string;
  snapshotDate: string;
}): Promise<void> {
  const { portfolioId, snapshotDate } = params;
  try {
    const portfolio = await container.getPortfolioUseCase.execute({ portfolioId });
    if (!portfolio) {
      console.warn(
        `[SnapshotService] correctPeriodStatsWithKline: portfolio not found ${portfolioId}`
      );
      return;
    }

    const [weeklyStats, monthlyStats] = await Promise.all([
      calculatePeriodStats(portfolio, 'weekly', {
        useRealtimeEndValue: false,
        usePreCloseStartValue: false,
      }),
      calculatePeriodStats(portfolio, 'monthly', {
        useRealtimeEndValue: false,
        usePreCloseStartValue: false,
      }),
    ]);

    await prisma.$executeRawUnsafe(
      `UPDATE "PortfolioSnapshot"
          SET "weeklyReturnPercent"  = ?,
              "weeklyReturnValue"    = ?,
              "weeklyBaseDate"       = ?,
              "monthlyReturnPercent" = ?,
              "monthlyReturnValue"   = ?,
              "monthlyBaseDate"      = ?
        WHERE "portfolioId" = ?
          AND "date" = ?`,
      weeklyStats.periodReturnPercent ?? null,
      weeklyStats.totalValueChange ?? weeklyStats.periodPnl ?? null,
      weeklyStats.baseDate ?? null,
      monthlyStats.periodReturnPercent ?? null,
      monthlyStats.totalValueChange ?? monthlyStats.periodPnl ?? null,
      monthlyStats.baseDate ?? null,
      portfolioId,
      snapshotDate
    );

    console.log(
      `[SnapshotService] ✅ Period stats corrected (K-line only): portfolio=${portfolioId}, date=${snapshotDate}, ` +
        `weekly=${weeklyStats.periodReturnPercent?.toFixed(2)}%, monthly=${monthlyStats.periodReturnPercent?.toFixed(2)}%`
    );
  } catch (error) {
    console.warn(
      `[SnapshotService] correctPeriodStatsWithKline failed (non-fatal): portfolio=${portfolioId}, date=${snapshotDate}`,
      error
    );
  }
}

/**
 * Phase 5: IndexSnapshot K 线修正
 * 用 K 线收盘价替换 IndexSnapshot 中的实时报价字段。
 */
async function correctIndexSnapshotWithKline(snapshotDate: string): Promise<void> {
  const prevDate = format(subDays(new Date(`${snapshotDate}T12:00:00+08:00`), 1), 'yyyy-MM-dd');
  const yearStart = format(new Date(`${snapshotDate.slice(0, 4)}-01-01`), 'yyyy-MM-dd');
  // 月初：当月1日
  const monthStart = `${snapshotDate.slice(0, 8)}01`;
  // 上周收盘日（周五）：最简单的近似是取 snapshotDate 前7天内的最近 K 线
  const weekLookback = format(subDays(new Date(`${snapshotDate}T12:00:00+08:00`), 7), 'yyyy-MM-dd');

  for (const indexCode of INDEX_CODES) {
    try {
      const klineToday = await fetchKline(indexCode, 'daily', snapshotDate, snapshotDate, 'none', 5);
      const closeToday = klineToday.find((k) => k.date === snapshotDate)?.close;
      if (!closeToday || closeToday <= 0) {
        console.warn(
          `[SnapshotService] IndexSnapshot K-line not found for ${indexCode} on ${snapshotDate}, keeping original`
        );
        continue;
      }

      const klinePrev = await fetchKline(indexCode, 'daily', prevDate, snapshotDate, 'none', 5);
      const closePrev = klinePrev.filter((k) => k.date < snapshotDate).slice(-1)[0]?.close ?? null;
      const changeAmount = closePrev ? closeToday - closePrev : null;
      const changePercent = closePrev && closePrev > 0 ? (changeAmount! / closePrev) * 100 : null;

      // 周变化：取 weekLookback 到 snapshotDate 的 K 线
      const klineWeek = await fetchKline(indexCode, 'daily', weekLookback, snapshotDate, 'none', 10);
      const closeWeekBase = klineWeek.filter((k) => k.date < snapshotDate).slice(0, 1)[0]?.close ?? null;
      const weeklyChangePercent =
        closeWeekBase && closeWeekBase > 0 ? ((closeToday - closeWeekBase) / closeWeekBase) * 100 : null;

      // 月变化
      const klineMonth = await fetchKline(indexCode, 'daily', monthStart, snapshotDate, 'none', 30);
      const closeMonthBase = klineMonth.filter((k) => k.date < snapshotDate)[0]?.close ?? null;
      const monthlyChangePercent =
        closeMonthBase && closeMonthBase > 0
          ? ((closeToday - closeMonthBase) / closeMonthBase) * 100
          : null;

      // 年变化
      const klineYear = await fetchKline(indexCode, 'daily', yearStart, snapshotDate, 'none', 260);
      const closeYearBase = klineYear.filter((k) => k.date < snapshotDate)[0]?.close ?? null;
      const yearlyChangePercent =
        closeYearBase && closeYearBase > 0
          ? ((closeToday - closeYearBase) / closeYearBase) * 100
          : null;

      await prisma.$executeRawUnsafe(
        `UPDATE "IndexSnapshot"
            SET "currentPrice"         = ?,
                "changeAmount"         = ?,
                "changePercent"        = ?,
                "weeklyChangePercent"  = ?,
                "monthlyChangePercent" = ?,
                "yearlyChangePercent"  = ?
          WHERE "date" = ?
            AND "indexCode" = ?`,
        closeToday,
        changeAmount,
        changePercent,
        weeklyChangePercent,
        monthlyChangePercent,
        yearlyChangePercent,
        snapshotDate,
        indexCode
      );
    } catch (error) {
      console.warn(
        `[SnapshotService] correctIndexSnapshotWithKline failed for ${indexCode} on ${snapshotDate} (non-fatal):`,
        error
      );
    }
  }

  console.log(
    `[SnapshotService] ✅ IndexSnapshot corrected with K-line: date=${snapshotDate}`
  );
}

async function correctSnapshotWithKline(params: {
  portfolioId: string;
  snapshotDate: string;
}): Promise<void> {
  const { portfolioId, snapshotDate } = params;

  const snapshotRows = await prisma.$queryRawUnsafe<
    Array<{
      cash: unknown;
      totalMarketValue: unknown;
      netAssets: unknown;
      totalPnl: unknown;
      dailyPnl: unknown;
      leverageUsed: unknown;
      unrealizedPnl: unknown;
      netDepositedCash: unknown;
      dailyPnlPercent: unknown;
      yearlyReturnValue: unknown;
      yearlyReturnPercent: unknown;
    }>
  >(
    `SELECT "cash", "totalMarketValue", "netAssets", "totalPnl", "dailyPnl", "leverageUsed",
            "unrealizedPnl", "netDepositedCash", "dailyPnlPercent",
            "yearlyReturnValue", "yearlyReturnPercent"
       FROM "PortfolioSnapshot"
      WHERE "portfolioId" = ? AND "date" = ?
      LIMIT 1`,
    portfolioId,
    snapshotDate
  );

  const snapshot = snapshotRows[0];
  if (!snapshot) {
    console.warn(
      `[SnapshotService] Missing PortfolioSnapshot while correcting: portfolio=${portfolioId}, date=${snapshotDate}`
    );
    return;
  }

  const positionRows = await prisma.$queryRawUnsafe<
    Array<{
      assetCode: string;
      quantity: unknown;
      currentPrice: unknown;
      marketValue: unknown;
      totalPnl: unknown;
      dailyPnl: unknown;
      dailyPct: unknown;
      costPrice: unknown;
      floatingPnl: unknown;
      floatingPnlPercent: unknown;
      totalPnlPercent: unknown;
    }>
  >(
    `SELECT "assetCode", "quantity", "currentPrice", "marketValue", "totalPnl", "dailyPnl", "dailyPct",
            "costPrice", "floatingPnl", "floatingPnlPercent", "totalPnlPercent"
       FROM "PositionSnapshot"
      WHERE "portfolioId" = ? AND "date" = ?`,
    portfolioId,
    snapshotDate
  );

  if (positionRows.length === 0) {
    console.warn(
      `[SnapshotService] No PositionSnapshot rows to correct: portfolio=${portfolioId}, date=${snapshotDate}`
    );
    return;
  }

  let totalMarketValue = positionRows.reduce(
    (sum, row) => sum + toSafeNumber(row.marketValue),
    0
  );
  let portfolioPnlDelta = 0;

  let correctedCount = 0;

  for (const row of positionRows) {
    const assetCode = row.assetCode;
    const quantity = toSafeNumber(row.quantity);
    const oldMarketValue = toSafeNumber(row.marketValue);

    let closePrice: number | null = null;
    try {
      closePrice = await findDailyClosePrice(assetCode, snapshotDate);
    } catch (error) {
      console.warn(
        `[SnapshotService] K-line fetch failed, keep original snapshot value: portfolio=${portfolioId}, date=${snapshotDate}, asset=${assetCode}`,
        error
      );
      continue;
    }

    if (closePrice === null) {
      console.warn(
        `[SnapshotService] K-line close not found, keep original snapshot value: portfolio=${portfolioId}, date=${snapshotDate}, asset=${assetCode}`
      );
      continue;
    }

    const fxRate = await resolveSnapshotFxRate(assetCode);
    if (fxRate === null) {
      console.warn(
        `[SnapshotService] FX rate unavailable, keep original snapshot value: portfolio=${portfolioId}, date=${snapshotDate}, asset=${assetCode}`
      );
      continue;
    }

    const newMarketValue = closePrice * quantity * fxRate;
    const delta = newMarketValue - oldMarketValue;
    const nextTotalPnl = toNullableNumber(row.totalPnl);
    const nextDailyPnl = toNullableNumber(row.dailyPnl);
    const correctedTotalPnl =
      nextTotalPnl === null ? null : nextTotalPnl + delta;
    const correctedDailyPnl =
      nextDailyPnl === null ? null : nextDailyPnl + delta;
    const prevCloseMarketValue =
      correctedDailyPnl === null ? null : newMarketValue - correctedDailyPnl;
    const correctedDailyPct =
      correctedDailyPnl !== null &&
      prevCloseMarketValue !== null &&
      prevCloseMarketValue > 0
        ? (correctedDailyPnl / prevCloseMarketValue) * 100
        : toNullableNumber(row.dailyPct);

    // Phase 2: 修正 floatingPnl, floatingPnlPercent, totalPnlPercent
    // costBasisCNY = costPrice（本币）× quantity × fxRate，用作百分比分母
    const costPriceLocal = toNullableNumber(row.costPrice);
    const costBasisCNY =
      costPriceLocal !== null && costPriceLocal > 0 && quantity > 0
        ? costPriceLocal * quantity * fxRate
        : null;

    const oldFloatingPnl = toNullableNumber(row.floatingPnl);
    const correctedFloatingPnl =
      oldFloatingPnl === null ? null : oldFloatingPnl + delta;
    const correctedFloatingPnlPct =
      correctedFloatingPnl !== null && costBasisCNY !== null && costBasisCNY > 0
        ? (correctedFloatingPnl / costBasisCNY) * 100
        : toNullableNumber(row.floatingPnlPercent);
    const correctedTotalPnlPct =
      correctedTotalPnl !== null && costBasisCNY !== null && costBasisCNY > 0
        ? (correctedTotalPnl / costBasisCNY) * 100
        : toNullableNumber(row.totalPnlPercent);

    await prisma.$executeRawUnsafe(
      `UPDATE "PositionSnapshot"
          SET "currentPrice" = ?,
              "marketValue" = ?,
              "totalPnl" = ?,
              "dailyPnl" = ?,
              "dailyPct" = ?,
              "floatingPnl" = ?,
              "floatingPnlPercent" = ?,
              "totalPnlPercent" = ?
        WHERE "portfolioId" = ?
          AND "date" = ?
          AND "assetCode" = ?`,
      closePrice,
      newMarketValue,
      correctedTotalPnl,
      correctedDailyPnl,
      correctedDailyPct,
      correctedFloatingPnl,
      correctedFloatingPnlPct,
      correctedTotalPnlPct,
      portfolioId,
      snapshotDate,
      assetCode
    );

    const changeAmount =
      quantity > 0 && fxRate > 0 && correctedDailyPnl !== null
        ? correctedDailyPnl / quantity / fxRate
        : null;
    const prevClosePrice =
      changeAmount !== null ? closePrice - changeAmount : null;
    const changePercent =
      changeAmount !== null && prevClosePrice !== null && prevClosePrice > 0
        ? (changeAmount / prevClosePrice) * 100
        : null;

    await prisma.$executeRawUnsafe(
      `UPDATE "QuoteSnapshot"
          SET "timestamp" = ?,
              "currentPrice" = ?,
              "changeAmount" = ?,
              "changePercent" = ?,
              "prevClosePrice" = ?,
              "createdAt" = CURRENT_TIMESTAMP
        WHERE "assetCode" = ?
          AND "date" = ?`,
      getSnapshotTimestamp(snapshotDate),
      closePrice,
      changeAmount,
      changePercent,
      prevClosePrice,
      assetCode,
      snapshotDate
    );

    totalMarketValue = totalMarketValue - oldMarketValue + newMarketValue;
    portfolioPnlDelta += delta;
    correctedCount += 1;
  }

  if (correctedCount === 0) {
    console.warn(
      `[SnapshotService] No position corrected by K-line, keep original PortfolioSnapshot: portfolio=${portfolioId}, date=${snapshotDate}`
    );
    return;
  }

  const cash = toSafeNumber(snapshot.cash);
  const previousTotalMarketValue = toSafeNumber(snapshot.totalMarketValue);
  const previousNetAssets = toSafeNumber(snapshot.netAssets);
  const leverageUsed =
    toNullableNumber(snapshot.leverageUsed) ??
    previousTotalMarketValue + cash - previousNetAssets;
  const netAssets = totalMarketValue + cash - leverageUsed;
  const totalPnl = toNullableNumber(snapshot.totalPnl);
  const dailyPnl = toNullableNumber(snapshot.dailyPnl);
  const correctedTotalPnl = totalPnl === null ? null : totalPnl + portfolioPnlDelta;
  const correctedDailyPnl = dailyPnl === null ? null : dailyPnl + portfolioPnlDelta;

  // Phase 3: 修正 PortfolioSnapshot 衍生字段
  const oldUnrealizedPnl = toNullableNumber(snapshot.unrealizedPnl);
  const correctedUnrealizedPnl =
    oldUnrealizedPnl === null ? null : oldUnrealizedPnl + portfolioPnlDelta;

  const netDepositedCash = toNullableNumber(snapshot.netDepositedCash);

  const correctedTotalPnlPct =
    correctedTotalPnl !== null && netDepositedCash !== null && netDepositedCash > 0
      ? (correctedTotalPnl / netDepositedCash) * 100
      : null;

  const prevNetAssets = netAssets - (correctedDailyPnl ?? 0);
  const correctedDailyPnlPct =
    correctedDailyPnl !== null && prevNetAssets > 0
      ? (correctedDailyPnl / prevNetAssets) * 100
      : null;

  const correctedYearlyReturnValue =
    netDepositedCash !== null && netDepositedCash > 0
      ? netAssets - netDepositedCash
      : null;
  const correctedYearlyReturnPct =
    correctedYearlyReturnValue !== null && netDepositedCash !== null && netDepositedCash > 0
      ? (correctedYearlyReturnValue / netDepositedCash) * 100
      : null;

  await prisma.$executeRawUnsafe(
    `UPDATE "PortfolioSnapshot"
        SET "totalMarketValue"  = ?,
            "netAssets"         = ?,
            "totalPnl"          = ?,
            "dailyPnl"          = ?,
            "unrealizedPnl"     = ?,
            "totalPnlPercent"   = ?,
            "dailyPnlPercent"   = ?,
            "yearlyReturnValue" = ?,
            "yearlyReturnPercent" = ?,
            "correctedAt"       = CURRENT_TIMESTAMP
      WHERE "portfolioId" = ?
        AND "date" = ?`,
    totalMarketValue,
    netAssets,
    correctedTotalPnl,
    correctedDailyPnl,
    correctedUnrealizedPnl,
    correctedTotalPnlPct,
    correctedDailyPnlPct,
    correctedYearlyReturnValue,
    correctedYearlyReturnPct,
    portfolioId,
    snapshotDate
  );

  console.log(
    `[SnapshotService] ✅ Snapshot corrected with K-line (Phase 2+3): portfolio=${portfolioId}, date=${snapshotDate}, correctedPositions=${correctedCount}, totalMarketValue=${totalMarketValue.toFixed(2)}, netAssets=${netAssets.toFixed(2)}`
  );

  // Phase 4: 重跑 Modified Dietz 周度/月度（K 线 only，不用实时报价）
  await correctPeriodStatsWithKline({ portfolioId, snapshotDate });

  // Phase 5: IndexSnapshot K 线修正
  await correctIndexSnapshotWithKline(snapshotDate);
}

/**
 * 为指定组合拍摄当日快照
 * 使用 upsert 保证幂等：同一组合同一天只有一条记录
 */
async function takeSnapshotForPortfolio(
  portfolioId: string,
  dateOverride?: string
): Promise<void> {
  try {
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      console.warn(
        `[SnapshotService] Portfolio ${portfolioId} not found, skipping.`
      );
      return;
    }

    const stats = await portfolioStatsService.getFullStats(portfolio, {
      includeQuotes: true,
      includePeriods: [],
    });

    const snapshotDate = dateOverride || getSnapshotDate();
    const exchangeRateSnapshots = buildExchangeRateSnapshotInputs(snapshotDate);
    const leverageCumulativeCost = calculateSnapshotLeverageCumulativeCost(
      portfolio,
      snapshotDate
    );
    const usdCny =
      exchangeRateSnapshots.find((item) => item.pair === 'USD-CNY')?.rate ??
      null;
    const hkdCny =
      exchangeRateSnapshots.find((item) => item.pair === 'HKD-CNY')?.rate ??
      null;
    const optionalQuoteSnapshots = buildQuoteSnapshotCandidates(
      stats.positions,
      snapshotDate
    );

    // 计算补充字段
    const netDepositedCash = stats.netDepositedCash;
    const totalPnlPercent =
      netDepositedCash > 0 ? (stats.totalPnl / netDepositedCash) * 100 : null;
    const prevNetAssets = stats.netAssets - stats.dailyPnl;
    const dailyPnlPercent =
      prevNetAssets > 0 ? (stats.dailyPnl / prevNetAssets) * 100 : null;

    const weeklyStats = stats.weeklyStats;
    const monthlyStats = stats.monthlyStats;

    // 年度收益：以净入金为基准（包含所有盈亏、融资成本、履约等所有市値变化）
    const yearlyReturnValue =
      netDepositedCash > 0 ? stats.netAssets - netDepositedCash : null;
    const yearlyReturnPercent =
      netDepositedCash > 0 && yearlyReturnValue !== null
        ? (yearlyReturnValue / netDepositedCash) * 100
        : null;
    const yearlyBaseDate = format(startOfYear(new Date()), 'yyyy-MM-dd');

    await prisma.$transaction(async (tx) => {
      await upsertPortfolioSnapshot(tx, {
        portfolioId,
        date: snapshotDate,
        totalMarketValue: stats.totalMarketValue,
        netAssets: stats.netAssets,
        totalPnl: stats.totalPnl,
        dailyPnl: stats.dailyPnl,
        cash: stats.cash,
        leverageUsed: toNullableNumber(portfolio.leverage?.usedAmount),
        leverageTotal: toNullableNumber(portfolio.leverage?.totalAmount),
        leverageCostRate: toNullableNumber(portfolio.leverage?.costRate),
        leverageCumulativeCost,
        usdCny,
        hkdCny,
        realizedPnl: toNullableNumber(stats.realizedPnl),
        unrealizedPnl: toNullableNumber(stats.unrealizedPnl),
        totalCommission: toNullableNumber(stats.totalCommission),
        netDepositedCash: toNullableNumber(netDepositedCash),
        totalDividendIncome: toNullableNumber(stats.totalDividendIncome),
        totalPnlPercent,
        dailyPnlPercent,
        weeklyReturnPercent: toNullableNumber(weeklyStats?.periodReturnPercent),
        weeklyReturnValue: toNullableNumber(
          weeklyStats?.totalValueChange ?? weeklyStats?.periodPnl
        ),
        weeklyBaseDate: weeklyStats?.baseDate ?? null,
        monthlyReturnPercent: toNullableNumber(
          monthlyStats?.periodReturnPercent
        ),
        monthlyReturnValue: toNullableNumber(
          monthlyStats?.totalValueChange ?? monthlyStats?.periodPnl
        ),
        monthlyBaseDate: monthlyStats?.baseDate ?? null,
        yearlyReturnPercent,
        yearlyReturnValue,
        yearlyBaseDate,
      });

      for (const pos of stats.positions) {
        await upsertPositionSnapshot(tx, portfolioId, snapshotDate, pos);
      }

      for (const exchangeRateSnapshot of exchangeRateSnapshots) {
        await upsertExchangeRateSnapshot(
          tx,
          snapshotDate,
          exchangeRateSnapshot
        );
      }
    });

    await tryWriteOptionalQuoteSnapshots(prisma, optionalQuoteSnapshots);

    const indexSnapshots = await buildIndexSnapshotCandidates(snapshotDate);
    await tryWriteIndexSnapshots(prisma, indexSnapshots);

    try {
      await correctSnapshotWithKline({ portfolioId, snapshotDate });
    } catch (error) {
      console.warn(
        `[SnapshotService] K-line correction failed after main snapshot commit: portfolio=${portfolioId}, date=${snapshotDate}`,
        error
      );
    }

    console.log(
      `[SnapshotService] ✅ Snapshot saved: portfolio=${portfolioId}, date=${snapshotDate}, netAssets=${stats.netAssets.toFixed(2)}`
    );
  } catch (error) {
    console.error(
      `[SnapshotService] ❌ Failed to take snapshot for portfolio ${portfolioId}:`,
      error
    );
    throw error;
  }
}

/**
 * 为所有组合拍摄快照（仅 snapshotEnabled 的组合）
 */
async function takeSnapshotForAll(dateOverride?: string): Promise<void> {
  console.log(
    '[SnapshotService] Starting daily snapshot for all portfolios...'
  );
  try {
    const portfolios = await container.listPortfoliosUseCase.execute();
    // 查询每个组合的 snapshotEnabled 状态
    const dbPortfolios = await prisma.portfolio.findMany({
      select: { id: true, snapshotEnabled: true },
    });
    const enabledSet = new Set(
      dbPortfolios
        .filter((portfolio) => portfolio.snapshotEnabled)
        .map((portfolio) => portfolio.id)
    );

    let count = 0;
    for (const p of portfolios) {
      if (!enabledSet.has(p.id)) {
        console.log(
          `[SnapshotService] ⏭ Skipped (snapshot disabled): ${p.id}`
        );
        continue;
      }
      await takeSnapshotForPortfolio(p.id, dateOverride);
      count++;
    }
    console.log(
      `[SnapshotService] ✅ Daily snapshot completed for ${count}/${portfolios.length} portfolio(s).`
    );
  } catch (error) {
    const msg = `快照执行失败: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[SnapshotService] ❌ ${msg}`);
    await sendSnapshotAlert(msg);
  }
}

// ==================== 定时任务 ====================

let dailyJob: schedule.Job | null = null;
let verifyJob: schedule.Job | null = null;

/**
 * 启动定时快照任务
 */
export function startSnapshotScheduler(): void {
  // 每日 06:30 北京时间，周二到周六执行
  // 统一采取三市前一交易日的收盘数据
  dailyJob = schedule.scheduleJob(
    { rule: '30 6 * * 2-6', tz: 'Asia/Shanghai' },
    async () => {
      const snapshotDate = getSnapshotDate();
      console.log(
        `[SnapshotService] Cron triggered at ${new Date().toISOString()}, snapshot date: ${snapshotDate}`
      );
      await takeSnapshotForAll();
    }
  );

  // 08:00 校验 + 自动补采 (周二到周六)
  verifyJob = schedule.scheduleJob(
    { rule: '0 8 * * 2-6', tz: 'Asia/Shanghai' },
    async () => {
      const yesterday = getSnapshotDate();

      // 检查昨日是否已有快照
      const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM "PortfolioSnapshot" WHERE "date" = ?`,
        yesterday
      );
      const count = Number(rows[0]?.count || 0);

      if (count === 0) {
        console.warn(
          `[SnapshotService] ⚠️ No snapshot found for ${yesterday}, retrying...`
        );
        await sendSnapshotAlert(
          `06:30 快照未找到数据（${yesterday}），正在自动补采`
        );
        await takeSnapshotForAll(yesterday);
      } else {
        console.log(
          `[SnapshotService] ✅ Verify passed: ${count} portfolio(s) snapshotted for ${yesterday}`
        );
      }
    }
  );

  console.log('[SnapshotService] ✅ Snapshot scheduler started.');
  console.log('  Schedule: "30 6 * * 2-6" (Tue-Sat 06:30 Asia/Shanghai)');
  console.log('  Verify:   "0 8 * * 2-6"  (Tue-Sat 08:00 Asia/Shanghai)');
}

/**
 * 停止定时任务（优雅关闭用）
 */
export function stopSnapshotScheduler(): void {
  if (dailyJob) {
    dailyJob.cancel();
    dailyJob = null;
  }
  if (verifyJob) {
    verifyJob.cancel();
    verifyJob = null;
  }
  console.log('[SnapshotService] Snapshot scheduler stopped.');
}

// ==================== 查询接口 ====================

export interface SnapshotRecord {
  id: number;
  portfolioId: string;
  date: string;
  totalMarketValue: number;
  netAssets: number;
  totalPnl: number;
  dailyPnl: number;
  cash: number;
  createdAt: string;
}

/**
 * 查询指定日期范围内的快照列表
 */
export async function getSnapshots(
  portfolioId: string,
  from?: string,
  to?: string
): Promise<SnapshotRecord[]> {
  let sql = `SELECT * FROM "PortfolioSnapshot" WHERE "portfolioId" = ?`;
  const params: unknown[] = [portfolioId];

  if (from) {
    sql += ` AND "date" >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND "date" <= ?`;
    params.push(to);
  }

  sql += ` ORDER BY "date" ASC`;

  const rows = await prisma.$queryRawUnsafe<SnapshotRecord[]>(sql, ...params);
  return rows;
}

// ==================== 周报生成 ====================

export interface WeeklyReportPosition {
  assetCode: string;
  name: string;
  weeklyChangePercent: number | null;
  weeklyPnl: number;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  snapshots: SnapshotRecord[];
  totalPnlChange: number;
  totalPnlPercent: number | null;
  positions: WeeklyReportPosition[];
}

/**
 * 解析 YYYY-WW 格式为对应周的起止日期
 * W01 = 当年第1周（ISO周）
 */
function parseWeekParam(week: string): { weekStart: Date; weekEnd: Date } {
  const match = week.match(/^(\d{4})-W?(\d{1,2})$/i);
  if (!match) {
    throw new Error(`Invalid week format: ${week}. Expected YYYY-WW.`);
  }

  const year = parseInt(match[1], 10);
  const weekNum = parseInt(match[2], 10);

  // 计算 ISO 周的第一天（周一）
  // ISO 周1 包含该年的第一个周四
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7; // 1-7 (Mon-Sun)
  const isoWeek1Monday = new Date(jan4);
  isoWeek1Monday.setDate(jan4.getDate() - jan4Day + 1);

  const weekStart = new Date(isoWeek1Monday);
  weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  return { weekStart, weekEnd };
}

/**
 * 获取周报数据
 */
export async function getWeeklyReport(
  portfolioId: string,
  week?: string
): Promise<WeeklyReport> {
  let weekStart: Date;
  let weekEnd: Date;

  if (week) {
    const parsed = parseWeekParam(week);
    weekStart = parsed.weekStart;
    weekEnd = parsed.weekEnd;
  } else {
    // 默认上一周
    const now = new Date();
    const lastWeek = subWeeks(now, 1);
    weekStart = startOfWeek(lastWeek, { weekStartsOn: 1 }); // 周一起
    weekEnd = endOfWeek(lastWeek, { weekStartsOn: 1 }); // 周日止
  }

  const fromStr = format(weekStart, 'yyyy-MM-dd');
  const toStr = format(weekEnd, 'yyyy-MM-dd');

  // 获取本周快照
  const snapshots = await getSnapshots(portfolioId, fromStr, toStr);

  // 计算本周盈亏变化
  let totalPnlChange = 0;
  let totalPnlPercent: number | null = null;
  if (snapshots.length >= 2) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    totalPnlChange = Number(last.totalPnl) - Number(first.totalPnl);
    const firstNetAssets = Number(first.netAssets);
    totalPnlPercent =
      firstNetAssets > 0 ? (totalPnlChange / firstNetAssets) * 100 : null;
  } else if (snapshots.length === 1) {
    totalPnlChange = Number(snapshots[0].dailyPnl);
  }

  // 获取当前持仓信息用于展示周度涨跌
  const positions: WeeklyReportPosition[] = [];
  try {
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (portfolio) {
      const stats = await portfolioStatsService.getFullStats(portfolio, {
        includeQuotes: true,
        includePeriods: ['weekly'],
      });
      for (const pos of stats.positions) {
        positions.push({
          assetCode: pos.asset.code,
          name: pos.asset.name,
          weeklyChangePercent: pos.weeklyChangePercent ?? null,
          weeklyPnl: pos.dailyChange ?? 0, // 简化：使用当日数据
        });
      }
    }
  } catch (error) {
    console.warn(
      '[SnapshotService] Failed to load positions for weekly report:',
      error
    );
  }

  return {
    weekStart: fromStr,
    weekEnd: toStr,
    snapshots,
    totalPnlChange,
    totalPnlPercent,
    positions,
  };
}

/**
 * 手动触发快照（供 API 调用）
 */
export { takeSnapshotForAll, takeSnapshotForPortfolio };
