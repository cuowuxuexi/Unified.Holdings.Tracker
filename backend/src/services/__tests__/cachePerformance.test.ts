import { cacheService } from '../cacheService';
import { dataService } from '../dataService';
import { Portfolio, Transaction, TransactionType } from '../../types';
import { performance } from 'perf_hooks';

/**
 * 生成测试用的投资组合数据
 */
function generateTestPortfolios(count: number): Portfolio[] {
  const portfolios: Portfolio[] = [];
  
  for (let i = 0; i < count; i++) {
    const transactions: Transaction[] = [];
    // 每个投资组合生成 100 条交易记录
    for (let j = 0; j < 100; j++) {
      transactions.push({
        id: `tx-${i}-${j}`,
        type: TransactionType.DEPOSIT,
        date: new Date().toISOString(),
        amount: Math.random() * 10000
      });
    }
    
    portfolios.push({
      id: `portfolio-${i}`,
      name: `Test Portfolio ${i}`,
      cash: Math.random() * 100000,
      initialCash: 10000,
      transactions,
      leverage: {
        totalAmount: 0,
        usedAmount: 0,
        availableAmount: 0,
        costRate: 0
      }
    });
  }
  
  return portfolios;
}

describe('缓存性能测试', () => {
  const TEST_PORTFOLIOS = generateTestPortfolios(100); // 生成 100 个测试投资组合
  
  beforeEach(() => {
    // 清空缓存
    cacheService.clear();
    // Mock dataService
    jest.spyOn(dataService, 'readJsonFile').mockImplementation(() => TEST_PORTFOLIOS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('读取性能', () => {
    it('应该显著提升重复读取的性能', async () => {
      const iterations = 1000;
      const portfolioId = 'portfolio-0';
      
      // 不使用缓存的读取时间
      const startWithoutCache = performance.now();
      for (let i = 0; i < iterations; i++) {
        const portfolios = dataService.readJsonFile<Portfolio[]>('portfolios/portfolios.json', []);
        const portfolio = portfolios.find((p: Portfolio) => p.id === portfolioId);
      }
      const timeWithoutCache = performance.now() - startWithoutCache;
      
      // 使用缓存的读取时间
      const startWithCache = performance.now();
      // 第一次读取会缓存数据
      cacheService.set('portfolios:list', TEST_PORTFOLIOS);
      for (let i = 0; i < iterations; i++) {
        const portfolios = cacheService.get<Portfolio[]>('portfolios:list');
        const portfolio = portfolios?.find((p: Portfolio) => p.id === portfolioId);
      }
      const timeWithCache = performance.now() - startWithCache;
      
      console.log(`不使用缓存的读取时间: ${timeWithoutCache}ms`);
      console.log(`使用缓存的读取时间: ${timeWithCache}ms`);
      console.log(`性能提升: ${((timeWithoutCache - timeWithCache) / timeWithoutCache * 100).toFixed(2)}%`);
      
      // 使用缓存应该至少快 50%
      expect(timeWithCache).toBeLessThan(timeWithoutCache * 0.5);
    });
  });

  describe('内存使用', () => {
    it('应该限制缓存大小在合理范围', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // 缓存大量数据
      for (let i = 0; i < 1000; i++) {
        cacheService.set(`test-key-${i}`, TEST_PORTFOLIOS);
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // 转换为 MB
      
      console.log(`内存增加: ${memoryIncrease.toFixed(2)}MB`);
      
      // 内存增加不应超过 100MB
      expect(memoryIncrease).toBeLessThan(100);
    });
  });

  describe('并发性能', () => {
    it('应该在并发访问时保持性能', async () => {
      const concurrentRequests = 100;
      const promises: Promise<void>[] = [];
      
      const startTime = performance.now();
      
      // 模拟并发请求
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          new Promise<void>(async (resolve) => {
            // 随机读取或写入操作
            if (Math.random() > 0.5) {
              cacheService.get('portfolios:list');
            } else {
              cacheService.set(`test-key-${i}`, TEST_PORTFOLIOS[i % TEST_PORTFOLIOS.length]);
            }
            resolve();
          })
        );
      }
      
      await Promise.all(promises);
      
      const timeElapsed = performance.now() - startTime;
      console.log(`${concurrentRequests} 个并发请求耗时: ${timeElapsed}ms`);
      console.log(`平均每个请求耗时: ${(timeElapsed / concurrentRequests).toFixed(2)}ms`);
      
      // 平均每个请求不应超过 1ms
      expect(timeElapsed / concurrentRequests).toBeLessThan(1);
    });
  });

  describe('TTL 性能', () => {
    it('应该高效处理过期缓存', async () => {
      const items = 1000;
      const ttl = 100; // 100ms
      
      // 添加大量即将过期的缓存项
      for (let i = 0; i < items; i++) {
        cacheService.set(`test-key-${i}`, TEST_PORTFOLIOS[i % TEST_PORTFOLIOS.length], ttl);
      }
      
      // 等待缓存过期
      await new Promise(resolve => setTimeout(resolve, ttl + 50));
      
      const startTime = performance.now();
      
      // 尝试访问所有过期的缓存项
      for (let i = 0; i < items; i++) {
        cacheService.get(`test-key-${i}`);
      }
      
      const timeElapsed = performance.now() - startTime;
      console.log(`处理 ${items} 个过期缓存项耗时: ${timeElapsed}ms`);
      console.log(`平均每个过期缓存项处理时间: ${(timeElapsed / items).toFixed(2)}ms`);
      
      // 平均每个过期缓存项的处理时间不应超过 0.1ms
      expect(timeElapsed / items).toBeLessThan(0.1);
    });
  });
}); 