import fs from 'fs';
import path from 'path';
import { cacheService } from './cacheService';

export class DataService {
  private baseDataDir: string;
  private readonly isPkg: boolean;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 默认缓存 5 分钟

  constructor() {
    // 检测是否在pkg环境中运行
    this.isPkg = (process as any).pkg !== undefined;
    
    // 确定基础数据目录
    if (this.isPkg) {
      // 在pkg环境中，使用可执行文件所在目录
      // 在pkg环境中，数据目录基于当前工作目录 (cwd)
      this.baseDataDir = path.join(process.cwd(), 'data');
    } else {
      // 在开发环境中，使用项目目录
      this.baseDataDir = path.join(process.cwd(), 'data');
    }
    
    console.log(`[dataService] 使用数据目录: ${this.baseDataDir}`);
    console.log(`[dataService] 运行环境: ${this.isPkg ? 'pkg打包环境' : '开发环境'}`);
    
    // 确保基础数据目录存在
    this.ensureDirectoryExists(this.baseDataDir);
    
    // 创建子目录
    this.ensureDirectoryExists(path.join(this.baseDataDir, 'portfolios'));
    this.ensureDirectoryExists(path.join(this.baseDataDir, 'transactions'));
    this.ensureDirectoryExists(path.join(this.baseDataDir, 'market'));
    this.ensureDirectoryExists(path.join(this.baseDataDir, 'settings'));
    this.ensureDirectoryExists(path.join(this.baseDataDir, 'logs'));
  }

  // 确保目录存在
  private ensureDirectoryExists(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`[dataService] 创建目录: ${dirPath}`);
      }
    } catch (error) {
      console.error(`[dataService] 无法创建目录 ${dirPath}:`, error);
      throw new Error(`Cannot create data directory: ${dirPath}`);
    }
  }

  /**
   * 生成缓存键
   * @param relativePath 相对路径
   * @returns 缓存键
   */
  private getCacheKey(relativePath: string): string {
    return `data:${relativePath}`;
  }

  /**
   * 读取JSON文件，优先从缓存读取
   * @param relativePath 相对路径
   * @param defaultValue 默认值
   * @returns 解析后的数据
   */
  public readJsonFile<T>(relativePath: string, defaultValue: T): T {
    const cacheKey = this.getCacheKey(relativePath);
    
    // 尝试从缓存读取
    const cachedData = cacheService.get<T>(cacheKey);
    if (cachedData !== null) {
      return cachedData;
    }

    // 缓存未命中，从文件读取
    const fullPath = path.join(this.baseDataDir, relativePath);
    try {
      if (fs.existsSync(fullPath)) {
        const data = fs.readFileSync(fullPath, 'utf8');
        const parsedData = JSON.parse(data) as T;
        
        // 写入缓存
        cacheService.set(cacheKey, parsedData, this.CACHE_TTL);
        
        return parsedData;
      }
      console.log(`[dataService] 文件不存在，使用默认值: ${fullPath}`);
      return defaultValue;
    } catch (error) {
      console.error(`[dataService] 读取文件失败 ${fullPath}:`, error);
      return defaultValue;
    }
  }

  /**
   * 写入JSON文件，同时更新缓存
   * @param relativePath 相对路径
   * @param data 要写入的数据
   * @returns 是否写入成功
   */
  public writeJsonFile<T>(relativePath: string, data: T): boolean {
    const fullPath = path.join(this.baseDataDir, relativePath);
    try {
      // 确保父目录存在
      const dirPath = path.dirname(fullPath);
      this.ensureDirectoryExists(dirPath);
      
      // 写入文件
      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[dataService] 文件写入成功: ${fullPath}`);

      // 更新缓存
      const cacheKey = this.getCacheKey(relativePath);
      cacheService.set(cacheKey, data, this.CACHE_TTL);
      
      return true;
    } catch (error) {
      console.error(`[dataService] 写入文件失败 ${fullPath}:`, error);
      return false;
    }
  }

  /**
   * 删除文件，同时清除缓存
   * @param relativePath 相对路径
   * @returns 是否删除成功
   */
  public deleteFile(relativePath: string): boolean {
    const fullPath = path.join(this.baseDataDir, relativePath);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[dataService] 文件删除成功: ${fullPath}`);
        
        // 清除缓存
        const cacheKey = this.getCacheKey(relativePath);
        cacheService.delete(cacheKey);
      }
      return true;
    } catch (error) {
      console.error(`[dataService] 删除文件失败 ${fullPath}:`, error);
      return false;
    }
  }

  /**
   * 列出目录中的文件
   * @param relativeDirPath 相对目录路径
   * @returns 文件名数组
   */
  public listFiles(relativeDirPath: string): string[] {
    const fullPath = path.join(this.baseDataDir, relativeDirPath);
    try {
      if (fs.existsSync(fullPath)) {
        return fs.readdirSync(fullPath);
      }
      return [];
    } catch (error) {
      console.error(`[dataService] 列出目录文件失败 ${fullPath}:`, error);
      return [];
    }
  }

  /**
   * 获取数据目录路径
   * @returns 数据目录的完整路径
   */
  public getDataDirPath(): string {
    return this.baseDataDir;
  }

  /**
   * 写入日志
   * @param message 日志消息
   */
  public appendToLog(message: string): void {
    const logPath = path.join(this.baseDataDir, 'logs', 'app.log');
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}\n`;
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (error) {
      console.error('[dataService] 写入日志失败:', error);
    }
  }

  /**
   * 清除指定目录的所有缓存
   * @param relativeDirPath 相对目录路径
   */
  public clearDirectoryCache(relativeDirPath: string): void {
    const cachePrefix = this.getCacheKey(relativeDirPath);
    cacheService.deleteByPrefix(cachePrefix);
    console.log(`[dataService] 已清除目录的缓存: ${relativeDirPath}`);
  }
}

// 创建单例实例
export const dataService = new DataService();
