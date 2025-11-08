/**
 * 缓存服务：提供统一的内存缓存机制
 * 使用 Map 实现简单的内存缓存，支持 TTL 和手动失效
 */

type CacheItem<T> = {
  data: T;
  expireAt: number | null; // null 表示永不过期
  lastAccess: number;
};

export class CacheService {
  private static instance: CacheService;
  private cache: Map<string, CacheItem<any>>;
  private readonly defaultTTL: number = 5 * 60 * 1000; // 默认 5 分钟过期

  private constructor() {
    this.cache = new Map();
    // 启动定期清理过期数据的任务
    setInterval(() => this.cleanExpiredItems(), 60 * 1000); // 每分钟清理一次
  }

  /**
   * 获取 CacheService 单例实例
   */
  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  /**
   * 设置缓存项
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（毫秒），默认 5 分钟，设为 0 表示永不过期
   */
  public set<T>(key: string, value: T, ttl: number = this.defaultTTL): void {
    const expireAt = ttl === 0 ? null : Date.now() + ttl;
    this.cache.set(key, {
      data: value,
      expireAt,
      lastAccess: Date.now(),
    });
    console.log(`[CacheService] Set cache for key: ${key}, TTL: ${ttl}ms`);
  }

  /**
   * 获取缓存项
   * @param key 缓存键
   * @returns 缓存值，如果不存在或已过期则返回 null
   */
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

  /**
   * 删除缓存项
   * @param key 缓存键
   */
  public delete(key: string): void {
    this.cache.delete(key);
    console.log(`[CacheService] Deleted cache for key: ${key}`);
  }

  /**
   * 清空所有缓存
   */
  public clear(): void {
    this.cache.clear();
    console.log('[CacheService] Cleared all cache');
  }

  /**
   * 获取缓存项数量
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * 检查缓存项是否存在且未过期
   * @param key 缓存键
   */
  public has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;
    if (item.expireAt && item.expireAt < Date.now()) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 批量删除指定前缀的缓存项
   * @param prefix 缓存键前缀
   */
  public deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        console.log(`[CacheService] Deleted cache with prefix ${prefix} for key: ${key}`);
      }
    }
  }

  /**
   * 清理过期的缓存项
   */
  private cleanExpiredItems(): void {
    const now = Date.now();
    let expiredCount = 0;
    for (const [key, item] of this.cache.entries()) {
      if (item.expireAt && item.expireAt < now) {
        this.cache.delete(key);
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      console.log(`[CacheService] Cleaned ${expiredCount} expired cache items`);
    }
  }
}

// 导出单例实例
export const cacheService = CacheService.getInstance(); 