import { batchImportService } from '../batchImportService';

describe('BatchImportService', () => {
  describe('parseCSV', () => {
    it('应该正确解析有效的CSV', async () => {
      const csvContent = `日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入茅台`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const rows = await batchImportService.parseCSV(buffer);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'sh600519',
        quantity: 100,
        price: 1850.5,
        commission: 92.5,
        leverageUsed: 0,
        currency: 'CNY',
        exchangeRate: undefined,
        notes: '买入茅台',
      });
    });

    it('应该正确解析多行数据', async () => {
      const csvContent = `日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入
2025-01-16,DEPOSIT,,,,,50000,,,CNY,1,入金
2025-01-17,SELL,sh600519,50,1860.00,,46.50,0,CNY,1,卖出`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const rows = await batchImportService.parseCSV(buffer);

      expect(rows).toHaveLength(3);
      expect(rows[0].type).toBe('BUY');
      expect(rows[1].type).toBe('DEPOSIT');
      expect(rows[2].type).toBe('SELL');
    });

    it('应该处理带BOM的UTF-8文件', async () => {
      const csvContent = `日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,测试`;

      const buffer = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
        Buffer.from(csvContent, 'utf-8'),
      ]);

      const rows = await batchImportService.parseCSV(buffer);
      expect(rows).toHaveLength(1);
    });
  });

  describe('validateRow', () => {
    it('应该检测出无效的日期格式', () => {
      const row = {
        rowNumber: 2,
        date: 'invalid-date',
        type: 'BUY',
        assetCode: 'sh600519',
        quantity: 100,
        price: 1850,
      };

      const errors = batchImportService.validateRow(row);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('日期');
      expect(errors[0].message).toContain('日期格式无效');
    });

    it('应该检测出无效的交易类型', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'INVALID_TYPE',
        assetCode: 'sh600519',
        quantity: 100,
        price: 1850,
      };

      const errors = batchImportService.validateRow(row);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].field).toBe('类型');
    });

    it('应该检测出BUY交易缺少必填字段', () => {
      const row1 = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        // 缺少assetCode
        quantity: 100,
        price: 1850,
      };

      const errors1 = batchImportService.validateRow(row1);
      expect(errors1.some((e) => e.field === '资产代码')).toBe(true);

      const row2 = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'sh600519',
        // 缺少quantity
        price: 1850,
      };

      const errors2 = batchImportService.validateRow(row2);
      expect(errors2.some((e) => e.field === '数量')).toBe(true);

      const row3 = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'sh600519',
        quantity: 100,
        // 缺少price
      };

      const errors3 = batchImportService.validateRow(row3);
      expect(errors3.some((e) => e.field === '价格')).toBe(true);
    });

    it('应该检测出DEPOSIT交易缺少金额', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'DEPOSIT',
        // 缺少amount
      };

      const errors = batchImportService.validateRow(row);
      expect(errors.some((e) => e.field === '金额')).toBe(true);
    });

    it('应该检测出无效的资产代码格式', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'invalid', // 不符合格式
        quantity: 100,
        price: 1850,
      };

      const errors = batchImportService.validateRow(row);
      expect(errors.some((e) => e.field === '资产代码')).toBe(true);
    });

    it('应该接受有效的资产代码', () => {
      const validCodes = ['sh600519', 'sz000001', 'hk00700', 'usAAPL'];

      validCodes.forEach((code) => {
        const row = {
          rowNumber: 2,
          date: '2025-01-15',
          type: 'BUY',
          assetCode: code,
          quantity: 100,
          price: 1850,
        };

        const errors = batchImportService.validateRow(row);
        expect(errors.filter((e) => e.field === '资产代码')).toHaveLength(0);
      });
    });

    it('应该验证货币类型', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'sh600519',
        quantity: 100,
        price: 1850,
        currency: 'INVALID',
      };

      const errors = batchImportService.validateRow(row);
      expect(errors.some((e) => e.field === '货币')).toBe(true);
    });

    it('应该要求非CNY交易提供汇率', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'hk00700',
        quantity: 100,
        price: 320,
        currency: 'HKD',
      };

      const errors = batchImportService.validateRow(row);
      expect(errors.some((e) => e.field === '汇率')).toBe(true);
    });

    it('应该接受有效的完整BUY交易', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'BUY',
        assetCode: 'sh600519',
        quantity: 100,
        price: 1850.5,
        commission: 92.5,
        leverageUsed: 0,
        currency: 'CNY',
        exchangeRate: 1,
        notes: '买入茅台',
      };

      const errors = batchImportService.validateRow(row);
      expect(errors).toHaveLength(0);
    });

    it('应该接受有效的DEPOSIT交易', () => {
      const row = {
        rowNumber: 2,
        date: '2025-01-15',
        type: 'DEPOSIT',
        amount: 50000,
        currency: 'CNY',
        exchangeRate: 1,
        notes: '入金',
      };

      const errors = batchImportService.validateRow(row);
      expect(errors).toHaveLength(0);
    });
  });

  describe('previewImport', () => {
    it('应该返回正确的预览摘要', async () => {
      const csvContent = `日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入
2025-01-16,DEPOSIT,,,,50000,,,,CNY,1,入金
invalid-date,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,错误日期`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await batchImportService.previewImport(buffer);

      expect(preview.summary.totalRows).toBe(3);
      expect(preview.summary.validRows).toBe(2);
      expect(preview.summary.invalidRows).toBe(1);
      expect(preview.summary.byType.BUY).toBe(2);
      expect(preview.summary.byType.DEPOSIT).toBe(1);
      expect(preview.validationErrors.length).toBeGreaterThan(0);
    });

    it('应该统计不同类型的交易数量', async () => {
      const csvContent = `日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入1
2025-01-16,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入2
2025-01-17,SELL,sh600519,50,1860.00,,46.50,0,CNY,1,卖出
2025-01-18,DEPOSIT,,,,,50000,,,CNY,1,入金
2025-01-19,DIVIDEND,sh600519,,,5000,,,CNY,1,分红`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const preview = await batchImportService.previewImport(buffer);

      expect(preview.summary.byType.BUY).toBe(2);
      expect(preview.summary.byType.SELL).toBe(1);
      expect(preview.summary.byType.DEPOSIT).toBe(1);
      expect(preview.summary.byType.DIVIDEND).toBe(1);
    });
  });
});
