import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

const envFileCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const candidate of envFileCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const DEFAULT_DB_URL = 'file:./prisma/data/portfolio.db';
const ELECTRON_DB_FILENAME = 'portfolio.db';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  API_BASE_PATH: z
    .string()
    .optional()
    .transform((value) => {
      // 确保value是字符串并且处理Windows路径问题
      if (!value || typeof value !== 'string' || value.trim() === '') {
        return '/api';
      }

      // 如果看起来像Windows绝对路径，返回默认值
      if (
        value.includes(':') &&
        (value.includes('\\') || value.includes('/'))
      ) {
        return '/api';
      }

      return value.startsWith('/') ? value : `/${value}`;
    })
    .default('/api'),
  DATABASE_URL: z.string().default(DEFAULT_DB_URL),
  LOG_PATH: z.string().optional(),
});

const parsed = envSchema.parse(process.env);
const resolvedDatabaseUrl = resolveDatabaseUrl(
  parsed.DATABASE_URL,
  parsed.NODE_ENV
);

const resolvedLogPath = resolveLogPath(parsed.LOG_PATH, parsed.NODE_ENV);

// 统一进程内可读的数据库路径，避免 Prisma Client 读取到不一致的值
process.env.DATABASE_URL = resolvedDatabaseUrl;

// 如果解析出了日志路径，设置到环境变量中供 DataService 使用
if (resolvedLogPath) {
  process.env.LOG_PATH = resolvedLogPath;
}

export const appEnv = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  frontendUrl: parsed.FRONTEND_URL,
  apiBasePath: parsed.API_BASE_PATH ?? '/api',
  databaseUrl: resolvedDatabaseUrl,
  logPath: resolvedLogPath,
};

function resolveDatabaseUrl(rawUrl: string, nodeEnv: string): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const normalized = trimmed.length > 0 ? trimmed : DEFAULT_DB_URL;

  if (nodeEnv === 'development') {
    return normalized;
  }

  const electronUserData = process.env.ELECTRON_USER_DATA;
  if (electronUserData && electronUserData.trim().length > 0) {
    const dbPath = path.join(electronUserData, ELECTRON_DB_FILENAME);
    return `file:${dbPath}`;
  }

  return normalized;
}

function resolveLogPath(
  rawPath: string | undefined,
  nodeEnv: string
): string | undefined {
  if (rawPath && rawPath.trim().length > 0) {
    return rawPath;
  }

  // 如果在 Electron 环境中（有 ELECTRON_USER_DATA），优先使用 userData/logs
  const electronUserData = process.env.ELECTRON_USER_DATA;
  if (electronUserData && electronUserData.trim().length > 0) {
    return path.join(electronUserData, 'logs');
  }

  // 开发环境或普通环境，返回 undefined，让 DataService 使用默认值 (baseDataDir/logs)
  return undefined;
}
