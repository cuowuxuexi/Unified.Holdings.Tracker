import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { container } from '../container';
import { batchImportService } from '../services/batchImportService';

const router = Router();

// 配置文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // 接受 CSV 和 XLSX 文件
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const allowedExtensions = ['csv', 'xlsx', 'xls'];
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (
      allowedExtensions.includes(ext || '') ||
      allowedMimeTypes.includes(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(new Error('只支持 CSV 或 XLSX 文件格式'));
    }
  },
});

// Helper function to wrap async route handlers
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/**
 * GET /api/batch/template - 下载CSV模板
 * 支持通过查询参数 format=xlsx 来下载 XLSX 格式
 */
router.get('/template', (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'csv';

  // 模板数据
  const templateData = [
    {
      日期: '2025-01-15',
      类型: 'BUY',
      资产代码: 'sh600519',
      数量: 100,
      价格: 1850.5,
      金额: '',
      手续费: 92.5,
      融资额度: 0,
      货币: 'CNY',
      汇率: 1,
      备注: '买入茅台100股',
    },
    {
      日期: '2025-01-16',
      类型: 'DEPOSIT',
      资产代码: '',
      数量: '',
      价格: '',
      金额: 50000,
      手续费: '',
      融资额度: '',
      货币: 'CNY',
      汇率: 1,
      备注: '入金5万元',
    },
    {
      日期: '2025-01-17',
      类型: 'SELL',
      资产代码: 'sh600519',
      数量: 50,
      价格: 1860.0,
      金额: '',
      手续费: 46.5,
      融资额度: 0,
      货币: 'CNY',
      汇率: 1,
      备注: '卖出茅台50股',
    },
    {
      日期: '2025-01-18',
      类型: 'DIVIDEND',
      资产代码: 'sh600519',
      数量: '',
      价格: '',
      金额: 5000,
      手续费: '',
      融资额度: '',
      货币: 'CNY',
      汇率: 1,
      备注: '茅台分红',
    },
    {
      日期: '2025-01-19',
      类型: 'LEVERAGE_ADD',
      资产代码: '',
      数量: '',
      价格: '',
      金额: 100000,
      手续费: '',
      融资额度: '',
      货币: 'CNY',
      汇率: 1,
      备注: '增加融资额度',
    },
    {
      日期: '2025-01-20',
      类型: 'LEVERAGE_COST',
      资产代码: '',
      数量: '',
      价格: '',
      金额: 150,
      手续费: '',
      融资额度: '',
      货币: 'CNY',
      汇率: 1,
      备注: '融资利息支出',
    },
  ];

  if (format.toLowerCase() === 'xlsx') {
    // 生成 XLSX 格式
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '交易导入模板');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="batch_import_template.xlsx"'
    );
    res.send(buffer);
  } else {
    // 生成 CSV 格式
    const template = `日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入茅台100股
2025-01-16,DEPOSIT,,,,,50000,,,CNY,1,入金5万元
2025-01-17,SELL,sh600519,50,1860.00,,46.50,0,CNY,1,卖出茅台50股
2025-01-18,DIVIDEND,sh600519,,,5000,,,CNY,1,茅台分红
2025-01-19,LEVERAGE_ADD,,,,100000,,,CNY,1,增加融资额度
2025-01-20,LEVERAGE_COST,,,,150,,,CNY,1,融资利息支出`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="batch_import_template.csv"'
    );
    // 添加UTF-8 BOM以便Excel正确识别中文
    res.send('\ufeff' + template);
  }
});

/**
 * POST /api/batch/preview - 预览导入
 * 上传CSV文件，返回解析和验证结果，不实际导入
 */
router.post(
  '/preview',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: '未上传文件' });
    }

    console.log(
      `[BatchImport Preview] 收到文件: ${req.file.originalname}, 大小: ${req.file.size} bytes`
    );

    try {
      const preview = await batchImportService.previewImport(
        req.file.buffer,
        req.file.originalname
      );

      console.log(
        `[BatchImport Preview] 预览结果: 总行数 ${preview.summary.totalRows}, 有效 ${preview.summary.validRows}, 无效 ${preview.summary.invalidRows}`
      );

      res.json(preview);
    } catch (error) {
      console.error('[BatchImport Preview] 预览失败:', error);
      const message =
        error instanceof Error ? error.message : 'Unknown preview error';
      res.status(500).json({
        message: `预览失败: ${message}`,
      });
    }
  })
);

/**
 * POST /api/batch/import/:portfolioId - 执行批量导入
 * 上传CSV文件并导入到指定投资组合
 */
router.post(
  '/import/:portfolioId',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const { portfolioId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: '未上传文件' });
    }

    console.log(
      `[BatchImport] 开始导入到投资组合 ${portfolioId}, 文件: ${req.file.originalname}`
    );

    try {
      // 1. 验证投资组合是否存在
      const portfolio = await container.getPortfolioUseCase.execute({
        portfolioId,
      });

      if (!portfolio) {
        return res.status(404).json({ message: '投资组合不存在' });
      }

      // 2. 先预览验证
      const preview = await batchImportService.previewImport(
        req.file.buffer,
        req.file.originalname
      );

      if (preview.summary.invalidRows > 0) {
        console.warn(
          `[BatchImport] 发现 ${preview.summary.invalidRows} 行数据验证失败`
        );
        return res.status(400).json({
          message: `存在 ${preview.summary.invalidRows} 行数据验证失败，请修正后重试`,
          errors: preview.validationErrors,
          summary: preview.summary,
        });
      }

      // 3. 执行导入
      console.log(
        `[BatchImport] 验证通过，开始导入 ${preview.summary.validRows} 行数据`
      );

      const result = await batchImportService.executeImport(
        portfolioId,
        preview.rows,
        container.addTransactionUseCase
      );

      console.log(
        `[BatchImport] 导入完成: 成功 ${result.successCount}, 失败 ${result.errorCount}`
      );

      if (result.errorCount > 0) {
        // 部分成功
        return res.status(207).json({
          message: `部分导入成功: ${result.successCount} 成功, ${result.errorCount} 失败`,
          ...result,
        });
      } else {
        // 全部成功
        res.json({
          message: `成功导入 ${result.successCount} 条交易记录`,
          ...result,
        });
      }
    } catch (error) {
      console.error('[BatchImport] 导入失败:', error);
      const message =
        error instanceof Error ? error.message : 'Unknown import error';
      res.status(500).json({
        message: `导入失败: ${message}`,
      });
    }
  })
);

/**
 * 错误处理中间件
 */
router.use(
  (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(400)
          .json({ message: '文件大小超过限制（最多10MB）' });
      }
      return res
        .status(400)
        .json({ message: `文件上传错误: ${error.message}` });
    }
    next(error);
  }
);

export default router;
