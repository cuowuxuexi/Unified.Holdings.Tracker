import { cacheService } from './cache-service';

export type PeriodCacheBucket =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'total';

export interface CachedBasePrice {
  price: number | null;
  date: string | null;
}

export const PERIOD_CACHE_TTL = {
  basePrice: {
    week: 60 * 60 * 1000, // 1 hour
    month: 6 * 60 * 60 * 1000, // 6 hours
    year: 24 * 60 * 60 * 1000, // 24 hours
  },
  periodStats: {
    ttl: 5 * 60 * 1000, // 5 minutes
    bucketSize: 5 * 60 * 1000, // 5-minute buckets
  },
} as const;

/**
 * 周期计算缓存服务
 * - 负责 Period Stats（周/月/年）和基准价格的缓存与请求去重
 */
export class PeriodCacheService {
  private readonly basePricePending = new Map<string, Promise<CachedBasePrice>>();
  private readonly periodStatsPending = new Map<string, Promise<any>>();

  /**
   * 获取基准价缓存键
   */
  public getBasePriceCacheKey(
    code: string,
    anchorDate: string,
    lookbackDays: number
  ) {
    return `base-price:${code}:${anchorDate}:${lookbackDays}`;
  }

  /**
    * 获取周期统计缓存键
    */
  public getPeriodStatsCacheKey(
    portfolioId: string,
    period: PeriodCacheBucket,
    bucket: number
  ) {
    return `stats:${portfolioId}:${period}:${bucket}`;
  }

  /**
   * 获取当前时间桶
   */
  public getPeriodStatsTimeBucket(
    bucketSize = PERIOD_CACHE_TTL.periodStats.bucketSize
  ) {
    return Math.floor(Date.now() / bucketSize);
  }

  /**
   * 从缓存中读取基准价
   */
  public peekBasePrice(cacheKey: string) {
    return cacheService.get<CachedBasePrice>(cacheKey);
  }

  /**
   * 记忆化基准价
   */
  public async rememberBasePrice(
    cacheKey: string,
    ttlMs: number,
    loader: () => Promise<CachedBasePrice>
  ) {
    return this.remember(
      this.basePricePending,
      cacheKey,
      ttlMs,
      loader
    ) as Promise<CachedBasePrice>;
  }

  /**
   * 记忆化周期统计
   */
  public async rememberPeriodStats<T>(
    cacheKey: string,
    ttlMs: number,
    loader: () => Promise<T>
  ) {
    return this.remember(this.periodStatsPending, cacheKey, ttlMs, loader);
  }

  private async remember<T>(
    pendingMap: Map<string, Promise<T>>,
    cacheKey: string,
    ttlMs: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const cached = cacheService.get<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const pending = pendingMap.get(cacheKey);
    if (pending) {
      return pending;
    }

    const promise = loader()
      .then((result) => {
        cacheService.set(cacheKey, result, ttlMs);
        return result;
      })
      .finally(() => {
        pendingMap.delete(cacheKey);
      });

    pendingMap.set(cacheKey, promise);
    return promise;
  }
}

export const periodCacheService = new PeriodCacheService();
