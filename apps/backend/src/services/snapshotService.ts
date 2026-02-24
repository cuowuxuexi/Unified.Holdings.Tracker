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
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';

// ==================== 快照存储 ====================

/**
 * 为指定组合拍摄当日快照
 * 使用 upsert 保证幂等：同一组合同一天只有一条
 */
async function takeSnapshotForPortfolio(portfolioId: string): Promise<void> {
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

    const today = format(new Date(), 'yyyy-MM-dd');

    // SQLite upsert: INSERT OR REPLACE 基于 unique(portfolioId, date)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PortfolioSnapshot" ("portfolioId", "date", "totalMarketValue", "netAssets", "totalPnl", "dailyPnl", "cash", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT ("portfolioId", "date") DO UPDATE SET
         "totalMarketValue" = excluded."totalMarketValue",
         "netAssets"        = excluded."netAssets",
         "totalPnl"         = excluded."totalPnl",
         "dailyPnl"         = excluded."dailyPnl",
         "cash"             = excluded."cash",
         "createdAt"        = CURRENT_TIMESTAMP`,
      portfolioId,
      today,
      stats.totalMarketValue,
      stats.netAssets,
      stats.totalPnl,
      stats.dailyPnl,
      stats.cash
    );

    console.log(
      `[SnapshotService] ✅ Snapshot saved: portfolio=${portfolioId}, date=${today}, netAssets=${stats.netAssets.toFixed(2)}`
    );
  } catch (error) {
    console.error(
      `[SnapshotService] ❌ Failed to take snapshot for portfolio ${portfolioId}:`,
      error
    );
  }
}

/**
 * 为所有组合拍摄快照
 */
async function takeSnapshotForAll(): Promise<void> {
  console.log(
    '[SnapshotService] Starting daily snapshot for all portfolios...'
  );
  try {
    const portfolios = await container.listPortfoliosUseCase.execute();
    for (const p of portfolios) {
      await takeSnapshotForPortfolio(p.id);
    }
    console.log(
      `[SnapshotService] ✅ Daily snapshot completed for ${portfolios.length} portfolio(s).`
    );
  } catch (error) {
    console.error(
      '[SnapshotService] ❌ Failed to take snapshots for all portfolios:',
      error
    );
  }
}

// ==================== 定时任务 ====================

let cnJob: schedule.Job | null = null;
let usJob: schedule.Job | null = null;

/**
 * 启动定时快照任务
 * - A股：每个交易日 15:35（北京时间）
 * - 美股：每个交易日次日 05:30（北京时间）
 *
 * 注意：node-schedule 使用系统时区。
 * 简化处理：周一到周五触发（不排除法定节假日，upsert 保证幂等不会出错）
 */
export function startSnapshotScheduler(): void {
  // A股收盘后拍快照: 周一~周五 15:35
  cnJob = schedule.scheduleJob('35 15 * * 1-5', async () => {
    console.log(
      '[SnapshotService] [CN] Cron triggered at',
      new Date().toISOString()
    );
    await takeSnapshotForAll();
  });

  // 美股收盘后拍快照: 周一~周六 05:30（对应前一天美股交易日）
  usJob = schedule.scheduleJob('30 5 * * 1-6', async () => {
    console.log(
      '[SnapshotService] [US] Cron triggered at',
      new Date().toISOString()
    );
    await takeSnapshotForAll();
  });

  console.log('[SnapshotService] ✅ Snapshot scheduler started.');
  console.log('  CN: cron "35 15 * * 1-5" (Mon-Fri 15:35)');
  console.log('  US: cron "30 5 * * 1-6"  (Mon-Sat 05:30)');
}

/**
 * 停止定时任务（优雅关闭用）
 */
export function stopSnapshotScheduler(): void {
  if (cnJob) {
    cnJob.cancel();
    cnJob = null;
  }
  if (usJob) {
    usJob.cancel();
    usJob = null;
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
