import { Transaction } from './index';

/**
 * 导入行数据接口
 */
export interface ImportRow {
  rowNumber: number;
  date: string;
  type: string;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
}

/**
 * 验证错误接口
 */
export interface ValidationError {
  rowNumber: number;
  field: string;
  message: string;
  value?: any;
}

/**
 * 导入结果接口
 */
export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: ValidationError[];
  importedTransactions?: Transaction[];
}

/**
 * 导入预览接口
 */
export interface ImportPreview {
  rows: ImportRow[];
  validationErrors: ValidationError[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    byType: Record<string, number>;
  };
}
