import { fetchKline } from '../tencentApi';

export interface BasePriceResult {
  price: number;
  date: string;
}

/**
 * 获取周度基准价：取周K倒数第二条收盘价（上一个完整周的收盘）
 */
export async function getWeekBasePrice(
  code: string,
  _today: Date = new Date()
): Promise<BasePriceResult | null> {
  const klineData = await fetchKline(
    code,
    'weekly',
    undefined,
    undefined,
    'qfq',
    2
  );
  if (!klineData || klineData.length === 0) return null;
  // 取倒数第二条（最后一条是本周进行中的K线）
  const point =
    klineData.length >= 2
      ? klineData[klineData.length - 2]
      : klineData[klineData.length - 1];
  return { price: point.close, date: point.date };
}

/**
 * 获取月度基准价：取月K倒数第二条收盘价（上一个完整月的收盘）
 */
export async function getMonthBasePrice(
  code: string,
  _today: Date = new Date()
): Promise<BasePriceResult | null> {
  const klineData = await fetchKline(
    code,
    'monthly',
    undefined,
    undefined,
    'qfq',
    2
  );
  if (!klineData || klineData.length === 0) return null;
  // 取倒数第二条（最后一条是本月进行中的K线）
  const point =
    klineData.length >= 2
      ? klineData[klineData.length - 2]
      : klineData[klineData.length - 1];
  return { price: point.close, date: point.date };
}

/**
 * 获取年度基准价：取上一年12月月K的收盘价（去年年末收盘价 = 年度起点）
 * 注意：腾讯年K API 只返回当年进行中的K线，无法获取去年全年K线，
 * 因此用月K请求上一年12月份数据作为年度基准。
 */
export async function getYearBasePrice(
  code: string,
  today: Date = new Date()
): Promise<BasePriceResult | null> {
  const prevYear = today.getFullYear() - 1;
  const startDate = `${prevYear}-12-01`;
  const endDate = `${prevYear}-12-31`;
  const klineData = await fetchKline(
    code,
    'monthly',
    startDate,
    endDate,
    'qfq',
    1
  );
  if (!klineData || klineData.length === 0) return null;
  const point = klineData[klineData.length - 1];
  return { price: point.close, date: point.date };
}
