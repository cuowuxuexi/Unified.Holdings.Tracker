/**
 * 投资组合存档功能类型定义
 * @module types/archive
 *
 * 此模块定义了两套类型：
 * 1. 原有的年度存档类型（保留以兼容旧代码）
 * 2. 新的备份/恢复类型（用于完整数据库备份）
 */

import { TransactionType, Market } from './index';

// 备份类型使用字符串以避免与 Prisma 枚举类型冲突
type BackupMarket = 'CN' | 'HK' | 'US';
type BackupTransactionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW' | 'LEVERAGE_ADD' | 'LEVERAGE_REMOVE' | 'LEVERAGE_COST' | 'DIVIDEND';

// ============================================
// 备份/恢复功能类型定义（新）
// ============================================

/**
 * 备份元数据
 */
export interface BackupMetadata {
  /** 备份唯一ID */
  backupId: string;
  /** 投资组合ID */
  portfolioId: string;
  /** 投资组合名称 */
  portfolioName: string;
  /** 备份创建时间 (ISO 8601) */
  createdAt: string;
  /** 备份格式版本号 */
  version: string;
  /** 交易记录数量 */
  transactionCount: number;
  /** 资产数量 */
  assetCount: number;
}

/**
 * 备份中的投资组合数据
 */
export interface BackupPortfolioData {
  id: string;
  name: string;
  initialCash: number;
  cash: number;
  leverageTotalAmount: number;
  leverageUsedAmount: number;
  leverageAvailableAmount: number;
  leverageCostRate: number;
  attentionInfo?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 备份中的资产数据
 */
export interface BackupAssetData {
  code: string;
  name: string;
  market: BackupMarket;
  createdAt: string;
  updatedAt: string;
}

/**
 * 备份中的交易记录数据
 */
export interface BackupTransactionData {
  id: string;
  portfolioId: string;
  type: BackupTransactionType;
  date: string;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency: string;
  exchangeRate?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 完整备份数据结构
 */
export interface PortfolioBackup {
  metadata: BackupMetadata;
  portfolio: BackupPortfolioData;
  assets: BackupAssetData[];
  transactions: BackupTransactionData[];
}

/**
 * 备份索引条目
 */
export interface BackupIndexEntry {
  backupId: string;
  portfolioId: string;
  portfolioName: string;
  filename: string;
  /** 相对于 backups/ 的路径 */
  relativePath: string;
  createdAt: string;
  /** 文件大小（字节） */
  fileSize: number;
  transactionCount: number;
  assetCount: number;
}

/**
 * 备份索引
 */
export interface BackupIndex {
  /** 索引版本 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 备份映射 */
  backups: {
    [backupId: string]: BackupIndexEntry;
  };
}

/**
 * 备份创建结果
 */
export interface BackupResult {
  success: boolean;
  backupId: string;
  filename: string;
  filePath: string;
  metadata: BackupMetadata;
  error?: string;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  success: boolean;
  message: string;
  restoredTransactionCount?: number;
  restoredAssetCount?: number;
  error?: string;
}

/**
 * 备份错误代码
 */
export enum BackupErrorCode {
  PORTFOLIO_NOT_FOUND = 'PORTFOLIO_NOT_FOUND',
  BACKUP_NOT_FOUND = 'BACKUP_NOT_FOUND',
  WRITE_FAILED = 'WRITE_FAILED',
  READ_FAILED = 'READ_FAILED',
  RESTORE_FAILED = 'RESTORE_FAILED',
  INVALID_BACKUP_DATA = 'INVALID_BACKUP_DATA',
}

/**
 * 备份错误
 */
export class BackupError extends Error {
  constructor(
    public code: BackupErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * 备份格式版本
 */
export const BACKUP_VERSION = '1.0.0';

// ============================================
// 原有的年度存档类型定义（保留兼容）
// ============================================

/**
 * 存档元数据
 */
export interface ArchiveMetadata {
  /** 存档唯一标识 (UUID) */
  id: string;
  /** 投资组合 ID */
  portfolioId: string;
  /** 投资组合名称 */
  portfolioName: string;
  /** 存档年份 */
  year: number;
  /** 创建时间 (ISO 8601) */
  createdAt: string;
  /** 存档格式版本号 */
  version: string;
  /** 交易记录数量 */
  transactionCount: number;
  /** 持仓数量 */
  positionCount: number;
  /** 数据日期范围 */
  dateRange: {
    /** 数据起始日期 (YYYY-MM-DD) */
    start: string;
    /** 数据结束日期 (YYYY-MM-DD) */
    end: string;
  };
}

/**
 * 归档的交易记录
 */
export interface ArchivedTransaction {
  id: string;
  /** ISO 8601 格式日期 */
  date: string;
  type: TransactionType;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency: string;
  exchangeRate?: number;
  notes?: string;
}

/**
 * 归档的持仓信息
 */
export interface ArchivedPosition {
  assetCode: string;
  assetName: string;
  market: Market;
  quantity: number;
  /** 成本价 (CNY) */
  costPrice: number;
  /** 成本价 (原币种) */
  costPriceLocal: number;
  /** 总成本 (CNY) */
  totalCost: number;
  /** 总成本 (原币种) */
  totalCostLocal: number;
  /** 摊薄价 (CNY) */
  dilutedPrice: number;
  /** 摊薄价 (原币种) */
  dilutedPriceLocal: number;
  /** 累计股息 (CNY) */
  totalDividend: number;
  /** 累计股息 (原币种) */
  totalDividendLocal: number;
  currency: string;
  /** 快照时价格 */
  snapshotPrice?: number;
  /** 快照时市值 */
  snapshotMarketValue?: number;
  /** 快照日期 */
  snapshotDate?: string;
}

/**
 * 归档的统计数据
 */
export interface ArchivedStats {
  /** 统计快照日期 */
  snapshotDate: string;
  /** 总市值 */
  totalMarketValue: number;
  /** 总资产 */
  totalAssets: number;
  /** 净资产 */
  netAssets: number;
  /** 现金余额 */
  cash: number;
  /** 已用杠杆 */
  leverageUsed: number;
  /** 可用杠杆 */
  leverageAvailable: number;
  /** 总盈亏 */
  totalPnl: number;
  /** 已实现盈亏 */
  realizedPnl: number;
  /** 未实现盈亏 */
  unrealizedPnl: number;
  /** 年度入金 */
  yearlyDeposit: number;
  /** 年度出金 */
  yearlyWithdraw: number;
  /** 年度股息 */
  yearlyDividend: number;
  /** 年度手续费 */
  yearlyCommission: number;
  /** 年度融资成本 */
  yearlyLeverageCost: number;
  /** 年度收益率 */
  yearlyReturnPercent?: number;
}

/**
 * 完整存档数据结构
 */
export interface PortfolioArchive {
  metadata: ArchiveMetadata;
  portfolio: {
    id: string;
    name: string;
    initialCash: number;
    cash: number;
    leverage: {
      totalAmount: number;
      usedAmount: number;
      availableAmount: number;
      costRate: number;
    };
    attentionInfo?: string;
  };
  transactions: ArchivedTransaction[];
  positions: ArchivedPosition[];
  stats: ArchivedStats;
}

/**
 * 存档索引条目
 */
export interface ArchiveIndexEntry {
  portfolioId: string;
  year: number;
  filename: string;
  /** 相对于 archives/ 的路径 */
  relativePath: string;
  createdAt: string;
  /** 文件大小（字节） */
  fileSize: number;
}

/**
 * 存档索引
 */
export interface ArchiveIndex {
  /** 索引版本 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 存档映射 */
  archives: {
    [archiveId: string]: ArchiveIndexEntry;
  };
}

/**
 * 创建存档选项
 */
export interface CreateArchiveOptions {
  /** 是否包含持仓快照，默认 true */
  includePositionSnapshot?: boolean;
  /** 是否包含统计信息，默认 true */
  includeStats?: boolean;
  /** 自定义元数据 */
  customMetadata?: Record<string, unknown>;
}

/**
 * 存档创建结果
 */
export interface ArchiveResult {
  success: boolean;
  archiveId: string;
  filename: string;
  filePath: string;
  metadata: ArchiveMetadata;
  error?: string;
}

/**
 * 存档筛选条件
 */
export interface ArchiveFilter {
  year?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * 存档错误代码
 */
export enum ArchiveErrorCode {
  PORTFOLIO_NOT_FOUND = 'PORTFOLIO_NOT_FOUND',
  ARCHIVE_NOT_FOUND = 'ARCHIVE_NOT_FOUND',
  ARCHIVE_ALREADY_EXISTS = 'ARCHIVE_ALREADY_EXISTS',
  INVALID_YEAR = 'INVALID_YEAR',
  WRITE_FAILED = 'WRITE_FAILED',
  READ_FAILED = 'READ_FAILED',
}

/**
 * 存档错误
 */
export class ArchiveError extends Error {
  constructor(
    public code: ArchiveErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/**
 * 存档格式版本
 */
export const ARCHIVE_VERSION = '1.0.0';