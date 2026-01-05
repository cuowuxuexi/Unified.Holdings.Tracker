/**
 * 存档/备份路由
 * 提供存档的创建、查询、下载和恢复 API
 * @module routes/archive
 */

import { Router, Request, Response, NextFunction } from 'express';
import { archiveService } from '../services/archiveService';
import { backupService } from '../services/backupService';
import { container } from '../container';

const router = Router();

/**
 * 包装异步路由处理器，捕获错误
 */
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============================================
// 备份/恢复 API（新功能）
// ============================================

/**
 * POST /api/portfolio/:id/backup
 * 创建投资组合备份
 */
router.post(
  '/portfolio/:id/backup',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;

    // 验证投资组合是否存在
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found',
      });
    }

    // 创建备份
    const result = await backupService.createBackup(portfolioId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to create backup',
      });
    }

    res.status(201).json({
      success: true,
      backup: {
        id: result.backupId,
        filename: result.filename,
        path: result.filePath,
        metadata: result.metadata,
      },
      message: 'Backup created successfully',
    });
  })
);

/**
 * GET /api/portfolio/:id/backups
 * 列出投资组合的所有备份
 */
router.get(
  '/portfolio/:id/backups',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;

    // 验证投资组合是否存在
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found',
      });
    }

    // 获取备份列表
    const backups = await backupService.listBackups(portfolioId);

    res.json({
      backups,
      total: backups.length,
    });
  })
);

/**
 * POST /api/portfolio/:id/restore/:backupId
 * 恢复备份
 */
router.post(
  '/portfolio/:id/restore/:backupId',
  asyncHandler(async (req: Request, res: Response) => {
    const { id: portfolioId, backupId } = req.params;

    // 验证投资组合是否存在
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found',
      });
    }

    // 执行恢复
    const result = await backupService.restoreBackup(portfolioId, backupId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to restore backup',
      });
    }

    res.json({
      success: true,
      message: result.message,
      restoredTransactionCount: result.restoredTransactionCount,
      restoredAssetCount: result.restoredAssetCount,
    });
  })
);

/**
 * GET /api/backup/:backupId
 * 获取或下载备份
 */
router.get(
  '/backup/:backupId',
  asyncHandler(async (req: Request, res: Response) => {
    const { backupId } = req.params;
    const { format = 'json' } = req.query as { format?: 'json' | 'download' };

    // 获取备份
    const backup = await backupService.getBackup(backupId);
    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found',
      });
    }

    if (format === 'download') {
      // 返回文件下载
      const date = backup.metadata.createdAt.split('T')[0];
      const filename = `backup-${backup.metadata.portfolioName}-${date}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.send(JSON.stringify(backup, null, 2));
    } else {
      // 返回 JSON 对象
      res.json(backup);
    }
  })
);

/**
 * DELETE /api/backup/:backupId
 * 删除备份
 */
router.delete(
  '/backup/:backupId',
  asyncHandler(async (req: Request, res: Response) => {
    const { backupId } = req.params;

    // 检查备份是否存在
    const backup = await backupService.getBackup(backupId);
    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found',
      });
    }

    // 删除备份
    const success = await backupService.deleteBackup(backupId);
    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete backup',
      });
    }

    res.status(204).send();
  })
);

// ============================================
// 原有的年度存档 API（保留兼容）
// ============================================

/**
 * POST /api/portfolio/:id/archive
 * 创建投资组合年度存档
 */
router.post(
  '/portfolio/:id/archive',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const { year, includePositionSnapshot, includeStats } = req.body as {
      year: number;
      includePositionSnapshot?: boolean;
      includeStats?: boolean;
    };

    // 验证年份参数
    if (!year || typeof year !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: year (number) is required',
      });
    }

    // 验证投资组合是否存在
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found',
      });
    }

    // 创建存档
    const result = await archiveService.createArchive(portfolioId, year, {
      includePositionSnapshot,
      includeStats,
    });

    if (!result.success) {
      // 检查错误类型
      if (result.error?.includes('already exists')) {
        return res.status(409).json({
          success: false,
          message: result.error,
        });
      }
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to create archive',
      });
    }

    res.status(201).json({
      success: true,
      archive: {
        id: result.archiveId,
        filename: result.filename,
        path: result.filePath,
        metadata: result.metadata,
      },
      message: `Archive created successfully for year ${year}`,
    });
  })
);

/**
 * GET /api/portfolio/:id/archives
 * 列出投资组合的所有存档
 */
router.get(
  '/portfolio/:id/archives',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const { year, limit = 50, offset = 0 } = req.query as {
      year?: string;
      limit?: string;
      offset?: string;
    };

    // 验证投资组合是否存在
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found',
      });
    }

    // 获取存档列表
    const filter = year ? { year: parseInt(year, 10) } : undefined;
    const archives = await archiveService.getArchives(portfolioId, filter);

    // 应用分页
    const limitNum = Math.min(parseInt(String(limit), 10) || 50, 100);
    const offsetNum = parseInt(String(offset), 10) || 0;
    const paginatedArchives = archives.slice(offsetNum, offsetNum + limitNum);

    res.json({
      archives: paginatedArchives,
      total: archives.length,
      limit: limitNum,
      offset: offsetNum,
    });
  })
);

/**
 * GET /api/archive/:archiveId
 * 获取或下载存档
 */
router.get(
  '/archive/:archiveId',
  asyncHandler(async (req: Request, res: Response) => {
    const { archiveId } = req.params;
    const { format = 'json' } = req.query as { format?: 'json' | 'download' };

    // 获取存档
    const archive = await archiveService.getArchive(archiveId);
    if (!archive) {
      return res.status(404).json({
        success: false,
        message: 'Archive not found',
      });
    }

    if (format === 'download') {
      // 返回文件下载
      const filename = `portfolio-archive-${archive.metadata.portfolioName}-${archive.metadata.year}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.send(JSON.stringify(archive, null, 2));
    } else {
      // 返回 JSON 对象
      res.json(archive);
    }
  })
);

/**
 * DELETE /api/archive/:archiveId
 * 删除存档
 */
router.delete(
  '/archive/:archiveId',
  asyncHandler(async (req: Request, res: Response) => {
    const { archiveId } = req.params;

    // 检查存档是否存在
    const archive = await archiveService.getArchive(archiveId);
    if (!archive) {
      return res.status(404).json({
        success: false,
        message: 'Archive not found',
      });
    }

    // 删除存档
    const success = await archiveService.deleteArchive(archiveId);
    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete archive',
      });
    }

    res.status(204).send();
  })
);

export default router;