import { cacheService } from '@uht/infra/cache/cache-service';
import {
  periodCacheService,
  PERIOD_CACHE_TTL,
} from '@uht/infra/cache/period-cache-service';

describe('PeriodCacheService', () => {
  beforeEach(() => {
    cacheService.clear();
  });

  it('deduplicates base price requests', async () => {
    const cacheKey = periodCacheService.getBasePriceCacheKey(
      'sh600519',
      '2025-01-10',
      15
    );
    const loader = jest.fn().mockResolvedValue({
      price: 100,
      date: '2025-01-10',
    });

    const [first, second] = await Promise.all([
      periodCacheService.rememberBasePrice(
        cacheKey,
        PERIOD_CACHE_TTL.basePrice.week,
        loader
      ),
      periodCacheService.rememberBasePrice(
        cacheKey,
        PERIOD_CACHE_TTL.basePrice.week,
        loader
      ),
    ]);

    expect(first).toEqual(second);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('caches period stats using time buckets', async () => {
    const bucket = periodCacheService.getPeriodStatsTimeBucket(1000);
    const cacheKey = periodCacheService.getPeriodStatsCacheKey(
      'portfolio-1',
      'weekly',
      bucket
    );
    const loader = jest.fn().mockResolvedValue({
      periodReturnPercent: 0.02,
      periodPnl: 200,
    });

    const first = await periodCacheService.rememberPeriodStats(
      cacheKey,
      PERIOD_CACHE_TTL.periodStats.ttl,
      loader
    );
    const second = await periodCacheService.rememberPeriodStats(
      cacheKey,
      PERIOD_CACHE_TTL.periodStats.ttl,
      loader
    );

    expect(first).toEqual(second);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
