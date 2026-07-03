/**
 * 整库自动备份服务
 * 每日通过 SQLite VACUUM INTO 对整个数据库做在线备份（不阻塞正常读写），
 * 产物为完整可用的 .db 文件，保存在数据目录下的 db-backups/（位于 docker volume 内）。
 * 与 backupService.ts（按组合手动 JSON 备份）互补。
 * @module services/dbBackupService
 */

import fs from 'fs';
import path from 'path';
import { prisma, databaseFilePath } from '@uht/infra';

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_SKIP_WINDOW_MS = 20 * 60 * 60 * 1000;
const MAX_BACKUPS = 7;
const BACKUP_PREFIX = 'portfolio-';

let timer: NodeJS.Timeout | null = null;

function getBackupDir(): string {
  return path.join(path.dirname(databaseFilePath), 'db-backups');
}

function listBackups(backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.db'))
    .sort();
}

function hasRecentBackup(backupDir: string, maxAgeMs: number): boolean {
  const backups = listBackups(backupDir);
  if (backups.length === 0) return false;
  const newest = path.join(backupDir, backups[backups.length - 1]);
  try {
    return Date.now() - fs.statSync(newest).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

function pruneOldBackups(backupDir: string): void {
  const backups = listBackups(backupDir);
  const excess = backups.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) {
    try {
      fs.unlinkSync(path.join(backupDir, backups[i]));
    } catch (error) {
      console.error(`[DbBackup] 清理旧备份失败: ${backups[i]}`, error);
    }
  }
}

export async function runDbBackup(): Promise<string> {
  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(backupDir, `${BACKUP_PREFIX}${stamp}.db`);

  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  pruneOldBackups(backupDir);
  return target;
}

export function startDbBackupScheduler(): void {
  const run = async () => {
    try {
      const file = await runDbBackup();
      console.log(`[DbBackup] 数据库备份完成: ${file}`);
    } catch (error) {
      console.error('[DbBackup] 数据库备份失败:', error);
    }
  };

  // 启动时若近 20 小时内没有备份，先补一次
  if (!hasRecentBackup(getBackupDir(), STARTUP_SKIP_WINDOW_MS)) {
    void run();
  }

  timer = setInterval(run, BACKUP_INTERVAL_MS);
  timer.unref?.();
  console.log('[DbBackup] 每日整库备份调度已启动');
}

export function stopDbBackupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
