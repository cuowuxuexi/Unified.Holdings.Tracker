/**
 * 依赖注入容器
 * 负责组装应用层 Use Cases 和基础设施层的具体实现
 */

import { PrismaPortfolioRepository } from '@uht/infra';
import {
  ListPortfoliosUseCase,
  GetPortfolioUseCase,
  CreatePortfolioUseCase,
  AddTransactionUseCase,
  RemoveTransactionUseCase,
  RecalculatePortfolioCashUseCase,
  UpdateTransactionNotesUseCase,
  UpdatePortfolioAttentionUseCase,
} from '@uht/application';
import { portfolioStatsService } from './services/portfolioStatsService';

/**
 * 应用容器：包含所有的 Use Cases 和依赖
 */
export class Container {
  // Repository 实例
  private portfolioRepository: PrismaPortfolioRepository;

  // Use Case 实例
  public listPortfoliosUseCase: ListPortfoliosUseCase;
  public getPortfolioUseCase: GetPortfolioUseCase;
  public createPortfolioUseCase: CreatePortfolioUseCase;
  public addTransactionUseCase: AddTransactionUseCase;
  public removeTransactionUseCase: RemoveTransactionUseCase;
  public recalculatePortfolioCashUseCase: RecalculatePortfolioCashUseCase;
  public updateTransactionNotesUseCase: UpdateTransactionNotesUseCase;
  public updatePortfolioAttentionUseCase: UpdatePortfolioAttentionUseCase;
  public portfolioStatsService = portfolioStatsService;

  constructor() {
    // 初始化 Repository
    this.portfolioRepository = new PrismaPortfolioRepository();

    // 初始化 Use Cases，注入依赖
    this.listPortfoliosUseCase = new ListPortfoliosUseCase(
      this.portfolioRepository
    );
    this.getPortfolioUseCase = new GetPortfolioUseCase(
      this.portfolioRepository
    );
    this.createPortfolioUseCase = new CreatePortfolioUseCase(
      this.portfolioRepository
    );
    this.addTransactionUseCase = new AddTransactionUseCase(
      this.portfolioRepository
    );
    this.removeTransactionUseCase = new RemoveTransactionUseCase(
      this.portfolioRepository
    );
    this.recalculatePortfolioCashUseCase = new RecalculatePortfolioCashUseCase(
      this.portfolioRepository
    );
    this.updateTransactionNotesUseCase = new UpdateTransactionNotesUseCase(
      this.portfolioRepository
    );
    this.updatePortfolioAttentionUseCase = new UpdatePortfolioAttentionUseCase(
      this.portfolioRepository
    );
  }

  /**
   * 获取 PortfolioRepository 实例
   */
  getPortfolioRepository(): PrismaPortfolioRepository {
    return this.portfolioRepository;
  }
}

// 创建单例容器实例
export const container = new Container();
