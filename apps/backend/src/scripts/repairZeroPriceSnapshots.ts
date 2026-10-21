/**
 * 零价快照修复脚本
 *
 * 针对行情失败日：PositionSnapshot.currentPrice = 0、市值回退成成本，
 * 导致 PortfolioSnapshot 的净资产与累计盈亏是假值（如 2026-09-01..03）。
 * 计算口径见 services/snapshotRepair.ts：以前一份全部有价的快照为锚点、
 * K 线（不复权）收盘价 × 数量 × 当日汇率重算，锚点到目标日之间有任何交易则拒绝。
 *
 * 安全语义：
 * - 默认 dry-run，只打印修复前后对比；
 * - --write 时必须带 --confirm-db <数据库文件名> 且 DATABASE_URL 指向 SQLite；
 * - 只更新已存在的零价快照行，不新建、不删除；周/月收益置空（不猜 Modified Dietz 基准）。
 *
 * 用法（容器内）：
 *   node dist/repair-zero-price-snapshots.js \
 *     --portfolio-id <id> --date-from 2026-09-01 --date-to 2026-09-03 \
 *     [--write --confirm-db portfolio.db]
 */

import { prisma } from '../lib/prisma';
import { container } from '../container';
import { fetchKline } from '../services/tencentApi';
import {
  isUnpricedSnapshot,
  repairSnapshotFromAnchor,
  RepairSnapshot,
} from '../services/snapshotRepair';

interface CliOptions {
  portfolioId: string;
  dateFrom: string;
  dateTo: string;
  write: boolean;
  confirmDb: string | null;
}

const ANCHOR_LOOKBACK_DAYS = 30;
const KLINE_LOOKBACK_DAYS = 15;

function parseArgs(argv: string[]): CliOptions {
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      options[arg.slice(2)] = argv[++i];
    } else {
      options[arg.slice(2)] = true;
    }
  }

  const portfolioId = String(options['portfolio-id'] ?? '');
  const dateFrom = String(options['date-from'] ?? '');
  const dateTo = String(options['date-to'] ?? '');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!portfolioId) throw new Error('--portfolio-id is required');
  if (!datePattern.test(dateFrom))
    throw new Error('--date-from must be YYYY-MM-DD');
  if (!datePattern.test(dateTo))
    throw new Error('--date-to must be YYYY-MM-DD');
  if (dateFrom > dateTo) throw new Error('--date-from must be <= --date-to');

  return {
    portfolioId,
    dateFrom,
    dateTo,
    write: options['write'] === true,
    confirmDb:
      typeof options['confirm-db'] === 'string'
        ? (options['confirm-db'] as string)
        : null,
  };
}

function assertWriteGate(options: CliOptions): void {
  if (!options.write) return;
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('file:')) {
    throw new Error(
      'write mode requires DATABASE_URL pointing to a SQLite file'
    );
  }
  const dbFile = databaseUrl
    .replace(/^file:/, '')
    .split('?')[0]
    .split(/[\\/]/)
    .pop();
  if (!options.confirmDb || options.confirmDb !== dbFile) {
    throw new Error(
      `write mode requires --confirm-db to match the target database file name (expected: ${dbFile})`
    );
  }
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 交易时间按北京时间归日（交易记录以 UTC 落库） */
function toBeijingDate(value: string | Date): string {
  const ms = new Date(value).getTime() + 8 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function fxPairForAsset(assetCode: string): 'HKD-CNY' | 'USD-CNY' | null {
  const prefix = assetCode.slice(0, 2).toLowerCase();
  if (prefix === 'hk') return 'HKD-CNY';
  if (prefix === 'us') return 'USD-CNY';
  return null;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNullable(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function fmt(value: number | null): string {
  return value === null ? 'null' : value.toFixed(2);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertWriteGate(options);

  const portfolio = await container.getPortfolioUseCase.execute({
    portfolioId: options.portfolioId,
  });
  if (!portfolio) {
    throw new Error(`Portfolio not found: ${options.portfolioId}`);
  }

  const windowFrom = shiftDate(options.dateFrom, -ANCHOR_LOOKBACK_DAYS);
  const [portfolioRows, positionRows, fxRows] = await Promise.all([
    prisma.portfolioSnapshot.findMany({
      where: {
        portfolioId: options.portfolioId,
        date: { gte: windowFrom, lte: options.dateTo },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.positionSnapshot.findMany({
      where: {
        portfolioId: options.portfolioId,
        date: { gte: windowFrom, lte: options.dateTo },
      },
    }),
    prisma.exchangeRateSnapshot.findMany({
      where: { date: { gte: windowFrom, lte: options.dateTo } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const snapshots = new Map<string, RepairSnapshot>();
  for (const row of portfolioRows) {
    snapshots.set(row.date, {
      portfolio: {
        date: row.date,
        cash: toNumber(row.cash),
        totalMarketValue: toNumber(row.totalMarketValue),
        netAssets: toNumber(row.netAssets),
        totalPnl: toNullable(row.totalPnl),
        unrealizedPnl: toNullable(row.unrealizedPnl),
        leverageUsed: toNullable(row.leverageUsed),
        netDepositedCash: toNullable(row.netDepositedCash),
      },
      positions: [],
    });
  }
  for (const row of positionRows) {
    snapshots.get(row.date)?.positions.push({
      assetCode: row.assetCode,
      quantity: toNumber(row.quantity),
      currentPrice: toNumber(row.currentPrice),
      marketValue: toNumber(row.marketValue),
      totalPnl: toNullable(row.totalPnl),
      floatingPnl: toNullable(row.floatingPnl),
    });
  }

  const fxAt = (pair: string, date: string): number | null => {
    let rate: number | null = null;
    for (const row of fxRows) {
      if (row.pair !== pair || row.date > date) continue;
      const value = toNullable(row.rate);
      if (value !== null && value > 0) rate = value;
    }
    return rate;
  };
  const tradeDates = (portfolio.transactions ?? []).map((tx) =>
    toBeijingDate(tx.date)
  );

  const dates = [...snapshots.keys()].sort();
  let anchor: RepairSnapshot | null = null;
  let repaired = 0;
  let refused = 0;

  for (const date of dates) {
    const snapshot = snapshots.get(date) as RepairSnapshot;
    if (!isUnpricedSnapshot(snapshot.positions)) {
      anchor = snapshot;
      continue;
    }
    if (date < options.dateFrom) continue;

    if (!anchor) {
      console.warn(`[RepairSnapshots] ${date} 窗口内找不到有价锚点，跳过`);
      refused++;
      continue;
    }
    const anchorDate = anchor.portfolio.date;
    const tradesBetween = tradeDates.filter(
      (tradeDate) => tradeDate > anchorDate && tradeDate <= date
    );
    if (tradesBetween.length > 0) {
      console.warn(
        `[RepairSnapshots] ${date} 与锚点 ${anchorDate} 之间有交易（${tradesBetween.join(', ')}），不能按锚点修复，跳过`
      );
      refused++;
      continue;
    }

    const closes: Record<string, number> = {};
    const fxRates: Record<string, number> = {};
    for (const row of snapshot.positions) {
      const kline = await fetchKline(
        row.assetCode,
        'daily',
        shiftDate(date, -KLINE_LOOKBACK_DAYS),
        date,
        'none',
        30
      );
      const point = [...kline].reverse().find((item) => item.date <= date);
      if (point) closes[row.assetCode] = point.close;
      const pair = fxPairForAsset(row.assetCode);
      const rate = pair ? fxAt(pair, date) : 1;
      if (rate !== null) fxRates[row.assetCode] = rate;
    }

    let result;
    try {
      result = repairSnapshotFromAnchor({
        anchor,
        previous: anchor,
        target: snapshot,
        closes,
        fxRates,
      });
    } catch (error) {
      console.warn(
        `[RepairSnapshots] ${date} 无法修复：${error instanceof Error ? error.message : String(error)}`
      );
      refused++;
      continue;
    }

    console.log(
      `[RepairSnapshots] ${date} 锚点 ${anchorDate} | 市值 ${fmt(snapshot.portfolio.totalMarketValue)} → ${fmt(result.portfolio.totalMarketValue)}` +
        ` | 净资产 ${fmt(snapshot.portfolio.netAssets)} → ${fmt(result.portfolio.netAssets)}` +
        ` | 累计盈亏 ${fmt(snapshot.portfolio.totalPnl)} → ${fmt(result.portfolio.totalPnl)}`
    );
    for (const row of result.positions) {
      console.log(
        `    ${row.assetCode} 收盘 ${row.currentPrice} 汇率 ${fxRates[row.assetCode]} 市值 ${fmt(row.marketValue)} 累计盈亏 ${fmt(row.totalPnl)}`
      );
    }

    if (options.write) {
      await prisma.$transaction(async (tx) => {
        for (const row of result.positions) {
          await tx.$executeRawUnsafe(
            `UPDATE "PositionSnapshot"
                SET "currentPrice" = ?, "marketValue" = ?, "totalPnl" = ?,
                    "dailyPnl" = ?, "dailyPct" = ?, "totalPnlPercent" = ?,
                    "floatingPnl" = ?, "floatingPnlPercent" = ?
              WHERE "portfolioId" = ? AND "date" = ? AND "assetCode" = ?`,
            row.currentPrice,
            row.marketValue,
            row.totalPnl,
            row.dailyPnl,
            row.dailyPct,
            row.totalPnlPercent,
            row.floatingPnl,
            row.floatingPnlPercent,
            options.portfolioId,
            date,
            row.assetCode
          );
        }
        await tx.$executeRawUnsafe(
          `UPDATE "PortfolioSnapshot"
              SET "totalMarketValue" = ?, "netAssets" = ?, "totalPnl" = ?,
                  "dailyPnl" = ?, "unrealizedPnl" = ?, "totalPnlPercent" = ?,
                  "dailyPnlPercent" = ?, "yearlyReturnValue" = ?,
                  "yearlyReturnPercent" = ?,
                  "weeklyReturnPercent" = NULL, "weeklyReturnValue" = NULL,
                  "monthlyReturnPercent" = NULL, "monthlyReturnValue" = NULL,
                  "correctedAt" = CURRENT_TIMESTAMP
            WHERE "portfolioId" = ? AND "date" = ?`,
          result.portfolio.totalMarketValue,
          result.portfolio.netAssets,
          result.portfolio.totalPnl,
          result.portfolio.dailyPnl,
          result.portfolio.unrealizedPnl,
          result.portfolio.totalPnlPercent,
          result.portfolio.dailyPnlPercent,
          result.portfolio.yearlyReturnValue,
          result.portfolio.yearlyReturnPercent,
          options.portfolioId,
          date
        );
      });
    }

    // 修复后的当天成为下一天的锚点（与原锚点之间同样无交易，等式仍成立）
    anchor = {
      portfolio: {
        ...snapshot.portfolio,
        totalMarketValue: result.portfolio.totalMarketValue,
        netAssets: result.portfolio.netAssets,
        totalPnl: result.portfolio.totalPnl,
        unrealizedPnl: result.portfolio.unrealizedPnl,
        leverageUsed:
          anchor.portfolio.leverageUsed ?? snapshot.portfolio.leverageUsed,
      },
      positions: result.positions.map((row) => ({
        assetCode: row.assetCode,
        quantity:
          snapshot.positions.find((item) => item.assetCode === row.assetCode)
            ?.quantity ?? 0,
        currentPrice: row.currentPrice,
        marketValue: row.marketValue,
        totalPnl: row.totalPnl,
        floatingPnl: row.floatingPnl,
      })),
    };
    repaired++;
  }

  console.log(
    `[RepairSnapshots] ${options.write ? '写入' : 'dry-run'} 完成：修复 ${repaired} 天，跳过 ${refused} 天`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[RepairSnapshots] 失败:', error);
    process.exit(1);
  });
