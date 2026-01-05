import { subDays } from 'date-fns';
import { fetchKline } from '../tencentApi';
import {
  periodCacheService,
  PERIOD_CACHE_TTL,
} from '@uht/infra/cache/period-cache-service';
import {
  formatDate,
  getLastWeekSaturdayDate,
  getLastDayOfPreviousMonth,
  getLastDayOfPreviousYear,
} from './utils';

const BASE_PRICE_LOOKBACK_DAYS = 120;

/**
 * 获取指定日期的基准价，如果当日无数据则向前回溯
 * @param code 股票代码
 * @param anchorDate 锚点日期
 * @param maxLookbackDays 最大回溯天数
 * @param cacheTTL 缓存过期时间（秒），默认1小时
 * @returns 返回基准价或null
 */
export async function getBasePrice(
  code: string,
  anchorDate: Date,
  maxLookbackDays: number,
  cacheTTL: number = PERIOD_CACHE_TTL.basePrice.week
): Promise<{ price: number | null; date: string | null }> {
  try {
    // 格式化日期为 YYYY-MM-DD
    const endDateStr = formatDate(anchorDate);
    const startDateStr = formatDate(subDays(anchorDate, maxLookbackDays));

    const cacheKey = periodCacheService.getBasePriceCacheKey(
      code,
      endDateStr,
      maxLookbackDays
    );

    const cached = periodCacheService.peekBasePrice(cacheKey);
    if (cached) {
      console.log(
        `[getBasePrice] 缓存命中 ${cacheKey} - 价格: ${cached.price}, 日期: ${cached.date}`
      );
      return cached;
    }

    console.log(`[getBasePrice] 缓存未命中 ${cacheKey}，开始获取K线数据...`);

    return periodCacheService.rememberBasePrice(
      cacheKey,
      cacheTTL,
      async () => {
        const klineData = await fetchKline(
          code,
          'daily',
          startDateStr,
          endDateStr,
          'qfq'
        );

        if (!klineData || klineData.length === 0) {
          console.warn(
            `[getBasePrice] ${code} 在 ${startDateStr} 至 ${endDateStr} 期间无K线数据`
          );
          return { price: null, date: null };
        }

        const sortedKline = [...klineData].sort((a, b) =>
          b.date.localeCompare(a.date)
        );

        for (const point of sortedKline) {
          if (point.close && !isNaN(point.close)) {
            const result = {
              price: point.close,
              date: point.date,
            };

            const actualDate = new Date(point.date);
            const daysDiff = Math.floor(
              (anchorDate.getTime() - actualDate.getTime()) /
                (1000 * 60 * 60 * 24)
            );

            if (daysDiff > 0) {
              console.log(
                `[getBasePrice] ${code} 目标日期 ${endDateStr} 无数据，使用 ${point.date} 的价格 ${point.close}（回溯 ${daysDiff} 天）`
              );
            } else {
              console.log(
                `[getBasePrice] ${code} 成功获取基准价格: ${point.close} (日期: ${point.date})`
              );
            }
            return result;
          }
        }

        console.warn(
          `[getBasePrice] ${code} 在 ${maxLookbackDays} 天回溯窗口内无有效收盘价`
        );
        return { price: null, date: null };
      }
    );
  } catch (error) {
    console.error(`[getBasePrice] ${code} 获取基准价格失败:`, error);
    return { price: null, date: null };
  }
}

/**
 * 获取年线基准价（今年1月1日，向前回溯最多120天）
 * 缓存24小时
 */
export async function getYearBasePrice(
  code: string,
  today: Date = new Date()
): Promise<{ price: number | null; date: string | null }> {
  const lastDayOfPrevYear = getLastDayOfPreviousYear(today);
  const result = await getBasePrice(
    code,
    lastDayOfPrevYear,
    BASE_PRICE_LOOKBACK_DAYS,
    PERIOD_CACHE_TTL.basePrice.year
  ); // 120天回溯，24小时缓存

  if (result.price) {
    console.log(
      `[getYearBasePrice] ${code} 年线基准价: ${result.price} (日期: ${result.date})`
    );
  } else {
    console.warn(`[getYearBasePrice] ${code} 无法获取年线基准价`);
  }

  return result;
}

/**
 * 获取月线基准价（本月1日，向前回溯最多120天）
 * 缓存6小时
 */
export async function getMonthBasePrice(
  code: string,
  today: Date = new Date()
): Promise<{ price: number | null; date: string | null }> {
  const lastDayOfPrevMonth = getLastDayOfPreviousMonth(today);
  const result = await getBasePrice(
    code,
    lastDayOfPrevMonth,
    BASE_PRICE_LOOKBACK_DAYS,
    PERIOD_CACHE_TTL.basePrice.month
  ); // 120天回溯，6小时缓存

  if (result.price) {
    console.log(
      `[getMonthBasePrice] ${code} 月线基准价: ${result.price} (日期: ${result.date})`
    );
  } else {
    console.warn(`[getMonthBasePrice] ${code} 无法获取月线基准价`);
  }

  return result;
}

/**
 * 获取周线基准价（上周最后一个交易日，通常为上周五，向前回溯最多120天）
 * 缓存1小时
 */
export async function getWeekBasePrice(
  code: string,
  today: Date = new Date()
): Promise<{ price: number | null; date: string | null }> {
  const thisWeekMonday = getLastWeekSaturdayDate(today);
  const lastWeekFriday = subDays(thisWeekMonday, 3);

  console.log(
    `[getWeekBasePrice] ${code} 目标日期: ${formatDate(lastWeekFriday)} (上周五)`
  );

  const result = await getBasePrice(
    code,
    lastWeekFriday,
    BASE_PRICE_LOOKBACK_DAYS,
    PERIOD_CACHE_TTL.basePrice.week
  ); // 120天回溯，1小时缓存

  if (result.price) {
    console.log(
      `[getWeekBasePrice] ${code} 周线基准价: ${result.price} (日期: ${result.date})`
    );
  } else {
    console.warn(`[getWeekBasePrice] ${code} 无法获取周线基准价`);
  }

  return result;
}
