import path from 'path';
import fs from 'fs';
import { app } from 'electron';

/**
 * 日志级别枚举
 */
enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

/**
 * 路径解析工具类
 * 提供跨环境（开发/打包）和跨平台的文件路径解析
 *
 * 使用单例模式，确保全局唯一实例
 */
export class PathResolver {
  private static instance: PathResolver;
  private logLevel: LogLevel;

  private constructor(
    private readonly isPackaged: boolean,
    private readonly resourcesPath: string,
    private readonly appPath: string
  ) {
    // 生产环境默认只输出错误，开发环境输出所有日志
    this.logLevel = isPackaged ? LogLevel.ERROR : LogLevel.DEBUG;
  }

  /**
   * 获取 PathResolver 单例实例
   */
  static getInstance(): PathResolver {
    if (!this.instance) {
      this.instance = new PathResolver(
        app.isPackaged,
        process.resourcesPath,
        app.getAppPath()
      );
    }
    return this.instance;
  }

  /**
   * 设置日志级别
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * 内部日志方法
   */
  private log(level: LogLevel, message: string, ...args: any[]): void {
    const levels = [
      LogLevel.ERROR,
      LogLevel.WARN,
      LogLevel.INFO,
      LogLevel.DEBUG,
    ];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex <= currentLevelIndex) {
      const prefix = `[PathResolver]`;
      switch (level) {
        case LogLevel.ERROR:
          console.error(prefix, message, ...args);
          break;
        case LogLevel.WARN:
          console.warn(prefix, message, ...args);
          break;
        case LogLevel.INFO:
          console.log(prefix, message, ...args);
          break;
        case LogLevel.DEBUG:
          console.log(prefix, message, ...args);
          break;
      }
    }
  }

  /**
   * 解析后端入口文件路径
   *
   * 打包模式: resources/backend/server-bundle.js
   * 开发模式: 向上查找 apps/backend/dist/server-bundle.js
   *
   * @returns 后端入口文件的绝对路径
   * @throws Error 如果找不到后端文件
   */
  resolveBackendEntry(): string {
    if (this.isPackaged) {
      // 打包后路径：resources/backend/server-bundle.js
      const backendPath = path.join(
        this.resourcesPath,
        'backend',
        'server-bundle.js'
      );
      this.log(
        LogLevel.DEBUG,
        `Resolved backend entry (packaged):`,
        backendPath
      );
      return backendPath;
    }

    // 开发模式：向上查找 apps/backend/dist/server-bundle.js
    // 从当前 appPath 向上最多 5 层查找
    this.log(LogLevel.DEBUG, `Searching for backend entry from:`, this.appPath);
    let currentDir = this.appPath;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(
        currentDir,
        'apps',
        'backend',
        'dist',
        'server-bundle.js'
      );
      if (fs.existsSync(candidate)) {
        this.log(LogLevel.INFO, `Found backend entry at:`, candidate);
        return candidate;
      }
      currentDir = path.dirname(currentDir);
    }

    const error =
      'Backend entry not found. Please run "npm run build:backend" to build the backend bundle.';
    this.log(LogLevel.ERROR, error);
    throw new Error(error);
  }

  /**
   * 解析渲染进程入口文件路径（前端 HTML）
   *
   * 打包模式: resources/renderer/index.html 或 app/renderer/index.html
   * 开发模式: 向上查找 frontend/dist/index.html
   *
   * @returns 渲染进程入口文件的绝对路径
   * @throws Error 如果找不到前端文件
   */
  resolveRendererEntry(): string {
    if (this.isPackaged) {
      // 打包后路径：尝试多个可能的位置
      const candidates = [
        path.join(this.resourcesPath, 'renderer', 'index.html'),
        path.join(this.appPath, 'renderer', 'index.html'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          this.log(
            LogLevel.DEBUG,
            `Resolved renderer entry (packaged):`,
            candidate
          );
          return candidate;
        }
      }

      const error =
        'Renderer entry not found in packaged app. Please check the build configuration.';
      this.log(LogLevel.ERROR, error);
      throw new Error(error);
    } else {
      // 开发模式：向上查找 frontend/dist/index.html
      this.log(
        LogLevel.DEBUG,
        `Searching for renderer entry from:`,
        this.appPath
      );
      let currentDir = this.appPath;
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(
          currentDir,
          'frontend',
          'dist',
          'index.html'
        );
        if (fs.existsSync(candidate)) {
          this.log(LogLevel.INFO, `Found renderer entry at:`, candidate);
          return candidate;
        }
        currentDir = path.dirname(currentDir);
      }

      const error =
        'Renderer entry not found. Please run "npm run build:frontend" to build the frontend.';
      this.log(LogLevel.ERROR, error);
      throw new Error(error);
    }
  }

  /**
   * 解析 Prisma Schema 文件路径
   *
   * 打包模式: resources/backend/schema.prisma
   * 开发模式: 向上查找 apps/backend/prisma/schema.prisma
   *
   * @returns Prisma Schema 文件的绝对路径
   * @throws Error 如果找不到 Schema 文件
   */
  resolvePrismaSchema(): string {
    if (this.isPackaged) {
      return path.join(this.resourcesPath, 'backend', 'schema.prisma');
    }

    // 开发模式：向上查找
    let currentDir = this.appPath;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(
        currentDir,
        'apps',
        'backend',
        'prisma',
        'schema.prisma'
      );
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      currentDir = path.dirname(currentDir);
    }

    throw new Error('Prisma schema not found.');
  }

  /**
   * 获取当前环境信息（用于调试）
   */
  getEnvironmentInfo(): {
    isPackaged: boolean;
    resourcesPath: string;
    appPath: string;
  } {
    return {
      isPackaged: this.isPackaged,
      resourcesPath: this.resourcesPath,
      appPath: this.appPath,
    };
  }
}
