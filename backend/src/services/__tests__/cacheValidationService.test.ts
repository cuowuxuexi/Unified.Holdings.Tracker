import { cacheValidationService } from '../cacheValidationService';
import { cacheService } from '../cacheService';
import { dataService } from '../dataService';
import { Portfolio, TransactionType } from '../../types';

// Mock 依赖
jest.mock('../cacheService');
jest.mock('../dataService');

describe('CacheValidationService', () => {
  // 测试数据
  const mockPortfolio: Portfolio = {
    id: 'test-portfolio-1',
    name: 'Test Portfolio',
    cash: 1000,
    initialCash: 1000,
    transactions: [
      {
        id: 'tx-1',
        type: TransactionType.DEPOSIT,
        date: '2024-01-01',
        amount: 1000
      }
    ],
    leverage: {
      totalAmount: 0,
      usedAmount: 0,
      availableAmount: 0,
      costRate: 0
    }
  };

  const mockPortfolios = [mockPortfolio];

  beforeEach(() => {
    // 清除所有 mock 的调用记录
    jest.clearAllMocks();
    
    // 设置默认的 mock 返回值
    (dataService.readJsonFile as jest.Mock).mockReturnValue(mockPortfolios);
  });

  describe('validatePortfoliosCache', () => {
    it('应该在缓存不存在时跳过验证', async () => {
      // 模拟缓存未命中
      (cacheService.get as jest.Mock).mockReturnValue(null);
      
      await cacheValidationService.validateCache();
      
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('应该在缓存数据与文件数据不一致时更新缓存', async () => {
      // 模拟缓存数据与文件数据不一致
      const cachedPortfolios = [{
        ...mockPortfolio,
        cash: 2000 // 不同的现金余额
      }];
      
      (cacheService.get as jest.Mock)
        .mockReturnValueOnce(cachedPortfolios) // 第一次调用返回列表缓存
        .mockReturnValueOnce(cachedPortfolios[0]); // 第二次调用返回单个投资组合缓存
      
      await cacheValidationService.validateCache();
      
      // 验证是否更新了缓存
      expect(cacheService.set).toHaveBeenCalledWith(
        'portfolios:list',
        mockPortfolios,
        expect.any(Number)
      );
    });

    it('应该在缓存数据与文件数据一致时不更新缓存', async () => {
      // 模拟缓存数据与文件数据一致
      (cacheService.get as jest.Mock)
        .mockReturnValueOnce(mockPortfolios)
        .mockReturnValueOnce(mockPortfolio);
      
      await cacheValidationService.validateCache();
      
      // 验证没有更新缓存
      expect(cacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('validateCache with portfolioId', () => {
    it('应该只验证指定的投资组合缓存', async () => {
      // 模拟缓存数据与文件数据不一致
      const cachedPortfolio = {
        ...mockPortfolio,
        cash: 2000
      };
      
      (cacheService.get as jest.Mock).mockReturnValue(cachedPortfolio);
      
      await cacheValidationService.validateCache('test-portfolio-1');
      
      // 验证是否更新了指定投资组合的缓存
      expect(cacheService.set).toHaveBeenCalledWith(
        'portfolio:test-portfolio-1',
        mockPortfolio,
        expect.any(Number)
      );
    });

    it('应该在投资组合不存在时不更新缓存', async () => {
      await cacheValidationService.validateCache('non-existent-portfolio');
      
      expect(cacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('comparePortfolioData', () => {
    it('应该正确比较基本属性', async () => {
      const modifiedPortfolio = {
        ...mockPortfolio,
        cash: 2000
      };
      
      (cacheService.get as jest.Mock).mockReturnValue(modifiedPortfolio);
      
      await cacheValidationService.validateCache('test-portfolio-1');
      
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('应该正确比较交易记录', async () => {
      const modifiedPortfolio = {
        ...mockPortfolio,
        transactions: [
          ...mockPortfolio.transactions,
          {
            id: 'tx-2',
            type: TransactionType.WITHDRAW,
            date: '2024-01-02',
            amount: 500
          }
        ]
      };
      
      (cacheService.get as jest.Mock).mockReturnValue(modifiedPortfolio);
      
      await cacheValidationService.validateCache('test-portfolio-1');
      
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('应该正确比较杠杆信息', async () => {
      const modifiedPortfolio = {
        ...mockPortfolio,
        leverage: {
          ...mockPortfolio.leverage,
          totalAmount: 10000
        }
      };
      
      (cacheService.get as jest.Mock).mockReturnValue(modifiedPortfolio);
      
      await cacheValidationService.validateCache('test-portfolio-1');
      
      expect(cacheService.set).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('应该在读取文件失败时清除缓存', async () => {
      // 模拟文件读取失败
      (dataService.readJsonFile as jest.Mock).mockImplementation(() => {
        throw new Error('File read error');
      });
      
      await cacheValidationService.validateCache();
      
      expect(cacheService.delete).toHaveBeenCalledWith('portfolios:list');
    });

    it('应该在验证过程中发生错误时继续运行', async () => {
      // 模拟某个验证步骤失败
      (cacheService.get as jest.Mock).mockImplementation(() => {
        throw new Error('Cache error');
      });
      
      // 验证不会抛出错误
      await expect(cacheValidationService.validateCache()).resolves.not.toThrow();
    });
  });
}); 