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
  DATABASE_URL: z.string().default('file:./prisma/data/portfolio.db'),
});

const parsed = envSchema.parse(process.env);

export const appEnv = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  frontendUrl: parsed.FRONTEND_URL,
  apiBasePath: parsed.API_BASE_PATH ?? '/api',
  databaseUrl: parsed.DATABASE_URL,
};
