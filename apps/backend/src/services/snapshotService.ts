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
import { format, startOfWeek, endOfWeek, subWeeks, subDays } from 'date-fns';
import { Position } from '@uht/domain';

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

    // 1. 写入组合级快照
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
      snapshotDate,
      stats.totalMarketValue,
      stats.netAssets,
      stats.totalPnl,
      stats.dailyPnl,
      stats.cash
    );

    // 2. 写入个股快照
    for (const pos of stats.positions) {
      await upsertPositionSnapshot(portfolioId, snapshotDate, pos);
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

async function upsertPositionSnapshot(
  portfolioId: string,
  date: string,
  pos: Position
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PositionSnapshot"
       ("portfolioId", "date", "assetCode", "quantity", "currentPrice", "marketValue")
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT ("portfolioId", "date", "assetCode") DO UPDATE SET
       "quantity"     = excluded."quantity",
       "currentPrice" = excluded."currentPrice",
       "marketValue"  = excluded."marketValue"`,
    portfolioId,
    date,
    pos.asset.code,
    pos.quantity,
    pos.currentPrice ?? 0,
    pos.marketValue ?? 0
  );
}

/**
 * 为所有组合拍摄快照
 */
async function takeSnapshotForAll(dateOverride?: string): Promise<void> {
  console.log(
    '[SnapshotService] Starting daily snapshot for all portfolios...'
  );
  try {
    const portfolios = await container.listPortfoliosUseCase.execute();
    for (const p of portfolios) {
      await takeSnapshotForPortfolio(p.id, dateOverride);
    }
    console.log(
      `[SnapshotService] ✅ Daily snapshot completed for ${portfolios.length} portfolio(s).`
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
