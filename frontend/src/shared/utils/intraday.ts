import type { IntradayPoint } from '../../store/types';

// 各市场连续竞价时段（交易所当地时间，分钟数）；A 股、港股有午休
const SESSIONS: Record<'cn' | 'hk' | 'us', Array<[number, number]>> = {
  cn: [
    [9 * 60 + 30, 11 * 60 + 30],
    [13 * 60, 15 * 60],
  ],
  hk: [
    [9 * 60 + 30, 12 * 60],
    [13 * 60, 16 * 60],
  ],
  us: [[9 * 60 + 30, 16 * 60]],
};

const pad = (n: number) => String(n).padStart(2, '0');
const toLabel = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export const marketOfCode = (code: string): 'cn' | 'hk' | 'us' =>
  code.startsWith('hk') ? 'hk' : code.startsWith('us') ? 'us' : 'cn';

/**
 * 整个交易日的分钟刻度（含开盘、收盘那一分钟），用作分时图 x 轴，
 * 盘中未走完的部分留空，走势只画到当前时刻
 */
export const buildSessionSlots = (code: string): string[] =>
  SESSIONS[marketOfCode(code)].flatMap(([start, end]) =>
    Array.from({ length: end - start + 1 }, (_, i) => toLabel(start + i))
  );

/** 腾讯分时给的是当日累计成交量，差分得到每分钟成交量 */
export const perMinuteVolumes = (points: IntradayPoint[]): number[] =>
  points.map((point, i) =>
    Math.max(
      0,
      point.cumulativeVolume - (i > 0 ? points[i - 1].cumulativeVolume : 0)
    )
  );
