import { cacheService } from '../cacheService';
import { dataService } from '../dataService';
import { Portfolio, TransactionType } from '../../types';

const buildPortfolio = (id: string): Portfolio => ({
  id,
  name: `Portfolio ${id}`,
  cash: 1000,
  initialCash: 1000,
  leverage: { totalAmount: 0, usedAmount: 0, availableAmount: 0, costRate: 0 },
  transactions: [
    {
      id: `${id}-tx`,
      type: TransactionType.DEPOSIT,
      date: new Date().toISOString(),
      amount: 1000,
    },
  ],
});

describe('CacheService - performance characteristics', () => {
  beforeEach(() => {
    cacheService.clear();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    cacheService.clear();
  });

  it('should avoid repeated disk reads once data is cached', () => {
    const data = [buildPortfolio('p1')];
    const spy = jest.spyOn(dataService, 'readJsonFile').mockReturnValue(data);

    const cacheKey = 'portfolios:list';

    const load = () => {
      const cached = cacheService.get<typeof data>(cacheKey);
      if (cached) return cached;
      const fresh = dataService.readJsonFile<Portfolio[]>(
        'portfolios/portfolios.json',
        []
      );
      cacheService.set(cacheKey, fresh);
      return fresh;
    };

    load();
    load();
    load();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should evict expired entries and refresh from source when TTL passes', () => {
    jest.useFakeTimers();
    const cacheKey = 'portfolios:list';
    const firstBatch = [buildPortfolio('p1')];
    const secondBatch = [buildPortfolio('p2')];
    const spy = jest
      .spyOn(dataService, 'readJsonFile')
      .mockReturnValueOnce(firstBatch)
      .mockReturnValueOnce(secondBatch);

    const load = () => {
      const cached = cacheService.get<typeof firstBatch>(cacheKey);
      if (cached) return cached;
      const fresh = dataService.readJsonFile<Portfolio[]>(
        'portfolios/portfolios.json',
        []
      );
      cacheService.set(cacheKey, fresh, 50);
      return fresh;
    };

    const initial = load();
    expect(initial[0].id).toBe('p1');

    // advance beyond TTL
    jest.advanceTimersByTime(60);

    const refreshed = load();
    expect(refreshed[0].id).toBe('p2');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
