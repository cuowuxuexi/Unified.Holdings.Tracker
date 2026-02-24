/**
 * 备份服务
 * 负责投资组合数据的完整备份与恢复
 * @module services/backupService
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { dataService } from './dataService';
import { prisma, cacheService } from '@uht/infra';
import { Market, TransactionType } from '@prisma/client';
import { portfolioStatsService } from './portfolioStatsService';
import {
  PortfolioBackup,
  BackupMetadata,
  BackupPortfolioData,
  BackupAssetData,
  BackupTransactionData,
  BackupIndex,
  BackupIndexEntry,
  BackupResult,
  RestoreResult,
  BackupError,
  BackupErrorCode,
  BACKUP_VERSION,
} from '../types/archive';

const INDEX_VERSION = '1.0.0';
const BACKUPS_DIR = 'backups';
const INDEX_FILE = 'backups/index.json';
const PORTFOLIOS_CACHE_KEY = 'portfolios:list';
const PORTFOLIO_CACHE_PREFIX = 'portfolio:';

/**
 * 备份服务类
 */
export class BackupService {
  private invalidatePortfolioCaches(portfolioId: string): void {
    cacheService.delete(`${PORTFOLIO_CACHE_PREFIX}${portfolioId}`);
    cacheService.delete(PORTFOLIOS_CACHE_KEY);
    portfolioStatsService.clearCache(portfolioId);
  }

  /**
   * 生成备份文件名
   * @param portfolioId 投资组合 ID
   * @param backupId 备份 ID
   * @returns 文件名
   */
  private generateFilename(backupId: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `backup-${date}-${backupId.slice(0, 8)}.json`;
  }

  /**
   * 获取备份的相对路径
   * @param portfolioId 投资组合 ID
   * @param filename 文件名
   * @returns 相对于 data/ 目录的路径
   */
  private getBackupPath(portfolioId: string, filename: string): string {
    return `${BACKUPS_DIR}/${portfolioId}/${filename}`;
  }

  /**
   * 确保备份目录存在
   * @param portfolioId 投资组合 ID
   */
  private ensureBackupDir(portfolioId: string): void {
    const dirPath = path.join(
      dataService.getDataDirPath(),
      BACKUPS_DIR,
      portfolioId
    );

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[BackupService] Created directory: ${dirPath}`);
    }
  }

  /**
   * 获取备份索引
   * @returns 备份索引
   */
  private getIndex(): BackupIndex {
    const defaultIndex: BackupIndex = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      backups: {},
    };
    return dataService.readJsonFile<BackupIndex>(INDEX_FILE, defaultIndex);
  }

  /**
   * 保存备份索引
   * @param index 备份索引
   * @returns 是否成功
   */
  private saveIndex(index: BackupIndex): boolean {
    index.lastUpdated = new Date().toISOString();
    return dataService.writeJsonFile(INDEX_FILE, index);
  }

  /**
   * 更新索引中的备份条目
   * @param backupId 备份 ID
   * @param entry 备份条目
   */
  private updateIndex(backupId: string, entry: BackupIndexEntry): void {
    const index = this.getIndex();
    index.backups[backupId] = entry;
    const success = this.saveIndex(index);
    if (!success) {
      console.error(
        `[BackupService] Failed to update index for backup ${backupId}`
      );
    }
  }

  /**
   * 从索引中移除备份条目
   * @param backupId 备份 ID
   */
  private removeFromIndex(backupId: string): void {
    const index = this.getIndex();
    if (index.backups[backupId]) {
      delete index.backups[backupId];
      this.saveIndex(index);
    }
  }

  /**
   * 创建投资组合备份
   * @param portfolioId 投资组合 ID
   * @returns 备份创建结果
   */
  async createBackup(portfolioId: string): Promise<BackupResult> {
    console.log(`[BackupService] Creating backup for portfolio ${portfolioId}`);

    try {
      // 获取投资组合
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        include: {
          transactions: {
            include: {
              asset: true,
            },
            orderBy: { date: 'asc' },
          },
        },
      });

      if (!portfolio) {
        return {
          success: false,
          backupId: '',
          filename: '',
          filePath: '',
          metadata: {} as BackupMetadata,
          error: 'Portfolio not found',
        };
      }

      // 收集所有涉及的资产代码
      const assetCodes = new Set<string>();
      portfolio.transactions.forEach((tx) => {
        if (tx.assetCode) {
          assetCodes.add(tx.assetCode);
        }
      });

      // 获取资产信息
      const assets = await prisma.asset.findMany({
        where: {
          code: { in: Array.from(assetCodes) },
        },
      });

      // 构建备份数据
      const backupId = uuidv4();
      const now = new Date().toISOString();

      const metadata: BackupMetadata = {
        backupId,
        portfolioId,
        portfolioName: portfolio.name,
        createdAt: now,
        version: BACKUP_VERSION,
        transactionCount: portfolio.transactions.length,
        assetCount: assets.length,
      };

      const portfolioData: BackupPortfolioData = {
        id: portfolio.id,
        name: portfolio.name,
        initialCash: Number(portfolio.initialCash),
        cash: Number(portfolio.cash),
        leverageTotalAmount: Number(portfolio.leverageTotalAmount),
        leverageUsedAmount: Number(portfolio.leverageUsedAmount),
        leverageAvailableAmount: Number(portfolio.leverageAvailableAmount),
        leverageCostRate: Number(portfolio.leverageCostRate),
        attentionInfo: portfolio.attentionInfo ?? undefined,
        createdAt: portfolio.createdAt.toISOString(),
        updatedAt: portfolio.updatedAt.toISOString(),
      };

      const assetsData: BackupAssetData[] = assets.map((asset) => ({
        code: asset.code,
        name: asset.name,
        market: asset.market,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      }));

      const transactionsData: BackupTransactionData[] =
        portfolio.transactions.map((tx) => ({
          id: tx.id,
          portfolioId: tx.portfolioId,
          type: tx.type,
          date: tx.date.toISOString(),
          assetCode: tx.assetCode ?? undefined,
          quantity: tx.quantity ? Number(tx.quantity) : undefined,
          price: tx.price ? Number(tx.price) : undefined,
          amount: tx.amount ? Number(tx.amount) : undefined,
          commission: tx.commission ? Number(tx.commission) : undefined,
          leverageUsed: tx.leverageUsed ? Number(tx.leverageUsed) : undefined,
          currency: tx.currency,
          exchangeRate: tx.exchangeRate ? Number(tx.exchangeRate) : undefined,
          notes: tx.notes ?? undefined,
          createdAt: tx.createdAt.toISOString(),
          updatedAt: tx.updatedAt.toISOString(),
        }));

      const backup: PortfolioBackup = {
        metadata,
        portfolio: portfolioData,
        assets: assetsData,
        transactions: transactionsData,
      };

      // 确保目录存在并保存备份文件
      this.ensureBackupDir(portfolioId);
      const filename = this.generateFilename(backupId);
      const relativePath = this.getBackupPath(portfolioId, filename);

      const success = dataService.writeJsonFile(relativePath, backup);
      if (!success) {
        throw new BackupError(
          BackupErrorCode.WRITE_FAILED,
          `Failed to save backup: ${relativePath}`
        );
      }

      // 计算文件大小并更新索引
      const fileSize = JSON.stringify(backup).length;
      this.updateIndex(backupId, {
        backupId,
        portfolioId,
        portfolioName: portfolio.name,
        filename,
        relativePath,
        createdAt: now,
        fileSize,
        transactionCount: portfolio.transactions.length,
        assetCount: assets.length,
      });

      console.log(`[BackupService] Backup created: ${backupId}`);

      return {
        success: true,
        backupId,
        filename,
        filePath: relativePath,
        metadata,
      };
    } catch (error) {
      console.error('[BackupService] Error creating backup:', error);
      return {
        success: false,
        backupId: '',
        filename: '',
        filePath: '',
        metadata: {} as BackupMetadata,
        error:
          error instanceof Error ? error.message : 'Failed to create backup',
      };
    }
  }

  /**
   * 列出投资组合的所有备份
   * @param portfolioId 投资组合 ID
   * @returns 备份列表
   */
  async listBackups(portfolioId: string): Promise<BackupIndexEntry[]> {
    const index = this.getIndex();
    const backups: BackupIndexEntry[] = [];

    for (const entry of Object.values(index.backups)) {
      if (entry.portfolioId === portfolioId) {
        backups.push(entry);
      }
    }

    // 按创建时间降序排序
    backups.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return backups;
  }

  /**
   * 列出所有备份（不限定投资组合）
   * @returns 所有备份列表
   */
  async listAllBackups(): Promise<BackupIndexEntry[]> {
    const index = this.getIndex();
    const backups: BackupIndexEntry[] = Object.values(index.backups);

    // 按创建时间降序排序
    backups.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return backups;
  }

  /**
   * 获取备份详情
   * @param backupId 备份 ID
   * @returns 备份数据
   */
  async getBackup(backupId: string): Promise<PortfolioBackup | null> {
    // 备份是低频操作，优先保证读取一致性而不是缓存命中。
    dataService.clearCache(INDEX_FILE);
    const index = this.getIndex();
    const entry = index.backups[backupId];

    if (!entry) {
      console.log(`[BackupService] Backup not found in index: ${backupId}`);
      return null;
    }

    dataService.clearCache(entry.relativePath);
    const backup = dataService.readJsonFile<PortfolioBackup | null>(
      entry.relativePath,
      null
    );

    if (!backup) {
      console.log(
        `[BackupService] Backup file not found: ${entry.relativePath}`
      );
      return null;
    }

    return backup;
  }

  /**
   * 恢复备份
   * @param portfolioId 投资组合 ID
   * @param backupId 备份 ID
   * @returns 恢复结果
   */
  async restoreBackup(
    portfolioId: string,
    backupId: string
  ): Promise<RestoreResult> {
    console.log(
      `[BackupService] Restoring backup ${backupId} to portfolio ${portfolioId}`
    );

    try {
      // 获取备份数据
      const backup = await this.getBackup(backupId);
      if (!backup) {
        return {
          success: false,
          message: 'Backup not found',
          error: 'Backup not found',
        };
      }

      // 验证备份是否属于该投资组合
      if (backup.metadata.portfolioId !== portfolioId) {
        return {
          success: false,
          message: 'Backup does not belong to this portfolio',
          error: 'Portfolio ID mismatch',
        };
      }

      // 验证投资组合存在
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
      });
      if (!portfolio) {
        return {
          success: false,
          message: 'Portfolio not found',
          error: 'Portfolio not found',
        };
      }

      // 使用事务执行恢复操作
      await prisma.$transaction(async (tx) => {
        // 1. 删除现有的交易记录
        await tx.transaction.deleteMany({
          where: { portfolioId },
        });
        console.log(`[BackupService] Deleted existing transactions`);

        // 2. 更新投资组合设置
        await tx.portfolio.update({
          where: { id: portfolioId },
          data: {
            initialCash: backup.portfolio.initialCash,
            cash: backup.portfolio.cash,
            leverageTotalAmount: backup.portfolio.leverageTotalAmount,
            leverageUsedAmount: backup.portfolio.leverageUsedAmount,
            leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
            leverageCostRate: backup.portfolio.leverageCostRate,
            attentionInfo: backup.portfolio.attentionInfo,
          },
        });
        console.log(`[BackupService] Updated portfolio settings`);

        // 3. 确保资产存在（使用 upsert）
        for (const asset of backup.assets) {
          await tx.asset.upsert({
            where: { code: asset.code },
            update: {
              name: asset.name,
              market: asset.market,
            },
            create: {
              code: asset.code,
              name: asset.name,
              market: asset.market,
            },
          });
        }
        console.log(`[BackupService] Ensured ${backup.assets.length} assets`);

        // 4. 导入交易记录（使用新 ID 避免冲突）
        for (const transaction of backup.transactions) {
          await tx.transaction.create({
            data: {
              id: uuidv4(), // 生成新 ID
              portfolioId,
              type: transaction.type,
              date: new Date(transaction.date),
              assetCode: transaction.assetCode,
              quantity: transaction.quantity,
              price: transaction.price,
              amount: transaction.amount,
              commission: transaction.commission,
              leverageUsed: transaction.leverageUsed,
              currency: transaction.currency,
              exchangeRate: transaction.exchangeRate,
              notes: transaction.notes,
            },
          });
        }
        console.log(
          `[BackupService] Imported ${backup.transactions.length} transactions`
        );
      });
      this.invalidatePortfolioCaches(portfolioId);

      console.log(`[BackupService] Backup restored successfully`);

      return {
        success: true,
        message: 'Backup restored successfully',
        restoredTransactionCount: backup.transactions.length,
        restoredAssetCount: backup.assets.length,
      };
    } catch (error) {
      console.error('[BackupService] Error restoring backup:', error);
      return {
        success: false,
        message: 'Failed to restore backup',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 智能恢复备份
   * 如果目标组合不存在，自动创建同名组合后恢复
   * @param backupId 备份 ID
   * @returns 恢复结果，包含可能新创建的 portfolioId
   */
  async restoreBackupSmart(
    backupId: string
  ): Promise<
    RestoreResult & { portfolioId?: string; isNewPortfolio?: boolean }
  > {
    console.log(`[BackupService] Smart restoring backup ${backupId}`);

    try {
      // 获取备份数据
      const backup = await this.getBackup(backupId);
      if (!backup) {
        return {
          success: false,
          message: 'Backup not found',
          error: 'Backup not found',
        };
      }

      const originalPortfolioId = backup.metadata.portfolioId;
      let targetPortfolioId = originalPortfolioId;
      let isNewPortfolio = false;

      // 检查原投资组合是否存在
      const existingPortfolio = await prisma.portfolio.findUnique({
        where: { id: originalPortfolioId },
      });

      if (!existingPortfolio) {
        // 创建新投资组合
        console.log(
          `[BackupService] Original portfolio not found, creating new one`
        );
        const newPortfolio = await prisma.portfolio.create({
          data: {
            id: originalPortfolioId, // 使用原始 ID 保持一致性
            name: backup.portfolio.name,
            initialCash: backup.portfolio.initialCash,
            cash: backup.portfolio.cash,
            leverageTotalAmount: backup.portfolio.leverageTotalAmount,
            leverageUsedAmount: backup.portfolio.leverageUsedAmount,
            leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
            leverageCostRate: backup.portfolio.leverageCostRate,
            attentionInfo: backup.portfolio.attentionInfo,
          },
        });
        targetPortfolioId = newPortfolio.id;
        isNewPortfolio = true;
        console.log(
          `[BackupService] Created new portfolio: ${targetPortfolioId}`
        );
      }

      // 使用事务执行恢复操作
      await prisma.$transaction(async (tx) => {
        // 1. 删除现有的交易记录（如果组合已存在）
        if (!isNewPortfolio) {
          await tx.transaction.deleteMany({
            where: { portfolioId: targetPortfolioId },
          });
          console.log(`[BackupService] Deleted existing transactions`);

          // 2. 更新投资组合设置
          await tx.portfolio.update({
            where: { id: targetPortfolioId },
            data: {
              initialCash: backup.portfolio.initialCash,
              cash: backup.portfolio.cash,
              leverageTotalAmount: backup.portfolio.leverageTotalAmount,
              leverageUsedAmount: backup.portfolio.leverageUsedAmount,
              leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
              leverageCostRate: backup.portfolio.leverageCostRate,
              attentionInfo: backup.portfolio.attentionInfo,
            },
          });
          console.log(`[BackupService] Updated portfolio settings`);
        }

        // 3. 确保资产存在（使用 upsert）
        for (const asset of backup.assets) {
          await tx.asset.upsert({
            where: { code: asset.code },
            update: {
              name: asset.name,
              market: asset.market,
            },
            create: {
              code: asset.code,
              name: asset.name,
              market: asset.market,
            },
          });
        }
        console.log(`[BackupService] Ensured ${backup.assets.length} assets`);

        // 4. 导入交易记录（使用新 ID 避免冲突）
        for (const transaction of backup.transactions) {
          await tx.transaction.create({
            data: {
              id: uuidv4(), // 生成新 ID
              portfolioId: targetPortfolioId,
              type: transaction.type,
              date: new Date(transaction.date),
              assetCode: transaction.assetCode,
              quantity: transaction.quantity,
              price: transaction.price,
              amount: transaction.amount,
              commission: transaction.commission,
              leverageUsed: transaction.leverageUsed,
              currency: transaction.currency,
              exchangeRate: transaction.exchangeRate,
              notes: transaction.notes,
            },
          });
        }
        console.log(
          `[BackupService] Imported ${backup.transactions.length} transactions`
        );
      });
      this.invalidatePortfolioCaches(targetPortfolioId);

      console.log(`[BackupService] Backup restored successfully`);

      return {
        success: true,
        message: isNewPortfolio
          ? `Backup restored to new portfolio "${backup.portfolio.name}"`
          : 'Backup restored successfully',
        restoredTransactionCount: backup.transactions.length,
        restoredAssetCount: backup.assets.length,
        portfolioId: targetPortfolioId,
        isNewPortfolio,
      };
    } catch (error) {
      console.error('[BackupService] Error restoring backup:', error);
      return {
        success: false,
        message: 'Failed to restore backup',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 删除备份
   * @param backupId 备份 ID
   * @returns 是否成功
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    const index = this.getIndex();
    const entry = index.backups[backupId];

    if (!entry) {
      return false;
    }

    // 删除文件
    const success = dataService.deleteFile(entry.relativePath);

    if (success) {
      // 从索引中移除
      this.removeFromIndex(backupId);
      console.log(`[BackupService] Backup deleted: ${backupId}`);
    }

    return success;
  }

  /**
   * 获取备份文件路径
   * @param backupId 备份 ID
   * @returns 完整文件路径
   */
  async getBackupFilePath(backupId: string): Promise<string | null> {
    const index = this.getIndex();
    const entry = index.backups[backupId];

    if (!entry) {
      return null;
    }

    return path.join(dataService.getDataDirPath(), entry.relativePath);
  }
}

// 导出单例
export const backupService = new BackupService();
