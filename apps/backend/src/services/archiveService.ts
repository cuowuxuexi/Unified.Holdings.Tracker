/**
 * 存档服务
 * 负责存档的创建、查询和删除等业务逻辑
 * @module services/archiveService
 */

import { v4 as uuidv4 } from 'uuid';
import { container } from '../container';
import { portfolioStatsService } from './portfolioStatsService';
import { archiveStorageService } from './archiveStorageService';
import { Transaction, TransactionType, Market } from '../types';
import {
  PortfolioArchive,
  ArchiveMetadata,
  ArchivedTransaction,
  ArchivedPosition,
  ArchivedStats,
  CreateArchiveOptions,
  ArchiveResult,
  ArchiveFilter,
  ArchiveError,
  ArchiveErrorCode,
  ARCHIVE_VERSION,
} from '../types/archive';

/**
 * 存档服务类
 */
export class ArchiveService {
  /**
   * 创建投资组合年度存档
   * @param portfolioId 投资组合 ID
   * @param year 存档年份
   * @param options 存档选项
   * @returns 存档创建结果
   */
  async createArchive(
    portfolioId: string,
    year: number,
    options: CreateArchiveOptions = {}
  ): Promise<ArchiveResult> {
    const { includePositionSnapshot = true, includeStats = true } = options;

    // 验证年份
    const currentYear = new Date().getFullYear();
    if (year < 1990 || year > currentYear) {
      return {
        success: false,
        archiveId: '',
        filename: '',
        filePath: '',
        metadata: {} as ArchiveMetadata,
        error: `Invalid year: ${year}. Year must be between 1990 and ${currentYear}`,
      };
    }

    // 检查是否已存在
    if (archiveStorageService.archiveExists(portfolioId, year)) {
      return {
        success: false,
        archiveId: '',
        filename: '',
        filePath: '',
        metadata: {} as ArchiveMetadata,
        error: `Archive already exists for portfolio ${portfolioId} year ${year}`,
      };
    }

    // 获取投资组合
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return {
        success: false,
        archiveId: '',
        filename: '',
        filePath: '',
        metadata: {} as ArchiveMetadata,
        error: 'Portfolio not found',
      };
    }

    // 筛选指定年份的交易记录
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    const yearTransactions = (portfolio.transactions || []).filter((tx) => {
      const txDate = new Date(tx.date);
      return txDate >= yearStart && txDate <= yearEnd;
    });

    // 计算持仓快照和统计信息
    let positions: ArchivedPosition[] = [];
    let stats: ArchivedStats | undefined;

    if (includePositionSnapshot || includeStats) {
      try {
        const fullStats = await portfolioStatsService.getFullStats(portfolio, {
          includePeriods: ['yearly'],
          includeQuotes: true,
        });

        if (includePositionSnapshot) {
          positions = this.buildPositions(fullStats.positions);
        }

        if (includeStats) {
          stats = this.buildStats(fullStats, yearTransactions, year);
        }
      } catch (error) {
        console.error(
          '[ArchiveService] Error calculating stats:',
          error
        );
        // 继续创建存档，但不包含统计信息
        if (includeStats) {
          stats = this.buildEmptyStats(year);
        }
      }
    }

    // 构建存档数据
    const archiveId = uuidv4();
    const now = new Date().toISOString();

    const metadata: ArchiveMetadata = {
      id: archiveId,
      portfolioId,
      portfolioName: portfolio.name,
      year,
      createdAt: now,
      version: ARCHIVE_VERSION,
      transactionCount: yearTransactions.length,
      positionCount: positions.length,
      dateRange: this.calculateDateRange(yearTransactions, year),
    };

    const archive: PortfolioArchive = {
      metadata,
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        initialCash: Number(portfolio.initialCash),
        cash: Number(portfolio.cash),
        leverage: {
          totalAmount: Number(portfolio.leverage?.totalAmount ?? 0),
          usedAmount: Number(portfolio.leverage?.usedAmount ?? 0),
          availableAmount: Number(portfolio.leverage?.availableAmount ?? 0),
          costRate: Number(portfolio.leverage?.costRate ?? 0),
        },
        attentionInfo: portfolio.attentionInfo,
      },
      transactions: this.buildTransactions(yearTransactions),
      positions,
      stats: stats || this.buildEmptyStats(year),
    };

    // 保存存档
    try {
      archiveStorageService.ensureArchiveDir(portfolioId, year);
      const filePath = archiveStorageService.saveArchive(archive);
      const filename = archiveStorageService.generateFilename(
        portfolioId,
        year,
        archiveId
      );

      console.log(
        `[ArchiveService] Archive created: ${archiveId} for portfolio ${portfolioId} year ${year}`
      );

      return {
        success: true,
        archiveId,
        filename,
        filePath,
        metadata,
      };
    } catch (error) {
      console.error('[ArchiveService] Error saving archive:', error);
      return {
        success: false,
        archiveId,
        filename: '',
        filePath: '',
        metadata,
        error:
          error instanceof Error ? error.message : 'Failed to save archive',
      };
    }
  }

  /**
   * 获取投资组合的存档列表
   * @param portfolioId 投资组合 ID
   * @param filter 筛选条件
   * @returns 存档元数据列表
   */
  async getArchives(
    portfolioId: string,
    filter?: ArchiveFilter
  ): Promise<ArchiveMetadata[]> {
    return archiveStorageService.listArchives(portfolioId, {
      year: filter?.year,
    });
  }

  /**
   * 获取单个存档
   * @param archiveId 存档 ID
   * @returns 存档数据
   */
  async getArchive(archiveId: string): Promise<PortfolioArchive | null> {
    return archiveStorageService.loadArchive(archiveId);
  }

  /**
   * 获取存档文件路径
   * @param archiveId 存档 ID
   * @returns 文件路径
   */
  async getArchiveFilePath(archiveId: string): Promise<string | null> {
    return archiveStorageService.getArchiveFilePath(archiveId);
  }

  /**
   * 删除存档
   * @param archiveId 存档 ID
   * @returns 是否成功
   */
  async deleteArchive(archiveId: string): Promise<boolean> {
    return archiveStorageService.deleteArchive(archiveId);
  }

  /**
   * 检查存档是否存在
   * @param portfolioId 投资组合 ID
   * @param year 年份
   * @returns 是否存在
   */
  async archiveExists(portfolioId: string, year: number): Promise<boolean> {
    return archiveStorageService.archiveExists(portfolioId, year);
  }

  /**
   * 构建归档的交易记录
   */
  private buildTransactions(transactions: Transaction[]): ArchivedTransaction[] {
    return transactions.map((tx) => ({
      id: tx.id,
      date: tx.date,
      type: tx.type,
      assetCode: tx.assetCode,
      quantity: tx.quantity ? Number(tx.quantity) : undefined,
      price: tx.price ? Number(tx.price) : undefined,
      amount: tx.amount ? Number(tx.amount) : undefined,
      commission: tx.commission ? Number(tx.commission) : undefined,
      leverageUsed: tx.leverageUsed ? Number(tx.leverageUsed) : undefined,
      currency: tx.currency ?? 'CNY',
      exchangeRate: tx.exchangeRate ? Number(tx.exchangeRate) : undefined,
      notes: tx.notes,
    }));
  }

  /**
   * 构建归档的持仓信息
   */
  private buildPositions(
    positions: Array<{
      asset: { code: string; name: string; market: Market };
      quantity: number;
      costPrice: number;
      costPriceLocal?: number;
      totalCost: number;
      totalCostLocal?: number;
      dilutedPrice?: number;
      dilutedPriceLocal?: number;
      totalDividend?: number;
      totalDividendLocal?: number;
      currency?: string;
      currentPrice?: number;
      marketValue?: number;
    }>
  ): ArchivedPosition[] {
    const snapshotDate = new Date().toISOString().split('T')[0];

    return positions.map((pos) => ({
      assetCode: pos.asset.code,
      assetName: pos.asset.name,
      market: pos.asset.market,
      quantity: pos.quantity,
      costPrice: pos.costPrice,
      costPriceLocal: pos.costPriceLocal ?? pos.costPrice,
      totalCost: pos.totalCost,
      totalCostLocal: pos.totalCostLocal ?? pos.totalCost,
      dilutedPrice: pos.dilutedPrice ?? pos.costPrice,
      dilutedPriceLocal: pos.dilutedPriceLocal ?? pos.costPrice,
      totalDividend: pos.totalDividend ?? 0,
      totalDividendLocal: pos.totalDividendLocal ?? 0,
      currency: pos.currency ?? 'CNY',
      snapshotPrice: pos.currentPrice,
      snapshotMarketValue: pos.marketValue,
      snapshotDate,
    }));
  }

  /**
   * 构建归档的统计信息
   */
  private buildStats(
    fullStats: {
      totalMarketValue: number;
      totalAssets: number;
      netAssets: number;
      cash: number;
      leverage?: { usedAmount?: number; availableAmount?: number };
      totalPnl: number;
      realizedPnl: number;
      unrealizedPnl: number;
      yearlyStats?: { periodReturnPercent?: number | null };
    },
    yearTransactions: Transaction[],
    year: number
  ): ArchivedStats {
    // 计算年度统计
    const yearlyDeposit = yearTransactions
      .filter((tx) => tx.type === TransactionType.DEPOSIT)
      .reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0);

    const yearlyWithdraw = yearTransactions
      .filter((tx) => tx.type === TransactionType.WITHDRAW)
      .reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0);

    const yearlyDividend = yearTransactions
      .filter((tx) => tx.type === TransactionType.DIVIDEND)
      .reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0);

    const yearlyCommission = yearTransactions.reduce(
      (sum, tx) => sum + Number(tx.commission ?? 0),
      0
    );

    const yearlyLeverageCost = yearTransactions
      .filter((tx) => tx.type === TransactionType.LEVERAGE_COST)
      .reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0);

    return {
      snapshotDate: new Date().toISOString().split('T')[0],
      totalMarketValue: fullStats.totalMarketValue,
      totalAssets: fullStats.totalAssets,
      netAssets: fullStats.netAssets,
      cash: fullStats.cash,
      leverageUsed: fullStats.leverage?.usedAmount ?? 0,
      leverageAvailable: fullStats.leverage?.availableAmount ?? 0,
      totalPnl: fullStats.totalPnl,
      realizedPnl: fullStats.realizedPnl,
      unrealizedPnl: fullStats.unrealizedPnl,
      yearlyDeposit,
      yearlyWithdraw,
      yearlyDividend,
      yearlyCommission,
      yearlyLeverageCost,
      yearlyReturnPercent: fullStats.yearlyStats?.periodReturnPercent ?? undefined,
    };
  }

  /**
   * 构建空的统计信息
   */
  private buildEmptyStats(year: number): ArchivedStats {
    return {
      snapshotDate: new Date().toISOString().split('T')[0],
      totalMarketValue: 0,
      totalAssets: 0,
      netAssets: 0,
      cash: 0,
      leverageUsed: 0,
      leverageAvailable: 0,
      totalPnl: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      yearlyDeposit: 0,
      yearlyWithdraw: 0,
      yearlyDividend: 0,
      yearlyCommission: 0,
      yearlyLeverageCost: 0,
    };
  }

  /**
   * 计算交易记录的日期范围
   */
  private calculateDateRange(
    transactions: Transaction[],
    year: number
  ): { start: string; end: string } {
    if (transactions.length === 0) {
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      };
    }

    const dates = transactions.map((tx) => new Date(tx.date).getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    return {
      start: minDate.toISOString().split('T')[0],
      end: maxDate.toISOString().split('T')[0],
    };
  }
}

// 导出单例
export const archiveService = new ArchiveService();