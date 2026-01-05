import { subDays, parseISO } from 'date-fns';
import { Transaction, KlinePoint } from '../../types';
import crypto from 'crypto';

/**
 * 格式化日期为 YYYY-MM-DD (本地时区)
 * 注意:不使用 toISOString() 避免 UTC 时区转换导致的日期偏移
 */
export function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取本周一的日期（一周的开始）
 * 注意：周一是一周的第一天，周日是一周的最后一天
 */
export function getLastWeekSaturdayDate(today: Date): Date {
  const dayOfWeek = today.getDay(); // 0=周日, 1=周一, 2=周二, ..., 6=周六
  // 计算距离本周一的天数
  // 周日(0)→回退到上周一(6天前)
  // 周一(1)→0天（今天就是周一）
  // 周二(2)→1天, 周三(3)→2天, ..., 周六(6)→5天
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return subDays(today, daysToMonday);
}

/**
 * 获取本月第一天（月度统计起始日）
 * 注意：月度收益应该从本月1日开始计算
 */
export function getFirstDayOfCurrentMonth(today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

/**
 * 获取上个月最后一天（已废弃，请使用 getFirstDayOfCurrentMonth）
 * @deprecated 请使用 getFirstDayOfCurrentMonth 计算月度起始日
 */
export function getLastDayOfPreviousMonth(today: Date): Date {
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  return subDays(firstDayOfMonth, 1);
}

/**
 * 获取本年第一天（年度统计起始日）
 * 注意：年度收益应该从今年1月1日开始计算
 */
export function getFirstDayOfCurrentYear(today: Date): Date {
  return new Date(today.getFullYear(), 0, 1);
}

/**
 * 获取去年最后一天（已废弃，请使用 getFirstDayOfCurrentYear）
 * @deprecated 请使用 getFirstDayOfCurrentYear 计算年度起始日
 */
export function getLastDayOfPreviousYear(today: Date): Date {
  const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
  return subDays(firstDayOfYear, 1);
}

/**
 * Finds the closest K-line point on or before a target date.
 * @param klineData Array of K-line points.
 * @param targetDate The target date string (YYYY-MM-DD).
 * @returns The closest KlinePoint or null if none found.
 */
export function findClosestKlinePoint(
  klineData: KlinePoint[],
  targetDate: string
): KlinePoint | null {
  if (!klineData || klineData.length === 0) return null;
  const targetDateTime = parseISO(targetDate).getTime();
  let closestPoint: KlinePoint | null = null;
  let closestDiff = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < klineData.length; i++) {
    const point = klineData[i];
    const pointDateStr = point.date;
    const pointDate = parseISO(pointDateStr);
    const pointDateTime = pointDate.getTime();
    // 调试日志：打印每个K线点与目标日期的对比
    console.log(
      `[DEBUG] K线点: ${pointDateStr}, 目标: ${targetDate}, 解析: ${pointDateTime}, 目标: ${targetDateTime}, 差值: ${targetDateTime - pointDateTime}`
    );
    if (pointDateTime <= targetDateTime) {
      const diff = targetDateTime - pointDateTime;
      if (diff < closestDiff) {
        closestDiff = diff;
        closestPoint = point;
      }
    }
  }
  // 额外日志：最终选中的K线点
  if (closestPoint) {
    console.log(`[DEBUG] 最终选中的K线点: ${closestPoint.date}`);
  } else {
    console.log('[DEBUG] 未找到合适的K线点');
  }
  return closestPoint;
}

/**
 * 生成交易记录的内容哈希值（用于缓存键）
 *
 * @description
 * 【问题4修复】使用完整交易内容哈希，而非交易数量+最后交易ID
 *
 * 原问题：
 * - 旧实现：`${transactions.length}-${lastTx.id}`
 * - 删除交易后，如果总数和最后ID相同，hash不变，导致缓存未失效
 *
 * 新方案：
 * - 对所有交易ID排序后生成SHA256哈希
 * - 交易的增删改都会导致哈希变化
 * - 确保缓存一致性
 *
 * @param transactions 交易记录数组
 * @returns 交易内容的SHA256哈希值（16进制字符串，取前16位）
 */
export function hashTransactions(transactions: Transaction[]): string {
  if (transactions.length === 0) return '0';

  // 收集所有交易ID并排序（确保稳定性）
  const txIds = transactions
    .map(tx => tx.id)
    .filter(Boolean)
    .sort();

  // 如果没有ID，回退到交易数量
  if (txIds.length === 0) {
    console.warn('[hashTransactions] 交易记录缺少ID，使用交易数量作为哈希');
    return `${transactions.length}`;
  }

  // 生成内容哈希
  const content = txIds.join('|');
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  // 取前16位作为哈希值（足够唯一且简洁）
  return hash.substring(0, 16);
}
