import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { Transaction, TransactionType } from '../types';
import {
  ValidationError,
  ImportRow,
  ImportResult,
  ImportPreview,
} from '../types/batch';
import {
  getExchangeRate,
  getExchangeRateForAssetToCNY,
} from './currencyService';

/**
 * 批量导入服务
 * 负责 CSV 和 XLSX 文件解析、数据验证和批量导入
 */
export class BatchImportService {
  /**
   * 解析 XLSX 文件
   */
  async parseXLSX(fileBuffer: Buffer): Promise<ImportRow[]> {
    try {
      // 读取 Excel 文件
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

      // 获取第一个工作表
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('Excel 文件中没有工作表');
      }

      const worksheet = workbook.Sheets[sheetName];

      // 转换为 JSON 对象数组
      const records = XLSX.utils.sheet_to_json(worksheet, {
        raw: false, // 将日期等格式化为字符串
        defval: '', // 空单元格的默认值
      });

      if (!records || records.length === 0) {
        throw new Error('Excel 文件为空或没有数据');
      }

      // 映射为 ImportRow 格式（复用 CSV 的映射逻辑）
      return records.map((record, index: number) => {
        const row = record as Record<string, unknown>;
        return {
          rowNumber: index + 2, // +2因为第1行是表头
          date: (row['日期'] || row['date']) as string,
          type: ((row['类型'] || row['type']) as string)?.toUpperCase(),
          assetCode: (row['资产代码'] || row['assetCode'] || undefined) as
            | string
            | undefined,
          quantity: this.parseNumber(row['数量'] || row['quantity']),
          price: this.parseNumber(row['价格'] || row['price']),
          amount: this.parseNumber(row['金额'] || row['amount']),
          commission: this.parseNumber(row['手续费'] || row['commission']),
          leverageUsed: this.parseNumber(
            row['融资额度'] || row['leverageUsed']
          ),
          currency: this.normalizeCurrency(
            (row['货币'] || row['currency'] || 'CNY') as string
          ),
          exchangeRate: this.parseNumber(row['汇率'] || row['exchangeRate']),
          notes: (row['备注'] || row['notes'] || undefined) as
            | string
            | undefined,
        };
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`XLSX解析失败: ${message}`);
    }
  }

  /**
   * 统一文件解析入口
   * 根据文件名自动选择 CSV 或 XLSX 解析器
   */
  async parseFile(fileBuffer: Buffer, filename: string): Promise<ImportRow[]> {
    const ext = filename.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      console.log('[BatchImportService] 检测到 XLSX 文件，使用 XLSX 解析器');
      return this.parseXLSX(fileBuffer);
    } else if (ext === 'csv') {
      console.log('[BatchImportService] 检测到 CSV 文件，使用 CSV 解析器');
      return this.parseCSV(fileBuffer);
    } else {
      throw new Error(`不支持的文件格式: ${ext}，请使用 .csv 或 .xlsx 文件`);
    }
  }

  /**
   * 解析CSV文件
   */
  async parseCSV(fileBuffer: Buffer): Promise<ImportRow[]> {
    try {
      const records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true, // 处理UTF-8 BOM
        relaxColumnCount: true, // 允许列数不一致
      });

      return records.map((record, index: number) => {
        const row = record as Record<string, unknown>;
        return {
          rowNumber: index + 2, // +2因为第1行是表头
          date: (row['日期'] || row['date']) as string,
          type: ((row['类型'] || row['type']) as string)?.toUpperCase(),
          assetCode: (row['资产代码'] || row['assetCode'] || undefined) as
            | string
            | undefined,
          quantity: this.parseNumber(row['数量'] || row['quantity']),
          price: this.parseNumber(row['价格'] || row['price']),
          amount: this.parseNumber(row['金额'] || row['amount']),
          commission: this.parseNumber(row['手续费'] || row['commission']),
          leverageUsed: this.parseNumber(
            row['融资额度'] || row['leverageUsed']
          ),
          currency: this.normalizeCurrency(
            (row['货币'] || row['currency'] || 'CNY') as string
          ),
          exchangeRate: this.parseNumber(row['汇率'] || row['exchangeRate']),
          notes: (row['备注'] || row['notes'] || undefined) as
            | string
            | undefined,
        };
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`CSV解析失败: ${message}`);
    }
  }

  /**
   * 验证单行数据
   */
  validateRow(row: ImportRow): ValidationError[] {
    const errors: ValidationError[] = [];
    const currency = row.currency ? row.currency.toUpperCase() : 'CNY';
    row.currency = currency;

    // 1. 日期验证
    if (!row.date || isNaN(Date.parse(row.date))) {
      errors.push({
        rowNumber: row.rowNumber,
        field: '日期',
        message: '日期格式无效，请使用 YYYY-MM-DD 格式',
        value: row.date,
      });
    }

    // 2. 类型验证
    const validTypes = Object.values(TransactionType);
    if (!row.type || !validTypes.includes(row.type as TransactionType)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: '类型',
        message: `交易类型无效，必须是: ${validTypes.join(', ')}`,
        value: row.type,
      });
      return errors; // 类型错误直接返回，避免后续验证出错
    }

    // 3. 根据类型验证必填字段
    if (row.type === 'BUY' || row.type === 'SELL') {
      // 买卖交易验证
      if (!row.assetCode) {
        errors.push({
          rowNumber: row.rowNumber,
          field: '资产代码',
          message: '买卖交易必须填写资产代码',
        });
      } else if (!this.validateAssetCode(row.assetCode)) {
        errors.push({
          rowNumber: row.rowNumber,
          field: '资产代码',
          message: '资产代码格式无效，必须以 sh/sz/hk/us 开头',
          value: row.assetCode,
        });
      }

      if (!row.quantity || row.quantity <= 0) {
        errors.push({
          rowNumber: row.rowNumber,
          field: '数量',
          message: '买卖交易数量必须大于0',
          value: row.quantity,
        });
      }

      if (!row.price || row.price <= 0) {
        errors.push({
          rowNumber: row.rowNumber,
          field: '价格',
          message: '买卖交易价格必须大于0',
          value: row.price,
        });
      }
    } else if (
      [
        'DEPOSIT',
        'WITHDRAW',
        'LEVERAGE_ADD',
        'LEVERAGE_REMOVE',
        'LEVERAGE_COST',
        'DIVIDEND',
      ].includes(row.type)
    ) {
      // 资金/杠杆/分红交易验证
      if (!row.amount || row.amount <= 0) {
        errors.push({
          rowNumber: row.rowNumber,
          field: '金额',
          message: `${row.type} 交易必须填写金额且大于0`,
          value: row.amount,
        });
      }
    }

    // 4. 货币验证
    if (currency && !['CNY', 'USD', 'HKD'].includes(currency)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: '货币',
        message: '货币必须是 CNY, USD 或 HKD',
        value: currency,
      });
    }

    // 5. 汇率解析：优先使用实时汇率，缺失时使用用户提供的汇率
    const resolvedRate = this.resolveExchangeRate(row);
    if (resolvedRate !== null && resolvedRate !== undefined) {
      row.exchangeRate = resolvedRate;
    } else if (currency !== 'CNY') {
      errors.push({
        rowNumber: row.rowNumber,
        field: '货币',
        message: `无法获取 ${currency}->CNY 的汇率，请稍后重试或提供固定汇率`,
        value: currency,
      });
    }

    if (row.exchangeRate !== undefined && row.exchangeRate <= 0) {
      errors.push({
        rowNumber: row.rowNumber,
        field: '汇率',
        message: '汇率必须大于0',
        value: row.exchangeRate,
      });
    }

    return errors;
  }

  /**
   * 预览导入（不实际导入，只验证）
   */
  async previewImport(
    fileBuffer: Buffer,
    filename: string = 'file.csv'
  ): Promise<ImportPreview> {
    const rows = await this.parseFile(fileBuffer, filename);
    const allErrors: ValidationError[] = [];
    const byType: Record<string, number> = {};
    const errorRowNumbers = new Set<number>();

    rows.forEach((row) => {
      const errors = this.validateRow(row);
      if (errors.length > 0) {
        allErrors.push(...errors);
        errorRowNumbers.add(row.rowNumber);
      }

      if (row.type) {
        byType[row.type] = (byType[row.type] || 0) + 1;
      }
    });

    return {
      rows,
      validationErrors: allErrors,
      summary: {
        totalRows: rows.length,
        validRows: rows.length - errorRowNumbers.size,
        invalidRows: errorRowNumbers.size,
        byType,
      },
    };
  }

  /**
   * 执行批量导入（使用现有的AddTransactionUseCase）
   */
  async executeImport(
    portfolioId: string,
    rows: ImportRow[],
    addTransactionUseCase: {
      execute: (params: {
        portfolioId: string;
        transaction: Omit<Transaction, 'id'>;
      }) => Promise<{ transactions: Transaction[] }>;
    }
  ): Promise<ImportResult> {
    const allErrors: ValidationError[] = [];
    const allMessages: ValidationError[] = []; // 用于存储提示信息（不算作错误）
    const importedTransactions: Transaction[] = [];
    let successCount = 0;

    // 【已移除】自动添加融资额度的逻辑
    // 用户反馈：批量导入时不需要自动创建LEVERAGE_ADD记录
    // 如果需要融资额度，用户会手动在CSV中添加对应的LEVERAGE_ADD记录

    // 检查投资组合的融资利率设置（仅做警告提示）
    let totalLeverageNeeded = 0;
    for (const row of rows) {
      if (
        (row.type === 'BUY' || row.type === 'SELL') &&
        row.leverageUsed &&
        Number(row.leverageUsed) > 0
      ) {
        const leverageUsedLocal = Number(row.leverageUsed);
        let leverageUsedCNY = leverageUsedLocal;
        if (row.currency && row.currency !== 'CNY' && row.exchangeRate) {
          leverageUsedCNY = leverageUsedLocal * row.exchangeRate;
        }
        totalLeverageNeeded += leverageUsedCNY;
      }
    }

    // 如果检测到融资交易，显示融资利率信息
    if (totalLeverageNeeded > 0) {
      const { getPortfolioById } = await import(
        '@uht/infra/storage/storage.prisma'
      );
      const portfolio = await getPortfolioById(portfolioId);
      if (portfolio) {
        const currentRate = portfolio.leverage?.costRate ?? 0;
        const ratePercent = (currentRate * 100).toFixed(2);

        if (currentRate === 0) {
          // 利率为0时警告（算作错误）
          console.warn(
            `[BatchImport] ⚠️ 警告：投资组合 "${portfolio.name}" 融资利率为 ${ratePercent}%，融资成本将无法正确计算。`
          );
          allErrors.push({
            rowNumber: 0,
            field: 'leverageCostRate',
            message: `⚠️ 警告：投资组合融资利率为 ${ratePercent}%，导入的融资交易将不产生融资成本！建议先设置正确的融资利率。`,
          });
        } else {
          // 利率正常时提示（不算作错误，仅作为信息提示）
          console.log(
            `[BatchImport] ℹ️ 检测到融资交易（总额: ${totalLeverageNeeded.toFixed(2)} CNY），将使用投资组合默认融资利率: ${ratePercent}% 年利率`
          );
          allMessages.push({
            rowNumber: 0,
            field: 'leverageCostRate',
            message: `ℹ️ 提示：检测到融资交易（总额: ${totalLeverageNeeded.toFixed(2)} 元），将使用投资组合的融资利率 ${ratePercent}% 年利率计算融资成本。您无需在CSV中指定融资利率。`,
          });
        }
      }
    }

    for (const row of rows) {
      // 同步解析一次汇率，确保导入阶段使用的汇率与预览一致
      const resolvedRate = this.resolveExchangeRate(row);
      if (resolvedRate !== null && resolvedRate !== undefined) {
        row.exchangeRate = resolvedRate;
      } else if (row.currency && row.currency !== 'CNY') {
        allErrors.push({
          rowNumber: row.rowNumber,
          field: '汇率',
          message: `无法获取 ${row.currency}->CNY 的汇率，终止导入`,
        });
        continue;
      }

      // 先验证
      const errors = this.validateRow(row);
      if (errors.length > 0) {
        allErrors.push(...errors);
        continue;
      }

      try {
        // 转换为Transaction格式，确保数值字段是number类型而不是string
        const transactionData: Omit<Transaction, 'id'> = {
          date: new Date(row.date).toISOString(),
          type: row.type as TransactionType,
          assetCode: row.assetCode,
          quantity:
            row.quantity !== undefined ? Number(row.quantity) : undefined,
          price: row.price !== undefined ? Number(row.price) : undefined,
          amount: row.amount !== undefined ? Number(row.amount) : undefined,
          commission:
            row.commission !== undefined ? Number(row.commission) : undefined,
          leverageUsed:
            row.leverageUsed !== undefined
              ? Number(row.leverageUsed)
              : undefined,
          currency: row.currency || 'CNY',
          exchangeRate:
            row.exchangeRate !== undefined
              ? Number(row.exchangeRate)
              : undefined,
          notes: row.notes,
        };

        console.log(
          `[BatchImport] 正在导入第 ${row.rowNumber} 行: ${row.type} ${row.assetCode || ''}`
        );

        // DEBUG: 检查融资数据
        if (row.type === 'BUY' || row.type === 'SELL') {
          console.log('[BatchImport DEBUG]', {
            rowNumber: row.rowNumber,
            type: row.type,
            assetCode: row.assetCode,
            'row.leverageUsed': row.leverageUsed,
            'row.leverageUsed type': typeof row.leverageUsed,
            'transactionData.leverageUsed': transactionData.leverageUsed,
            'transactionData.leverageUsed type':
              typeof transactionData.leverageUsed,
            'row.amount': row.amount,
            'transactionData.amount': transactionData.amount,
          });
        }

        // 使用现有的AddTransactionUseCase
        const result = await addTransactionUseCase.execute({
          portfolioId,
          transaction: transactionData,
        });

        const lastTransaction =
          result.transactions[result.transactions.length - 1];
        importedTransactions.push(lastTransaction);
        successCount++;

        console.log(
          `[BatchImport] 第 ${row.rowNumber} 行导入成功，交易ID: ${lastTransaction.id}`
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(`[BatchImport] 第 ${row.rowNumber} 行导入失败:`, message);
        allErrors.push({
          rowNumber: row.rowNumber,
          field: '导入',
          message: error instanceof Error ? error.message : '导入失败',
        });
      }
    }

    return {
      totalRows: rows.length,
      successCount,
      errorCount: allErrors.length, // 只统计真正的错误
      errors: [...allErrors, ...allMessages], // 合并错误和提示信息
      importedTransactions,
    };
  }

  /**
   * 根据交易类型/资产/货币解析汇率
   * - BUY/SELL/DIVIDEND 使用资产代码推导实时汇率
   * - 非CNY现金/杠杆操作使用货币对汇率
   * - 若实时汇率不可用，回退到用户提供的 exchangeRate（>0），否则返回 null
   */
  private resolveExchangeRate(row: ImportRow): number | null | undefined {
    const currency = this.normalizeCurrency(row.currency);

    if (
      (row.type === 'BUY' || row.type === 'SELL' || row.type === 'DIVIDEND') &&
      row.assetCode
    ) {
      const rate = getExchangeRateForAssetToCNY(row.assetCode);
      return rate ?? row.exchangeRate ?? null;
    }

    if (currency === 'CNY') {
      return 1;
    }

    const rateFromCurrency =
      getExchangeRate(`${currency}-CNY`) ?? getExchangeRate(currency, 'CNY');
    if (rateFromCurrency !== null && rateFromCurrency !== undefined) {
      return rateFromCurrency;
    }

    if (row.exchangeRate !== undefined && row.exchangeRate > 0) {
      return row.exchangeRate;
    }

    return null;
  }

  /**
   * 辅助方法：解析数字
   */
  private parseNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return isFinite(num) ? num : undefined;
  }

  private normalizeCurrency(value: string | undefined): string {
    if (!value) return 'CNY';
    const normalized = value.toString().trim().toUpperCase();
    return normalized || 'CNY';
  }

  /**
   * 辅助方法：验证资产代码格式
   */
  private validateAssetCode(code: string): boolean {
    const lowerCode = code.toLowerCase();
    return /^(sh|sz|hk|us)[a-z0-9]+$/i.test(lowerCode);
  }
}

// 导出单例
export const batchImportService = new BatchImportService();
