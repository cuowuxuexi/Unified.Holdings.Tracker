import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);

/** SQLite 数据库文件的绝对路径（供备份等场景使用） */
export const databaseFilePath = databaseUrl.replace(/^file:/, '').split('?')[0];

export const prisma = new PrismaClient({
  datasources: {
    // connection_limit=1：单连接串行化写入，配合下方 busy_timeout 避免 SQLITE_BUSY
    db: { url: `${databaseUrl}?connection_limit=1` },
  },
});

// SQLite 生产加固：WAL 模式（持久化到 db 文件）+ 写锁等待，避免并发写直接报错
void (async () => {
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
  } catch (error) {
    console.error('[prisma-client] 初始化 SQLite PRAGMA 失败:', error);
  }
})();

export type PrismaClientInstance = PrismaClient;

function resolveDatabaseUrl(rawUrl: string | undefined): string {
  const SQLITE_PREFIX = 'file:';
  const repoRoot = findRepoRoot() ?? path.resolve(__dirname, '../../../..');
  const fallbackRelativePath = path.join(
    'apps',
    'backend',
    'prisma',
    'data',
    'portfolio.db'
  );

  const rawPath = extractPath(rawUrl, SQLITE_PREFIX) ?? fallbackRelativePath;
  const absolutePath = ensureAbsolutePath(rawPath, repoRoot);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const resolvedUrl = `${SQLITE_PREFIX}${absolutePath}`;
  console.log(`[prisma-client] 使用数据库: ${resolvedUrl}`);
  return resolvedUrl;
}

function findRepoRoot(): string | null {
  const starts = [process.cwd(), __dirname];

  for (const start of starts) {
    let current = path.resolve(start);

    while (true) {
      if (
        fs.existsSync(path.join(current, 'package.json')) &&
        fs.existsSync(
          path.join(current, 'apps', 'backend', 'prisma', 'schema.prisma')
        )
      ) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return null;
}

function extractPath(
  rawUrl: string | undefined,
  prefix: string
): string | null {
  if (!rawUrl || rawUrl.trim() === '') return null;
  if (rawUrl.startsWith(prefix)) {
    const stripped = rawUrl.slice(prefix.length).trim();
    return stripped.length > 0 ? stripped : null;
  }
  return rawUrl.trim();
}

function ensureAbsolutePath(targetPath: string, repoRoot: string): string {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  const normalizedTarget = targetPath.replace(/^\.\//, '');
  const potentialBases = [
    process.cwd(),
    repoRoot,
    path.join(repoRoot, 'apps', 'backend'),
    path.join(repoRoot, 'apps', 'backend', 'prisma'),
  ];

  for (const base of potentialBases) {
    const candidate = path.resolve(base, normalizedTarget);
    if (fs.existsSync(path.dirname(candidate))) {
      return candidate;
    }
  }

  // 如果以上路径都不存在，最后使用仓库根目录下的 fallback 路径
  return path.resolve(repoRoot, normalizedTarget);
}
