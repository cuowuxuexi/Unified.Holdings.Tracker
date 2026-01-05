/**
 * 存档存储服务
 * 负责存档文件的读写和索引管理
 * @module services/archiveStorageService
 */

import path from 'path';
import fs from 'fs';
import { dataService } from './dataService';
import {
  PortfolioArchive,
  ArchiveIndex,
  ArchiveIndexEntry,
  ArchiveMetadata,
  ArchiveError,
  ArchiveErrorCode,
} from '../types/archive';

const INDEX_VERSION = '1.0.0';
const ARCHIVES_DIR = 'archives';
const INDEX_FILE = 'archives/index.json';

/**
 * 存档存储服务类
 */
export class ArchiveStorageService {
  /**
   * 生成存档文件名
   * @param portfolioId 投资组合 ID
   * @param year 年份
   * @param archiveId 存档 ID
   * @returns 文件名
   */
  public generateFilename(
    portfolioId: string,
    year: number,
    archiveId: string
  ): string {
    return `portfolio-${portfolioId.slice(0, 8)}-${year}-${archiveId.slice(0, 8)}.json`;
  }

  /**
   * 获取存档的相对路径
   * @param portfolioId 投资组合 ID
   * @param year 年份
   * @param filename 文件名
   * @returns 相对于 data/ 目录的路径
   */
  public getArchivePath(
    portfolioId: string,
    year: number,
    filename: string
  ): string {
    return `${ARCHIVES_DIR}/${portfolioId}/${year}/${filename}`;
  }

  /**
   * 获取存档索引
   * @returns 存档索引
   */
  public getIndex(): ArchiveIndex {
    const defaultIndex: ArchiveIndex = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      archives: {},
    };
    return dataService.readJsonFile<ArchiveIndex>(INDEX_FILE, defaultIndex);
  }

  /**
   * 保存存档索引
   * @param index 存档索引
   * @returns 是否成功
   */
  public saveIndex(index: ArchiveIndex): boolean {
    index.lastUpdated = new Date().toISOString();
    return dataService.writeJsonFile(INDEX_FILE, index);
  }

  /**
   * 更新索引中的存档条目
   * @param archiveId 存档 ID
   * @param entry 存档条目
   */
  public updateIndex(archiveId: string, entry: ArchiveIndexEntry): void {
    const index = this.getIndex();
    index.archives[archiveId] = entry;
    const success = this.saveIndex(index);
    if (!success) {
      console.error(
        `[ArchiveStorageService] Failed to update index for archive ${archiveId}`
      );
    }
  }

  /**
   * 从索引中移除存档条目
   * @param archiveId 存档 ID
   */
  public removeFromIndex(archiveId: string): void {
    const index = this.getIndex();
    if (index.archives[archiveId]) {
      delete index.archives[archiveId];
      this.saveIndex(index);
    }
  }

  /**
   * 保存存档
   * @param archive 存档数据
   * @returns 存档文件的相对路径
   */
  public saveArchive(archive: PortfolioArchive): string {
    const { portfolioId, year, id: archiveId } = archive.metadata;

    // 构建存储路径
    const filename = this.generateFilename(portfolioId, year, archiveId);
    const relativePath = this.getArchivePath(portfolioId, year, filename);

    // 写入存档文件
    const success = dataService.writeJsonFile(relativePath, archive);
    if (!success) {
      throw new ArchiveError(
        ArchiveErrorCode.WRITE_FAILED,
        `Failed to save archive: ${relativePath}`
      );
    }

    // 计算文件大小
    const fileSize = JSON.stringify(archive).length;

    // 更新索引
    this.updateIndex(archiveId, {
      portfolioId,
      year,
      filename,
      relativePath,
      createdAt: archive.metadata.createdAt,
      fileSize,
    });

    console.log(`[ArchiveStorageService] Archive saved: ${relativePath}`);
    return relativePath;
  }

  /**
   * 加载存档
   * @param archiveId 存档 ID
   * @returns 存档数据，如果不存在则返回 null
   */
  public loadArchive(archiveId: string): PortfolioArchive | null {
    const index = this.getIndex();
    const entry = index.archives[archiveId];

    if (!entry) {
      console.log(
        `[ArchiveStorageService] Archive not found in index: ${archiveId}`
      );
      return null;
    }

    const archive = dataService.readJsonFile<PortfolioArchive | null>(
      entry.relativePath,
      null
    );

    if (!archive) {
      console.log(
        `[ArchiveStorageService] Archive file not found: ${entry.relativePath}`
      );
      return null;
    }

    return archive;
  }

  /**
   * 删除存档
   * @param archiveId 存档 ID
   * @returns 是否成功
   */
  public deleteArchive(archiveId: string): boolean {
    const index = this.getIndex();
    const entry = index.archives[archiveId];

    if (!entry) {
      return false;
    }

    // 删除文件
    const success = dataService.deleteFile(entry.relativePath);

    if (success) {
      // 从索引中移除
      this.removeFromIndex(archiveId);
      console.log(`[ArchiveStorageService] Archive deleted: ${archiveId}`);
    }

    return success;
  }

  /**
   * 获取存档文件路径
   * @param archiveId 存档 ID
   * @returns 完整文件路径，如果不存在则返回 null
   */
  public getArchiveFilePath(archiveId: string): string | null {
    const index = this.getIndex();
    const entry = index.archives[archiveId];

    if (!entry) {
      return null;
    }

    return path.join(dataService.getDataDirPath(), entry.relativePath);
  }

  /**
   * 列出投资组合的所有存档
   * @param portfolioId 投资组合 ID
   * @param filter 可选的筛选条件
   * @returns 存档元数据列表
   */
  public listArchives(
    portfolioId: string,
    filter?: { year?: number }
  ): ArchiveMetadata[] {
    const index = this.getIndex();
    const archives: ArchiveMetadata[] = [];

    for (const [archiveId, entry] of Object.entries(index.archives)) {
      if (entry.portfolioId !== portfolioId) {
        continue;
      }

      if (filter?.year && entry.year !== filter.year) {
        continue;
      }

      // 加载存档以获取完整元数据
      const archive = this.loadArchive(archiveId);
      if (archive) {
        archives.push(archive.metadata);
      }
    }

    // 按年份降序排序
    archives.sort((a, b) => b.year - a.year);

    return archives;
  }

  /**
   * 检查指定年份的存档是否已存在
   * @param portfolioId 投资组合 ID
   * @param year 年份
   * @returns 是否存在
   */
  public archiveExists(portfolioId: string, year: number): boolean {
    const index = this.getIndex();

    for (const entry of Object.values(index.archives)) {
      if (entry.portfolioId === portfolioId && entry.year === year) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取存档条目
   * @param archiveId 存档 ID
   * @returns 存档条目，如果不存在则返回 null
   */
  public getArchiveEntry(archiveId: string): ArchiveIndexEntry | null {
    const index = this.getIndex();
    return index.archives[archiveId] || null;
  }

  /**
   * 确保存档目录存在
   * @param portfolioId 投资组合 ID
   * @param year 年份
   */
  public ensureArchiveDir(portfolioId: string, year: number): void {
    const dirPath = path.join(
      dataService.getDataDirPath(),
      ARCHIVES_DIR,
      portfolioId,
      year.toString()
    );

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[ArchiveStorageService] Created directory: ${dirPath}`);
    }
  }
}

// 导出单例
export const archiveStorageService = new ArchiveStorageService();