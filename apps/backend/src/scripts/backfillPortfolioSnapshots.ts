/**
 * 历史持仓快照（PositionSnapshot）补齐脚本
 *
 * 针对 position_history_missing 缺口：某些日期已有 PortfolioSnapshot（组合级），
 * 但缺少当天的 PositionSnapshot（持仓明细）。本脚本按交易回放（LotTracker）
 * + 历史 K 线（不复权）+ 历史汇率（ExchangeRateSnapshot），为这些日期补齐缺失的
 * PositionSnapshot 行。
 *
 * 安全语义：
 * - 默认 dry-run，只打印将写入的内容；
 * - --write 时必须带 --confirm-db <数据库文件名> 且 DATABASE_URL 指向 SQLite；
 * - 只驱动“窗口内已存在 PortfolioSnapshot 的日期”，绝不创建新的 PortfolioSnapshot
 *   （组合级历史是真实观测，不伪造）；含周末/节假日快照日，价格向前取最近收盘价；
 * - 已存在的 PositionSnapshot 行不覆盖，只补缺失的 (date, assetCode)。
 *
 * 用法（容器内）：
 *   node dist/backfill-portfolio-snapshots.js \
 *     --portfolio-id <id> --date-from 2026-02-25 --date-to 2026-03-02 \
 *     [--write --confirm-db portfolio.db]
 */

import { prisma } from '../lib/prisma';
import { container } from '../container';
import { fetchKline } from '../services/tencentApi';
import { LotTracker } from '../services/portfolioReplay';
import { KlinePoint, Transaction, TransactionType } from '../types';

interface CliOptions {
  portfolioId: string;
  dateFrom: string;
  dateTo: string;
  write: boolean;
  confirmDb: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      options[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
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

/** 取 <= date 的最近 K 线点；再往前一个点作为“前收”参考 */
function findKlineAtOrBefore(
  kline: KlinePoint[],
  date: string
): { current: KlinePoint | null; prev: KlinePoint | null } {
  let current: KlinePoint | null = null;
  let prev: KlinePoint | null = null;
  for (const point of kline) {
    if (point.date <= date) {
      prev = current;
      current = point;
    } else {
      break;
    }
  }
  return { current, prev };
}

function marketPrefix(assetCode: string): 'cn' | 'hk' | 'us' {
  const prefix = assetCode.slice(0, 2).toLowerCase();
  if (prefix === 'hk') return 'hk';
  if (prefix === 'us') return 'us';
  return 'cn';
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

  // 只驱动“窗口内已有 PortfolioSnapshot 的日期”，绝不创建新的组合快照
  const snapshotDates = (
    await prisma.portfolioSnapshot.findMany({
      where: {
        portfolioId: options.portfolioId,
        date: { gte: options.dateFrom, lte: options.dateTo },
      },
      orderBy: { date: 'asc' },
      select: { date: true },
    })
  ).map((row) => row.date);

  if (snapshotDates.length === 0) {
    console.log(
      `[BackfillSnapshots] 窗口 ${options.dateFrom}..${options.dateTo} 内无 PortfolioSnapshot，无需补持仓明细`
    );
    return;
  }

  const sortedTransactions = [...(portfolio.transactions ?? [])].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const assetCodes = Array.from(
    new Set(
      sortedTransactions
        .filter((tx) => tx.assetCode)
        .map((tx) => tx.assetCode as string)
    )
  );

  // K 线（不复权，与线上快照存储的实际收盘价一致）；向前多取 40 天覆盖节假日回退
  const klineFrom = shiftDate(snapshotDates[0], -40);
  const klineMap = new Map<string, KlinePoint[]>();
  for (const code of assetCodes) {
    const kline = await fetchKline(
      code,
      'daily',
      klineFrom,
      options.dateTo,
      'none'
    );
    klineMap.set(code, kline ?? []);
    if (!kline || kline.length === 0) {
      console.warn(`[BackfillSnapshots] ${code} 无 K 线数据，将回退成本价估值`);
    }
  }

  // 历史汇率（此前已回补完整的每日序列）
  const fxRows = await prisma.exchangeRateSnapshot.findMany({
    where: {
      date: { gte: shiftDate(snapshotDates[0], -14), lte: options.dateTo },
    },
    orderBy: { date: 'asc' },
    select: { date: true, pair: true, rate: true },
  });
  const fxSeries = new Map<string, Array<{ date: string; rate: number }>>();
  for (const row of fxRows) {
    const list = fxSeries.get(row.pair) ?? [];
    list.push({ date: row.date, rate: Number(row.rate) });
    fxSeries.set(row.pair, list);
  }
  const fxAt = (pair: string, date: string): number | null => {
    const list = fxSeries.get(pair) ?? [];
    let value: number | null = null;
    for (const item of list) {
      if (item.date <= date) value = item.rate;
      else break;
    }
    return value;
  };
  const rateForAsset = (code: string, date: string): number => {
    const market = marketPrefix(code);
    if (market === 'hk') return fxAt('HKD-CNY', date) ?? 0.92;
    if (market === 'us') return fxAt('USD-CNY', date) ?? 7.2;
    return 1;
  };

  const existingPositionKeys = new Set(
    (
      await prisma.positionSnapshot.findMany({
        where: {
          portfolioId: options.portfolioId,
          date: { gte: options.dateFrom, lte: options.dateTo },
        },
        select: { date: true, assetCode: true },
      })
    ).map((row) => `${row.date}:${row.assetCode}`)
  );

  // 增量回放持仓状态
  const tracker = new LotTracker();
  let txIndex = 0;
  const applyTransactionsThrough = (date: string): void => {
    while (
      txIndex < sortedTransactions.length &&
      sortedTransactions[txIndex].date.slice(0, 10) <= date
    ) {
      const tx = sortedTransactions[txIndex++] as Transaction;
      if (tx.type === TransactionType.BUY) tracker.applyBuy(tx);
      else if (tx.type === TransactionType.SELL) tracker.applySell(tx);
    }
  };

  let positionSnapshotsToCreate = 0;
  let datesSkippedComplete = 0;

  for (const date of snapshotDates) {
    applyTransactionsThrough(date);

    interface PositionRow {
      assetCode: string;
      quantity: number;
      currentPrice: number;
      marketValue: number;
      costPrice: number | null;
      totalPnl: number | null;
      dailyPnl: number | null;
      dailyPct: number | null;
      totalPnlPercent: number | null;
      floatingPnl: number | null;
      floatingPnlPercent: number | null;
    }

    const positionRows: PositionRow[] = [];
    for (const [code, state] of tracker.getPositionsSnapshot().entries()) {
      if (state.quantity <= 0) continue;
      const { current, prev } = findKlineAtOrBefore(
        klineMap.get(code) ?? [],
        date
      );
      const costPrice =
        state.quantity > 0 ? state.totalCostLocal / state.quantity : null;
      const price = current?.close ?? costPrice;
      if (price === null || !Number.isFinite(price)) {
        console.warn(
          `[BackfillSnapshots] ${date} ${code} 无法确定价格，跳过该持仓`
        );
        continue;
      }
      const rate = rateForAsset(code, date);
      const marketValue = state.quantity * price * rate;
      const floatingPnl =
        costPrice !== null ? (price - costPrice) * state.quantity * rate : null;
      const floatingPnlPercent =
        costPrice !== null && costPrice > 0
          ? ((price - costPrice) / costPrice) * 100
          : null;
      const prevClose = prev?.close ?? null;
      const dailyPnl =
        current && prevClose !== null
          ? (price - prevClose) * state.quantity * rate
          : null;
      const dailyPct =
        current && prevClose !== null && prevClose > 0
          ? ((price - prevClose) / prevClose) * 100
          : null;

      positionRows.push({
        assetCode: code,
        quantity: state.quantity,
        currentPrice: price,
        marketValue,
        costPrice,
        totalPnl: floatingPnl,
        dailyPnl,
        dailyPct,
        totalPnlPercent: floatingPnlPercent,
        floatingPnl,
        floatingPnlPercent,
      });
    }

    const missingPositions = positionRows.filter(
      (row) => !existingPositionKeys.has(`${date}:${row.assetCode}`)
    );

    if (missingPositions.length === 0) {
      datesSkippedComplete++;
      continue;
    }

    const totalMarketValue = positionRows.reduce(
      (sum, row) => sum + row.marketValue,
      0
    );
    console.log(
      `[BackfillSnapshots] ${date} | 持仓 ${positionRows.length} 只(补 ${missingPositions.length}) | ` +
        `市值 ${totalMarketValue.toFixed(2)}`
    );
    positionSnapshotsToCreate += missingPositions.length;

    if (!options.write) continue;

    await prisma.$transaction(async (tx) => {
      for (const row of missingPositions) {
        await tx.positionSnapshot.create({
          data: {
            portfolioId: options.portfolioId,
            date,
            ...row,
          },
        });
      }
    });
  }

  console.log(
    `[BackfillSnapshots] ${options.write ? '写入' : 'dry-run'} 完成: ` +
      `持仓快照补写 ${positionSnapshotsToCreate} 行，跳过已完整 ${datesSkippedComplete} 天`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[BackfillSnapshots] 失败:', error);
    process.exit(1);
  });
