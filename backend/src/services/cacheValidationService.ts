import { dataService } from './dataService';
import { cacheService } from './cacheService';
import { Portfolio } from '../types';

/**
 * 缓存验证服务：用于验证缓存数据的一致性
 */
export class CacheValidationService {
  private static instance: CacheValidationService;
  private readonly PORTFOLIOS_FILE = 'portfolios/portfolios.json';
  private readonly PORTFOLIOS_CACHE_KEY = 'portfolios:list';
  private readonly PORTFOLIO_CACHE_PREFIX = 'portfolio:';

  private constructor() {
    // 启动定期验证任务
    setInterval(() => this.validateAllCaches(), 15 * 60 * 1000); // 每15分钟验证一次
  }

  public static getInstance(): CacheValidationService {
    if (!CacheValidationService.instance) {
      CacheValidationService.instance = new CacheValidationService();
    }
    return CacheValidationService.instance;
  }

  /**
   * 验证所有缓存数据
   */
  public async validateAllCaches(): Promise<void> {
    console.log('[CacheValidation] 开始验证所有缓存...');
    
    try {
      // 验证投资组合列表缓存
      await this.validatePortfoliosCache();
      
      // 验证单个投资组合缓存
      await this.validateIndividualPortfolioCaches();
      
      console.log('[CacheValidation] 缓存验证完成');
    } catch (error) {
      console.error('[CacheValidation] 缓存验证过程中发生错误:', error);
    }
  }

  /**
   * 验证投资组合列表缓存
   */
  private async validatePortfoliosCache(): Promise<void> {
    console.log('[CacheValidation] 验证投资组合列表缓存...');
    
    try {
      // 从缓存获取数据
      const cachedPortfolios = cacheService.get<Portfolio[]>(this.PORTFOLIOS_CACHE_KEY);
      
      // 从文件获取数据
      const filePortfolios = dataService.readJsonFile<Portfolio[]>(this.PORTFOLIOS_FILE, []);
      
      if (!cachedPortfolios) {
        console.log('[CacheValidation] 投资组合列表缓存不存在，无需验证');
        return;
      }

      // 比较数据
      const isValid = this.comparePortfoliosData(cachedPortfolios, filePortfolios);
      
      if (!isValid) {
        console.log('[CacheValidation] 投资组合列表缓存不一致，刷新缓存');
        cacheService.set(this.PORTFOLIOS_CACHE_KEY, filePortfolios);
      } else {
        console.log('[CacheValidation] 投资组合列表缓存验证通过');
      }
    } catch (error) {
      console.error('[CacheValidation] 验证投资组合列表缓存时发生错误:', error);
      // 发生错误时清除缓存
      cacheService.delete(this.PORTFOLIOS_CACHE_KEY);
    }
  }

  /**
   * 验证单个投资组合缓存
   */
  private async validateIndividualPortfolioCaches(): Promise<void> {
    console.log('[CacheValidation] 验证单个投资组合缓存...');
    
    try {
      // 从文件获取所有投资组合
      const filePortfolios = dataService.readJsonFile<Portfolio[]>(this.PORTFOLIOS_FILE, []);
      
      // 验证每个投资组合的缓存
      for (const portfolio of filePortfolios) {
        const cacheKey = `${this.PORTFOLIO_CACHE_PREFIX}${portfolio.id}`;
        const cachedPortfolio = cacheService.get<Portfolio>(cacheKey);
        
        if (!cachedPortfolio) {
          console.log(`[CacheValidation] 投资组合 ${portfolio.id} 缓存不存在，跳过验证`);
          continue;
        }

        // 比较单个投资组合数据
        const isValid = this.comparePortfolioData(cachedPortfolio, portfolio);
        
        if (!isValid) {
          console.log(`[CacheValidation] 投资组合 ${portfolio.id} 缓存不一致，刷新缓存`);
          cacheService.set(cacheKey, portfolio);
        } else {
          console.log(`[CacheValidation] 投资组合 ${portfolio.id} 缓存验证通过`);
        }
      }
    } catch (error) {
      console.error('[CacheValidation] 验证单个投资组合缓存时发生错误:', error);
    }
  }

  /**
   * 比较投资组合列表数据
   */
  private comparePortfoliosData(cached: Portfolio[], file: Portfolio[]): boolean {
    if (cached.length !== file.length) {
      return false;
    }

    // 创建ID到投资组合的映射，用于快速查找
    const cachedMap = new Map(cached.map(p => [p.id, p]));
    const fileMap = new Map(file.map(p => [p.id, p]));

    // 检查每个投资组合是否匹配
    for (const [id, cachedPortfolio] of cachedMap) {
      const filePortfolio = fileMap.get(id);
      if (!filePortfolio || !this.comparePortfolioData(cachedPortfolio, filePortfolio)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 比较单个投资组合数据
   */
  private comparePortfolioData(cached: Portfolio, file: Portfolio): boolean {
    // 基本属性比较
    if (cached.id !== file.id ||
        cached.name !== file.name ||
        cached.cash !== file.cash ||
        cached.initialCash !== file.initialCash) {
      return false;
    }

    // 比较交易记录
    if (cached.transactions.length !== file.transactions.length) {
      return false;
    }

    // 创建交易ID到交易记录的映射
    const cachedTxMap = new Map(cached.transactions.map(tx => [tx.id, tx]));
    const fileTxMap = new Map(file.transactions.map(tx => [tx.id, tx]));

    // 检查每个交易是否匹配
    for (const [id, cachedTx] of cachedTxMap) {
      const fileTx = fileTxMap.get(id);
      if (!fileTx || 
          cachedTx.type !== fileTx.type ||
          cachedTx.date !== fileTx.date ||
          cachedTx.amount !== fileTx.amount ||
          cachedTx.assetCode !== fileTx.assetCode ||
          cachedTx.quantity !== fileTx.quantity ||
          cachedTx.price !== fileTx.price ||
          cachedTx.commission !== fileTx.commission) {
        return false;
      }
    }

    // 比较杠杆信息
    if (cached.leverage && file.leverage) {
      if (cached.leverage.totalAmount !== file.leverage.totalAmount ||
          cached.leverage.usedAmount !== file.leverage.usedAmount ||
          cached.leverage.availableAmount !== file.leverage.availableAmount ||
          cached.leverage.costRate !== file.leverage.costRate) {
        return false;
      }
    } else if (cached.leverage !== file.leverage) {
      return false;
    }

    return true;
  }

  /**
   * 手动触发缓存验证
   */
  public async validateCache(portfolioId?: string): Promise<void> {
    if (portfolioId) {
      // 验证特定投资组合的缓存
      const filePortfolios = dataService.readJsonFile<Portfolio[]>(this.PORTFOLIOS_FILE, []);
      const portfolio = filePortfolios.find(p => p.id === portfolioId);
      
      if (portfolio) {
        const cacheKey = `${this.PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
        const cachedPortfolio = cacheService.get<Portfolio>(cacheKey);
        
        if (cachedPortfolio && !this.comparePortfolioData(cachedPortfolio, portfolio)) {
          console.log(`[CacheValidation] 手动验证：投资组合 ${portfolioId} 缓存不一致，刷新缓存`);
          cacheService.set(cacheKey, portfolio);
        }
      }
    } else {
      // 验证所有缓存
      await this.validateAllCaches();
    }
  }
}

// 导出单例实例
export const cacheValidationService = CacheValidationService.getInstance(); 