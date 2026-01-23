import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

type BackupMetadata = {
  backupId: string;
  portfolioId: string;
  portfolioName: string;
  createdAt: string;
  version: string;
  transactionCount: number;
  assetCount: number;
};

type BackupPortfolio = {
  id: string;
  name: string;
  initialCash: number;
  cash: number;
  leverageTotalAmount: number;
  leverageUsedAmount: number;
  leverageAvailableAmount: number;
  leverageCostRate: number;
  attentionInfo?: string;
  createdAt: string;
  updatedAt: string;
};

type BackupAsset = {
  code: string;
  name: string;
  market: 'CN' | 'HK' | 'US';
  createdAt: string;
  updatedAt: string;
};

type BackupTransaction = {
  id: string;
  portfolioId: string;
  type:
    | 'BUY'
    | 'SELL'
    | 'DEPOSIT'
    | 'WITHDRAW'
    | 'LEVERAGE_ADD'
    | 'LEVERAGE_REMOVE'
    | 'LEVERAGE_COST'
    | 'DIVIDEND';
  date: string;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency: string;
  exchangeRate?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type PortfolioBackup = {
  metadata: BackupMetadata;
  portfolio: BackupPortfolio;
  assets: BackupAsset[];
  transactions: BackupTransaction[];
};

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = value;
    i++;
  }
  return args;
}

function toSqliteUrl(dbPath: string): string {
  const normalized = path.resolve(dbPath);
  return `file:${normalized}`;
}

function assertBackupShape(value: any): asserts value is PortfolioBackup {
  if (!value || typeof value !== 'object') throw new Error('备份内容不是对象');
  if (!value.metadata?.portfolioId) throw new Error('备份缺少 metadata.portfolioId');
  if (!value.portfolio?.id) throw new Error('备份缺少 portfolio.id');
  if (!Array.isArray(value.assets)) throw new Error('备份缺少 assets 数组');
  if (!Array.isArray(value.transactions)) throw new Error('备份缺少 transactions 数组');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupPath = args['--backup'];
  const dbPath = args['--db'];
  const makeDbBackup = args['--backup-db'] !== 'false';

  if (!backupPath || !dbPath) {
    console.error(
      '用法: ts-node import-backup-archive.ts --backup <backup.json> --db <portfolio.db> [--backup-db false]'
    );
    process.exit(1);
  }

  const resolvedBackupPath = path.resolve(backupPath);
  const resolvedDbPath = path.resolve(dbPath);

  if (!fs.existsSync(resolvedBackupPath)) {
    throw new Error(`找不到备份文件: ${resolvedBackupPath}`);
  }
  if (!fs.existsSync(resolvedDbPath)) {
    throw new Error(`找不到数据库文件: ${resolvedDbPath}`);
  }

  if (makeDbBackup) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDbPath = `${resolvedDbPath}.bak-${timestamp}`;
    fs.copyFileSync(resolvedDbPath, backupDbPath);
    console.log(`已备份数据库: ${backupDbPath}`);
  }

  const raw = fs.readFileSync(resolvedBackupPath, 'utf-8');
  const parsed = JSON.parse(raw);
  assertBackupShape(parsed);

  const sqliteUrl = toSqliteUrl(resolvedDbPath);
  console.log(`使用数据库: ${sqliteUrl}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: sqliteUrl } },
  });

  try {
    const backup = parsed as PortfolioBackup;
    const targetPortfolioId = backup.metadata.portfolioId;

    await prisma.$transaction(async (tx) => {
      const existingPortfolio = await tx.portfolio.findUnique({
        where: { id: targetPortfolioId },
      });

      if (existingPortfolio) {
        await tx.portfolio.update({
          where: { id: targetPortfolioId },
          data: {
            name: backup.portfolio.name,
            initialCash: backup.portfolio.initialCash,
            cash: backup.portfolio.cash,
            leverageTotalAmount: backup.portfolio.leverageTotalAmount,
            leverageUsedAmount: backup.portfolio.leverageUsedAmount,
            leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
            leverageCostRate: backup.portfolio.leverageCostRate,
            attentionInfo: backup.portfolio.attentionInfo ?? null,
          },
        });
      } else {
        await tx.portfolio.create({
          data: {
            id: targetPortfolioId,
            name: backup.portfolio.name,
            initialCash: backup.portfolio.initialCash,
            cash: backup.portfolio.cash,
            leverageTotalAmount: backup.portfolio.leverageTotalAmount,
            leverageUsedAmount: backup.portfolio.leverageUsedAmount,
            leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
            leverageCostRate: backup.portfolio.leverageCostRate,
            attentionInfo: backup.portfolio.attentionInfo ?? null,
          },
        });
      }

      for (const asset of backup.assets) {
        await tx.asset.upsert({
          where: { code: asset.code },
          update: {
            name: asset.name,
            market: asset.market,
          },
          create: {
            code: asset.code,
            name: asset.name,
            market: asset.market,
          },
        });
      }

      await tx.transaction.deleteMany({
        where: { portfolioId: targetPortfolioId },
      });

      for (const item of backup.transactions) {
        await tx.transaction.create({
          data: {
            id: randomUUID(),
            portfolioId: targetPortfolioId,
            type: item.type,
            date: new Date(item.date),
            assetCode: item.assetCode ?? null,
            quantity: item.quantity ?? null,
            price: item.price ?? null,
            amount: item.amount ?? null,
            commission: item.commission ?? null,
            leverageUsed: item.leverageUsed ?? null,
            currency: item.currency ?? 'CNY',
            exchangeRate: item.exchangeRate ?? null,
            notes: item.notes ?? null,
          },
        });
      }
    });

    console.log(
      `导入完成: ${parsed.metadata.portfolioName} (${parsed.metadata.portfolioId})，交易 ${parsed.metadata.transactionCount}，资产 ${parsed.metadata.assetCount}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('导入失败:', err);
  process.exit(1);
});

