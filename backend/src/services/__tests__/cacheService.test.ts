import { cacheService } from '../cacheService';

describe('CacheService', () => {
  beforeEach(() => {
    // 每个测试前清空缓存
    cacheService.clear();
  });

  describe('基本操作', () => {
    it('应该能够设置和获取缓存项', () => {
      const key = 'test-key';
      const value = { id: 1, name: 'test' };
      
      cacheService.set(key, value);
      const result = cacheService.get(key);
      
      expect(result).toEqual(value);
    });

    it('应该返回 null 当缓存项不存在', () => {
      const result = cacheService.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('应该能够删除缓存项', () => {
      const key = 'test-key';
      const value = { id: 1, name: 'test' };
      
      cacheService.set(key, value);
      cacheService.delete(key);
      
      const result = cacheService.get(key);
      expect(result).toBeNull();
    });

    it('应该能够清空所有缓存', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      cacheService.clear();
      
      expect(cacheService.get('key1')).toBeNull();
      expect(cacheService.get('key2')).toBeNull();
      expect(cacheService.size()).toBe(0);
    });
  });

  describe('TTL 功能', () => {
    it('应该在 TTL 过期后返回 null', async () => {
      const key = 'ttl-test';
      const value = { id: 1, name: 'test' };
      const ttl = 100; // 100ms
      
      cacheService.set(key, value, ttl);
      
      // 立即获取应该存在
      expect(cacheService.get(key)).toEqual(value);
      
      // 等待 TTL 过期
      await new Promise(resolve => setTimeout(resolve, ttl + 50));
      
      // TTL 过期后应该返回 null
      expect(cacheService.get(key)).toBeNull();
    });

    it('应该支持永不过期的缓存项', async () => {
      const key = 'no-ttl-test';
      const value = { id: 1, name: 'test' };
      
      cacheService.set(key, value, 0); // TTL = 0 表示永不过期
      
      // 等待一段时间
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 应该仍然存在
      expect(cacheService.get(key)).toEqual(value);
    });
  });

  describe('前缀操作', () => {
    it('应该能够批量删除指定前缀的缓存项', () => {
      cacheService.set('test:1', 'value1');
      cacheService.set('test:2', 'value2');
      cacheService.set('other:1', 'value3');
      
      cacheService.deleteByPrefix('test:');
      
      expect(cacheService.get('test:1')).toBeNull();
      expect(cacheService.get('test:2')).toBeNull();
      expect(cacheService.get('other:1')).not.toBeNull();
    });
  });

  describe('has 方法', () => {
    it('应该正确检查缓存项是否存在', () => {
      const key = 'exists-test';
      const value = { id: 1, name: 'test' };
      
      cacheService.set(key, value);
      
      expect(cacheService.has(key)).toBe(true);
      expect(cacheService.has('non-existent-key')).toBe(false);
    });

    it('应该在 TTL 过期后返回 false', async () => {
      const key = 'ttl-exists-test';
      const value = { id: 1, name: 'test' };
      const ttl = 100; // 100ms
      
      cacheService.set(key, value, ttl);
      
      expect(cacheService.has(key)).toBe(true);
      
      // 等待 TTL 过期
      await new Promise(resolve => setTimeout(resolve, ttl + 50));
      
      expect(cacheService.has(key)).toBe(false);
    });
  });
}); 