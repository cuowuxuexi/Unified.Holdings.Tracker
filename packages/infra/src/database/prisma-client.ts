import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);

export const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseUrl },
  },
});

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
