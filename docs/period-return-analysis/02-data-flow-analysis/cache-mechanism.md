# 缓存机制分析

> 最后更新：2025-12-30
> 分析文件：`packages/infra/src/cache/cache-service.ts`, `packages/infra/src/cache/period-cache-service.ts`

---

## 1. 缓存架构概览

### 1.1 多层缓存架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      客户端缓存                                   │
│                  (前端React State)                              │
│                   TTL: 5分钟                                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │ 缓存未命中
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      服务端内存缓存                                │
│                   (NodeCache + Map)                             │
│                   TTL: 5秒 - 24小时                              │
└─────────────────────┬───────────────────────────────────────────┘
                      │ 缓存未命中
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      文件缓存                                     │
│                   (JSON文件 + 定时刷新)                          │
│                   TTL: 永久（直到文件更新）                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │ 缓存未命中
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      外部数据源                                   │
│                (腾讯API + Frankfurter)                          │
│                   TTL: 实时（3-5秒）                             │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 缓存类型分类

| 缓存类型       | 数据                          | TTL      | 用途       |
| -------------- | ----------------------------- | -------- | ---------- |
| **实时行情**   | currentPrice, changePercent等 | 30秒     | 实时显示   |
| **K线数据**    | 历史价格数据                  | 15分钟   | 周期计算   |
| **基准价格**   | 期初/期末价格                 | 1-24小时 | 收益率计算 |
| **周期统计**   | periodReturnPercent等         | 5分钟    | 统计展示   |
| **汇率数据**   | USD-CNY, HKD-CNY              | 每日刷新 | 多币种转换 |
| **已实现盈亏** | realizedPnl                   | 永久     | 交易盈亏   |

---

## 2. 通用缓存服务

### 2.1 CacheService实现

**文档位置**：`packages/infra/src/cache/cache-service.ts`

**设计模式**：单例模式

```typescript
export class CacheService {
  private static instance: CacheService;
  private cache: Map<string, CacheItem<any>>;
  private readonly defaultTTL: number = 5 * 60 * 1000; // 默认5分钟
  private cleanupTimer: NodeJS.Timeout;

  private constructor() {
    this.cache = new Map();
    // 启动定期清理过期数据的任务
    this.cleanupTimer = setInterval(() => this.cleanExpiredItems(), 60 * 1000);
  }
}
```

**设计分析**：

- ✅ 单例模式保证全局唯一
- ✅ 使用Map存储，查找O(1)
- ✅ 自动清理过期数据
- ⚠️ 无内存限制，可能导致内存泄漏

### 2.2 核心方法

#### 2.2.1 设置缓存

```typescript
public set<T>(key: string, value: T, ttl: number = this.defaultTTL): void {
  const expireAt = ttl === 0 ? null : Date.now() + ttl;
  this.cache.set(key, {
    data: value,
    expireAt,
    lastAccess: Date.now(),
  });
  console.log(`[CacheService] Set cache for key: ${key}, TTL: ${ttl}ms`);
}
```

**分析**：

- ✅ 支持自定义TTL
- ✅ TTL=0表示永久缓存
- ✅ 记录设置日志
- ⚠️ 无大小限制

#### 2.2.2 获取缓存

```typescript
public get<T>(key: string): T | null {
  const item = this.cache.get(key);
  if (!item) {
    console.log(`[CacheService] Cache miss for key: ${key}`);
    return null;
  }

  // 检查是否过期
  if (item.expireAt && item.expireAt < Date.now()) {
    console.log(`[CacheService] Cache expired for key: ${key}`);
    this.cache.delete(key);
    return null;
  }

  // 更新最后访问时间
  item.lastAccess = Date.now();
  console.log(`[CacheService] Cache hit for key: ${key}`);
  return item.data as T;
}
```

**分析**：

- ✅ 过期检查
- ✅ LRU准备（更新lastAccess）
- ✅ 详细的命中/未命中日志
- ⚠️ 仅更新访问时间，未实现真正LRU

#### 2.2.3 清理过期项

```typescript
private cleanExpiredItems(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, item] of this.cache.entries()) {
    if (item.expireAt && item.expireAt < now) {
      this.cache.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[CacheService] Cleaned ${cleanedCount} expired items`);
  }
}
```

**分析**：

- ✅ 定期清理
- ✅ 统计清理数量
- ⚠️ 每次都遍历全部缓存项

### 2.3 内存泄漏风险

**问题**：无大小限制，可能导致内存耗尽

```typescript
// 恶意使用示例
for (let i = 0; i < 1000000; i++) {
  cacheService.set(`key-${i}`, `value-${i}`); // 100万条缓存
}
```

**影响**：

- 内存占用持续增长
- GC压力增大
- 服务性能下降

**解决方案**：

```typescript
class CacheService {
  private maxSize = 1000; // 最大缓存项数
  private lruList: LinkedList<string>; // LRU链表

  set<T>(key: string, value: T, ttl: number): void {
    // 1. 检查是否超过最大大小
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // 2. 移除最少使用的项
      const lruKey = this.lruList.removeLast();
      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }

    // 3. 更新LRU列表
    this.lruList.addFirst(key);

    // 4. 设置缓存
    this.cache.set(key, {
      data: value,
      expireAt: ttl === 0 ? null : Date.now() + ttl,
      lastAccess: Date.now(),
    });
  }
}
```

---

## 3. 周期缓存服务

### 3.1 PeriodCacheService实现

**文档位置**：`packages/infra/src/cache/period-cache-service.ts`

**特殊用途**：专为周期计算优化

```typescript
export const periodCacheService = {
  // 基准价格缓存
  async getBasePrice(
    code: string,
    anchorDate: string,
    maxLookbackDays: number
  ): Promise<BasePrice | null> {
    const cacheKey = this.getBasePriceCacheKey(
      code,
      anchorDate,
      maxLookbackDays
    );
    return this.peekBasePrice(cacheKey);
  },

  // 缓存键生成
  getBasePriceCacheKey(
    code: string,
    anchorDate: string,
    maxLookbackDays: number
  ): string {
    return `base-price:${code}:${anchorDate}:${maxLookbackDays}`;
  },
};
```

**分析**：

- ✅ 针对基准价格优化
- ✅ 缓存键设计合理
- ⚠️ 缺少通用缓存接口

### 3.2 记忆化模式

```typescript
rememberBasePrice<T>(
  key: string,
  ttl: number,
  computeFn: () => Promise<T>
): Promise<T> {
  const cached = this.peekBasePrice(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  // 防止重复计算
  const computing = this.computingMap?.get(key);
  if (computing) {
    return computing;
  }

  const promise = computeFn().then((result) => {
    this.cache.set(key, result, ttl);
    this.computingMap?.delete(key);
    return result;
  });

  this.computingMap?.set(key, promise);
  return promise;
}
```

**分析**：

- ✅ 防止重复计算
- ✅ 记忆化模式
- ✅ 异步支持
- ⚠️ 依赖外部缓存服务

### 3.3 TTL配置

```typescript
export const PERIOD_CACHE_TTL = {
  basePrice: {
    day: 60 * 60, // 1小时
    week: 6 * 60 * 60, // 6小时
    month: 24 * 60 * 60, // 24小时
    year: 24 * 60 * 60, // 24小时
  },
  periodStats: 5 * 60, // 5分钟
};
```

**分析**：

- ✅ 基准价格缓存时间较长（1-24小时）
- ✅ 统计数据缓存5分钟
- ⚠️ 缺少TTL说明文档

---

## 4. 缓存策略分析

### 4.1 TTL策略

| 数据类型   | TTL      | 策略     | 合理性              |
| ---------- | -------- | -------- | ------------------- |
| 实时行情   | 30秒     | 短TTL    | ✅ 实时性要求高     |
| K线数据    | 15分钟   | 中TTL    | ✅ 历史数据稳定     |
| 基准价格   | 1-24小时 | 长TTL    | ✅ 价格变化慢       |
| 周期统计   | 5分钟    | 中TTL    | ✅ 平衡实时性和性能 |
| 汇率数据   | 每日刷新 | 定时刷新 | ✅ 符合市场规律     |
| 已实现盈亏 | 永久     | TTL=0    | ✅ 数据不变         |

### 4.2 缓存键设计

```typescript
// 行情缓存键
const quoteKey = `quote:${code}`; // 简单直观

// 批量行情缓存键
const batchQuoteKey = `batch-quote:${codes.sort().join(',')}`; // 排序确保一致性

// K线缓存键
const klineKey = `kline:${code}:${period}:${startDate}:${endDate}:${fq}:${count}`; // 包含所有参数

// 基准价格缓存键
const basePriceKey = `base-price:${code}:${anchorDate}:${maxLookbackDays}`;
```

**设计原则**：

- ✅ 使用前缀分类
- ✅ 包含所有相关参数
- ✅ 确保唯一性
- ⚠️ 键较长可能影响性能

### 4.3 缓存失效策略

#### 4.3.1 TTL过期

```typescript
// 自动过期（清理任务每分钟执行）
if (item.expireAt && item.expireAt < Date.now()) {
  this.cache.delete(key);
}
```

**分析**：

- ✅ 自动清理
- ⚠️ 最多延迟1分钟

#### 4.3.2 主动失效

```typescript
// 删除单个缓存项
cacheService.delete(key);

// 清空所有缓存
cacheService.clear();

// 按前缀删除
function deleteByPrefix(prefix: string): void {
  for (const key of this.cache.keys()) {
    if (key.startsWith(prefix)) {
      this.cache.delete(key);
    }
  }
}
```

**应用场景**：

```typescript
// 重新计算周期统计后，清除相关缓存
deleteByPrefix('stats:');
deleteByPrefix('period-stats:');
```

---

## 5. 缓存命中率分析

### 5.1 命中率计算

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

function calculateHitRate(): number {
  return hits / (hits + misses);
}
```

**目标命中率**：

- 实时行情：70-80%
- K线数据：90%+
- 周期统计：80%+
- 汇率数据：95%+

### 5.2 影响命中率的因素

#### 5.2.1 TTL设置

**过长TTL**：

- ✅ 提高命中率
- ⚠️ 数据可能过时

**过短TTL**：

- ✅ 数据实时性好
- ⚠️ 降低命中率，增加API调用

**建议**：

```typescript
// 根据数据特性设置TTL
const TTL_CONFIG = {
  realtime: {
    tradingHours: 30, // 交易时段：30秒
    afterHours: 300, // 盘后：5分钟
  },
  historical: {
    kline: 900, // K线：15分钟
    basePrice: 3600, // 基准价：1小时
  },
  calculated: {
    periodStats: 300, // 统计：5分钟
    realizedPnl: 0, // 已实现盈亏：永久
  },
};
```

#### 5.2.2 缓存键设计

**问题示例**：

```typescript
// 缓存键1
const key1 = `quote:sh600519`;

// 缓存键2
const key2 = `quote:sz000001`;

// 不同键，相同股票但不同前缀
// 导致缓存重复
```

**解决方案**：

```typescript
// 统一前缀标准
const PREFIX = {
  QUOTE: 'qt',
  KLINE: 'kl',
  BASE_PRICE: 'bp',
  STATS: 'st',
};

const key = `${PREFIX.QUOTE}:${code}`;
```

#### 5.2.3 缓存预热

```typescript
// 应用启动时预加载常用数据
async function warmupCache(): Promise<void> {
  const portfolios = await portfolioRepository.findAll();
  const popularCodes = ['sh600519', 'sz000001', 'hk00700'];

  // 预热行情数据
  await marketDataProvider.getBatchQuotes(popularCodes);

  // 预热汇率数据
  await currencyService.refreshRates();
}
```

---

## 6. 缓存一致性

### 6.1 数据一致性问题

#### 6.1.1 多层缓存不一致

**场景**：

```
内存缓存：茅台价格 1800元（5分钟前）
文件缓存：茅台价格 1850元（1小时前）
实时API：茅台价格 1900元（当前）
```

**问题**：三层缓存数据不同

**解决方案**：

```typescript
// 1. 数据来源优先级
function getQuote(code: string): Quote {
  // 优先级：内存缓存 > 文件缓存 > API
  return memoryCache.get(code) ?? fileCache.get(code) ?? apiFetch(code);
}

// 2. 更新时同步所有层级
function updateQuote(code: string, quote: Quote): void {
  memoryCache.set(code, quote);
  fileCache.set(code, quote);
}
```

#### 6.1.2 并发更新问题

**场景**：

```
线程1：读取缓存，值为100
线程2：更新缓存，值为200
线程1：基于旧值计算，更新为150
结果：缓存值为150（错误，应该是200）
```

**解决方案**：

```typescript
// 使用互斥锁
class MutexCache {
  private locks = new Map<string, Mutex>();

  async get(key: string): Promise<any> {
    const mutex = this.getMutex(key);
    await mutex.lock();
    try {
      return this.cache.get(key);
    } finally {
      mutex.unlock();
    }
  }

  async set(key: string, value: any): Promise<void> {
    const mutex = this.getMutex(key);
    await mutex.lock();
    try {
      this.cache.set(key, value);
    } finally {
      mutex.unlock();
    }
  }
}
```

### 6.2 缓存更新策略

#### 6.2.1 写通（Write Through）

```typescript
async function updateQuote(code: string, quote: Quote): Promise<void> {
  // 1. 更新数据源
  await apiUpdate(code, quote);

  // 2. 更新缓存
  await cacheService.set(code, quote);

  // 3. 更新文件缓存
  await fileCache.set(code, quote);
}
```

**优点**：

- ✅ 缓存始终最新
- ✅ 读操作一定命中缓存

**缺点**：

- ⚠️ 写操作延迟增加

#### 6.2.2 写回（Write Back）

```typescript
async function updateQuote(code: string, quote: Quote): Promise<void> {
  // 1. 仅更新缓存
  await cacheService.set(code, quote);

  // 2. 异步写回数据源
  setTimeout(() => {
    apiUpdate(code, quote);
    fileCache.set(code, quote);
  }, 1000);
}
```

**优点**：

- ✅ 写操作延迟低
- ✅ 批量更新减少API调用

**缺点**：

- ⚠️ 缓存可能丢失
- ⚠️ 数据一致性问题

---

## 7. 性能分析

### 7.1 缓存性能基准

```typescript
// 测试代码
function benchmarkCache(): void {
  const cache = new CacheService();
  const iterations = 100000;

  // 测试SET性能
  const setStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    cache.set(`key-${i}`, `value-${i}`);
  }
  const setDuration = Date.now() - setStart;
  console.log(
    `SET: ${iterations} 次操作耗时 ${setDuration}ms，平均 ${setDuration / iterations}ms/次`
  );

  // 测试GET性能
  const getStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    cache.get(`key-${i}`);
  }
  const getDuration = Date.now() - getStart;
  console.log(
    `GET: ${iterations} 次操作耗时 ${getDuration}ms，平均 ${getDuration / iterations}ms/次`
  );
}
```

**预期结果**：

- SET: ~0.001ms/次
- GET: ~0.0005ms/次

**分析**：

- ✅ Map操作性能极高
- ✅ 适合高频访问

### 7.2 内存使用分析

```typescript
// 估算内存使用
interface CacheItem {
  data: any;
  expireAt: number | null;
  lastAccess: number;
}

// 每项内存估算
const sizePerItem =
  (8 + // 指针
    8 + // data引用
    8 + // expireAt
    8 + // lastAccess
    8) * // Map条目开销
  8; // 假设64位系统

// 10万项缓存占用内存
const totalMemory = (100000 * sizePerItem) / 1024 / 1024; // MB
console.log(`预计内存使用: ${totalMemory.toFixed(2)}MB`);
```

### 7.3 性能优化建议

#### 7.3.1 压缩存储

```typescript
// 使用更紧凑的数据结构
class CompactCache {
  private keys: string[] = [];
  private values: any[] = [];
  private expireAt: (number | null)[] = [];
}
```

#### 7.3.2 分片缓存

```typescript
class ShardedCache {
  private shards: CacheService[] = [];

  constructor(shardCount: number = 4) {
    for (let i = 0; i < shardCount; i++) {
      this.shards.push(new CacheService());
    }
  }

  private getShard(key: string): number {
    const hash = this.hash(key);
    return hash % this.shards.length;
  }

  get(key: string): any {
    return this.shards[this.getShard(key)].get(key);
  }

  set(key: string, value: any): void {
    this.shards[this.getShard(key)].set(key, value);
  }
}
```

---

## 8. 监控与指标

### 8.1 缓存指标

```typescript
interface CacheMetrics {
  hitCount: number;
  missCount: number;
  hitRate: number;
  memoryUsage: number;
  itemCount: number;
  averageItemSize: number;
}

function collectMetrics(): CacheMetrics {
  return {
    hitCount: stats.hits,
    missCount: stats.misses,
    hitRate: stats.hits / (stats.hits + stats.misses),
    memoryUsage: process.memoryUsage().heapUsed,
    itemCount: cache.size(),
    averageItemSize:
      cache.size() > 0 ? process.memoryUsage().heapUsed / cache.size() : 0,
  };
}
```

### 8.2 告警规则

```typescript
const ALERT_RULES = {
  hitRateTooLow: 0.6, // 命中率低于60%
  memoryUsageTooHigh: 500, // 内存使用超过500MB
  itemCountTooHigh: 10000, // 缓存项超过1万
  avgResponseTimeTooHigh: 10, // 平均响应时间超过10ms
};

// 检查告警
function checkAlerts(metrics: CacheMetrics): void {
  if (metrics.hitRate < ALERT_RULES.hitRateTooLow) {
    alert(`缓存命中率过低: ${(metrics.hitRate * 100).toFixed(2)}%`);
  }

  if (metrics.memoryUsage / 1024 / 1024 > ALERT_RULES.memoryUsageTooHigh) {
    alert(
      `缓存内存使用过高: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB`
    );
  }
}
```

### 8.3 可视化监控

```typescript
// 定时输出缓存统计
setInterval(() => {
  const metrics = collectMetrics();
  console.log(`
Cache Metrics:
  Hit Rate: ${(metrics.hitRate * 100).toFixed(2)}%
  Memory: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB
  Items: ${metrics.itemCount}
  Avg Size: ${metrics.averageItemSize.toFixed(2)}bytes
`);
}, 60000); // 每分钟输出一次
```

---

## 9. 最佳实践

### 9.1 缓存键命名规范

```typescript
// ✅ 好的命名
const GOOD_KEYS = {
  quote: 'qt:sh600519', // 简单清晰
  kline: 'kl:sh600519:daily:2025-01-01', // 包含所有参数
  batch: 'bt:sh600519~sz000001', // 批量使用分隔符
  stats: 'st:portfolio-123:daily', // 包含业务ID
};

// ❌ 不好的命名
const BAD_KEYS = {
  vague: 'data1', // 含义不明
  missingParams: 'kline:sh600519', // 缺少必要参数
  inconsistent: 'quote:sh600519', // 与其他地方命名不一致
};
```

### 9.2 TTL设置指南

```typescript
// TTL设置决策树
function getTTL(dataType: string, context: any): number {
  if (dataType === 'realtime-quote') {
    // 交易时段：30秒，盘后：5分钟
    return isTradingHours() ? 30000 : 300000;
  }

  if (dataType === 'kline') {
    // 历史数据：15分钟
    return 900000;
  }

  if (dataType === 'period-stats') {
    // 统计数据：5分钟
    return 300000;
  }

  if (dataType === 'realized-pnl') {
    // 已实现盈亏：永久缓存
    return 0;
  }

  // 默认TTL
  return 300000;
}
```

### 9.3 缓存友好编程

```typescript
// ✅ 好的实践：预先获取可能需要的数据
async function getPortfolioStats(portfolioId: string): Promise<PortfolioStats> {
  const portfolio = await portfolioRepository.findById(portfolioId);
  const positions = await portfolioRepository.getPositions(portfolioId);

  // 预先获取所有股票的行情，避免缓存穿透
  const codes = positions.map((p) => p.asset.code);
  const quotes = await marketDataProvider.getBatchQuotes(codes);

  return calculateStats(portfolio, positions, quotes);
}

// ❌ 不好的实践：循环中多次获取同一数据
async function badExample(positions: Position[]): Promise<void> {
  for (const position of positions) {
    // 每次都调用API，效率极低
    const quote = await fetchQuote(position.asset.code);
    // ...
  }
}
```

---

## 10. 问题诊断

### 10.1 缓存穿透

**现象**：查询一个不存在的数据，每次都直达数据源

**原因**：

- 恶意请求
- 数据已被删除
- 缓存键设计错误

**解决方案**：

```typescript
// 布隆过滤器
class BloomFilter {
  private bits: boolean[] = new Array(1000).fill(false);
  private hashes: number[];

  add(item: string): void {
    // 计算多个哈希值并设置位
  }

  mightContain(item: string): boolean {
    // 检查是否可能存在
  }
}

// 使用布隆过滤器
if (!bloomFilter.mightContain(key)) {
  return null; // 直接返回，避免查询缓存和数据源
}
```

### 10.2 缓存击穿

**现象**：一个热点数据过期瞬间，大量请求直达数据源

**原因**：

- 热点数据过期
- 重建缓存耗时

**解决方案**：

```typescript
// 互斥锁
async function getValue(key: string): Promise<any> {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  // 获取锁
  const lock = await acquireLock(key);
  if (!lock) {
    // 等待其他线程重建缓存
    await sleep(100);
    return cache.get(key);
  }

  try {
    // 重建缓存
    const value = await rebuildCache(key);
    cache.set(key, value);
    return value;
  } finally {
    releaseLock(lock);
  }
}
```

### 10.3 缓存雪崩

**现象**：大量缓存同时过期，请求直达数据源

**原因**：

- 同时设置大量缓存
- TTL设置不合理

**解决方案**：

```typescript
// 随机过期时间
function setWithJitter(key: string, value: any, ttl: number): void {
  const jitter = Math.random() * 0.1 * ttl; // ±10%随机抖动
  const actualTTL = ttl + jitter;
  cache.set(key, value, actualTTL);
}

// 分批设置缓存
async function warmupCache(): Promise<void> {
  const data = await fetchAllData();

  // 分批设置，避免同时过期
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const delay = i * 100; // 每批延迟100ms
    setTimeout(() => {
      cache.set(item.key, item.value, DEFAULT_TTL);
    }, delay);
  }
}
```

---

## 11. 改进建议

### 11.1 高优先级

1. **添加LRU策略**

   ```typescript
   class LRUCache<T> {
     private cache = new Map<string, Node<string, T>>();
     private maxSize = 1000;
   }
   ```

2. **实现分布式缓存**

   ```typescript
   // 使用Redis
   class RedisCache {
     async get(key: string): Promise<T | null> {
       const value = await redis.get(key);
       return value ? JSON.parse(value) : null;
     }
   }
   ```

3. **增强监控**
   ```typescript
   // 上报指标到监控系统
   function reportMetrics(metrics: CacheMetrics): void {
     prometheus.gauge('cache_hit_rate').set(metrics.hitRate);
     prometheus.gauge('cache_memory_usage').set(metrics.memoryUsage);
   }
   ```

### 11.2 中优先级

4. **缓存预热机制**

   ```typescript
   // 应用启动时预热
   async function preloadCache(): Promise<void> {
     const hotData = await fetchHotData();
     for (const item of hotData) {
       cache.set(item.key, item.value);
     }
   }
   ```

5. **缓存统计API**
   ```typescript
   app.get('/api/cache/stats', (req, res) => {
     res.json(collectMetrics());
   });
   ```

### 11.3 低优先级

6. **缓存压缩**

   ```typescript
   // 使用gzip压缩大对象
   function setCompressed(key: string, value: any): void {
     const compressed = gzip(JSON.stringify(value));
     cache.set(key, compressed);
   }
   ```

7. **缓存分区**
   ```typescript
   // 按业务分区
   const cache = {
     quotes: new CacheService(),
     klines: new CacheService(),
     stats: new CacheService(),
   };
   ```

---

## 12. 总结

缓存机制是系统性能的关键，整体设计合理，但存在内存泄漏和一致性问题。建议优先添加LRU策略、增强监控，并考虑引入分布式缓存。

**关键指标**：

- ✅ 缓存策略：7/10
- ⚠️ 性能优化：6/10
- ⚠️ 一致性：6/10
- ⚠️ 监控：5/10

**需改进**：

- 添加LRU策略
- 实现分布式缓存
- 增强监控指标
- 优化TTL策略

---

## 参考文献

- [缓存系统设计最佳实践](https://www.alibabacloud.com/blog/)
- [LRU缓存算法详解](https://leetcode-cn.com/problems/lru-cache/)
- [Redis缓存策略](https://redis.io/documentation)
- [Node.js缓存库对比](https://github.com/30-seconds/30-seconds-of-code)
