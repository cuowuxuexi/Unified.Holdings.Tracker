/**
 * backfillSnapshots.ts
 * 历史快照补写脚本 — 为现有 PortfolioSnapshot / PositionSnapshot 记录回填新增字段
 *
 * 用法:
 *   npx ts-node -e "require('./src/scripts/backfillSnapshots')"
 *   或编译后: node dist/scripts/backfillSnapshots.js
 *
 * 必须先完成 migration (commit3) 后再运行本脚本。
 */

import { prisma } from '../lib/prisma';
import { container } from '../container';
import { portfolioStatsService } from '../services/portfolioStatsService';
import { format, startOfYear } from 'date-fns';
import Decimal from 'decimal.js';

function toSafe(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNullable(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 补写 PortfolioSnapshot 中缺失的新增字段（基于当前 portfolio 状态）
 * 注意：这是近似值，使用当前价格和交易记录回算，历史数据可能略有偏差
 */
async function backfillPortfolioSnapshot(
  portfolioId: string,
  date: string
): Promise<void> {
  const portfolio = await container.getPortfolioUseCase.execute({
    portfolioId,
  });
  if (!portfolio) {
    console.warn(`[Backfill] Portfolio ${portfolioId} not found, skip`);
    return;
  }

  // 获取当前 snapshot 记录
  const rows = await prisma.$queryRawUnsafe<
    { netAssets: unknown; dailyPnl: unknown; totalPnl: unknown }[]
  >(
    `SELECT netAssets, dailyPnl, totalPnl FROM "PortfolioSnapshot" WHERE portfolioId = ? AND date = ?`,
    portfolioId,
    date
  );
  if (rows.length === 0) {
    console.warn(`[Backfill] No snapshot for ${portfolioId} on ${date}, skip`);
    return;
  }
  const snap = rows[0];

  // 使用存储的 netAssets 和已有交易数据计算补充字段
  // 注意：此处使用当前组合的 netDepositedCash，不因日期变化
  const { calculateNetDepositedCash } = await import('../services/calculation');
  const { calculateTotalCommission, calculateTotalDividendIncome } =
    await import('../services/calculation');
  const { calculateTotalPnlV2 } = await import(
    '../services/calculation/realized-pnl'
  );

  const netDepositedCash = calculateNetDepositedCash(portfolio);
  const totalCommission = await calculateTotalCommission(portfolio);
  const totalDividendIncome = calculateTotalDividendIncome(portfolio);

  // 使用存储的 totalPnl（当时计算），重新计算 realizedPnl/unrealizedPnl 用当前价格（近似值）
  // 如果需要精确历史值，应使用 kline API 获取当日收盘价，这里用当前价格近似
  const pnlV2 = await calculateTotalPnlV2(portfolio, []);

  const storedNetAssets = toSafe(snap.netAssets);
  const storedTotalPnl = toSafe(snap.totalPnl);
  const storedDailyPnl = toSafe(snap.dailyPnl);

  const totalPnlPercent =
    netDepositedCash > 0 ? (storedTotalPnl / netDepositedCash) * 100 : null;
  const prevNetAssets = storedNetAssets - storedDailyPnl;
  const dailyPnlPercent =
    prevNetAssets > 0 ? (storedDailyPnl / prevNetAssets) * 100 : null;

  // 年度收益：用存储的 netAssets
  const yearlyReturnValue =
    netDepositedCash > 0 ? storedNetAssets - netDepositedCash : null;
  const yearlyReturnPercent =
    netDepositedCash > 0 && yearlyReturnValue !== null
      ? (yearlyReturnValue / netDepositedCash) * 100
      : null;
  const yearlyBaseDate = format(startOfYear(new Date()), 'yyyy-MM-dd');

  // 周/月收益：从快照序列查询（更准确）
  const weekBoundary = getWeekBoundary(date);
  const monthBoundary = getMonthBoundary(date);

  const weeklyStats = await calcPeriodReturnFromSnapshots(
    portfolioId,
    weekBoundary,
    date
  );
  const monthlyStats = await calcPeriodReturnFromSnapshots(
    portfolioId,
    monthBoundary,
    date
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "PortfolioSnapshot" SET
      "realizedPnl"          = ?,
      "unrealizedPnl"        = ?,
      "totalCommission"      = ?,
      "netDepositedCash"     = ?,
      "totalDividendIncome"  = ?,
      "totalPnlPercent"      = ?,
      "dailyPnlPercent"      = ?,
      "weeklyReturnPercent"  = ?,
      "weeklyReturnValue"    = ?,
      "weeklyBaseDate"       = ?,
      "monthlyReturnPercent" = ?,
      "monthlyReturnValue"   = ?,
      "monthlyBaseDate"      = ?,
      "yearlyReturnPercent"  = ?,
      "yearlyReturnValue"    = ?,
      "yearlyBaseDate"       = ?
    WHERE "portfolioId" = ? AND "date" = ?`,
    toNullable(pnlV2.realizedPnl),
    toNullable(pnlV2.unrealizedPnl),
    toNullable(totalCommission),
    toNullable(netDepositedCash),
    toNullable(totalDividendIncome),
    totalPnlPercent,
    dailyPnlPercent,
    weeklyStats?.percent ?? null,
    weeklyStats?.value ?? null,
    weeklyStats?.baseDate ?? null,
    monthlyStats?.percent ?? null,
    monthlyStats?.value ?? null,
    monthlyStats?.baseDate ?? null,
    yearlyReturnPercent,
    yearlyReturnValue,
    yearlyBaseDate,
    portfolioId,
    date
  );
  console.log(`[Backfill] PortfolioSnapshot updated: ${portfolioId} ${date}`);
}

/**
 * 补写 PositionSnapshot 中缺失的盈亏率字段
 */
async function backfillPositionSnapshots(
  portfolioId: string,
  date: string
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<
    {
      assetCode: string;
      marketValue: unknown;
      totalPnl: unknown;
      costPrice: unknown;
    }[]
  >(
    `SELECT assetCode, marketValue, totalPnl, costPrice
     FROM "PositionSnapshot"
     WHERE portfolioId = ? AND date = ?`,
    portfolioId,
    date
  );

  for (const row of rows) {
    const marketValue = toSafe(row.marketValue);
    const totalPnl = toNullable(row.totalPnl);
    const costPrice = toSafe(row.costPrice);

    const floatingPnl = costPrice > 0 ? marketValue - costPrice : null;
    const floatingPnlPercent =
      floatingPnl !== null && costPrice > 0
        ? (floatingPnl / costPrice) * 100
        : null;
    const totalPnlPercent =
      totalPnl !== null && costPrice > 0 ? (totalPnl / costPrice) * 100 : null;

    await prisma.$executeRawUnsafe(
      `UPDATE "PositionSnapshot" SET
        "totalPnlPercent"    = ?,
        "floatingPnl"        = ?,
        "floatingPnlPercent" = ?
       WHERE "portfolioId" = ? AND "date" = ? AND "assetCode" = ?`,
      totalPnlPercent,
      floatingPnl,
      floatingPnlPercent,
      portfolioId,
      date,
      row.assetCode
    );
  }
  if (rows.length > 0) {
    console.log(
      `[Backfill] PositionSnapshot updated: ${portfolioId} ${date} (${rows.length} rows)`
    );
  }
}

function getWeekBoundary(date: string): string {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return format(d, 'yyyy-MM-dd');
}

function getMonthBoundary(date: string): string {
  return date.substring(0, 7) + '-01';
}

async function calcPeriodReturnFromSnapshots(
  portfolioId: string,
  fromDate: string,
  toDate: string
): Promise<{ percent: number; value: number; baseDate: string } | null> {
  const rows = await prisma.$queryRawUnsafe<
    { date: string; netAssets: unknown }[]
  >(
    `SELECT date, netAssets FROM "PortfolioSnapshot"
     WHERE portfolioId = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
    portfolioId,
    fromDate,
    toDate
  );

  if (rows.length < 2) return null;

  const first = toSafe(rows[0].netAssets);
  const last = toSafe(rows[rows.length - 1].netAssets);

  if (first <= 0) return null;

  return {
    percent: ((last - first) / first) * 100,
    value: last - first,
    baseDate: rows[0].date,
  };
}

async function main() {
  console.log('[Backfill] Starting snapshot backfill...');

  const portfolios = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "Portfolio" WHERE snapshotEnabled = 1`
  );

  for (const portfolio of portfolios) {
    const snapshots = await prisma.$queryRawUnsafe<{ date: string }[]>(
      `SELECT date FROM "PortfolioSnapshot" WHERE portfolioId = ? ORDER BY date ASC`,
      portfolio.id
    );

    console.log(
      `[Backfill] Portfolio ${portfolio.id}: ${snapshots.length} snapshots to backfill`
    );

    for (const snap of snapshots) {
      try {
        await backfillPortfolioSnapshot(portfolio.id, snap.date);
        await backfillPositionSnapshots(portfolio.id, snap.date);
      } catch (error) {
        console.error(
          `[Backfill] Error on ${portfolio.id} ${snap.date}:`,
          error
        );
      }
    }
  }

  console.log('[Backfill] Done.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
