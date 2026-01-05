import { PrismaClient, Prisma, TransactionType } from '@prisma/client';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { promises as fsp } from 'fs';
import dotenv from 'dotenv';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../../.env'),
];

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const prisma = new PrismaClient();

interface LegacyLeverage {
  totalAmount?: number;
  usedAmount?: number;
  availableAmount?: number;
  costRate?: number;
}

interface LegacyTransaction {
  id?: string;
  date?: string;
  type?: string;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
  note?: string;
}

interface LegacyPortfolio {
  id: string;
  name: string;
  initialCash?: number;
  cash?: number;
  leverage?: LegacyLeverage;
  transactions?: LegacyTransaction[];
}

const decimal = (value?: number | string | null, fallback = 0) => {
  if (value === undefined || value === null || value === '') {
    return new Prisma.Decimal(fallback);
  }
  const num = typeof value === 'string' ? Number(value) : value;
  return new Prisma.Decimal(
    Number.isFinite(num as number) ? (num as number) : fallback
  );
};

const decimalOrNull = (value?: number | string | null) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num as number)) {
    return null;
  }
  return new Prisma.Decimal(num as number);
};

const mapTransactionType = (type?: string): TransactionType => {
  if (!type) return TransactionType.BUY;
  const upper = type.toUpperCase();
  return Object.values(TransactionType).includes(upper as TransactionType)
    ? (upper as TransactionType)
    : TransactionType.BUY;
};

async function loadPortfolios(): Promise<LegacyPortfolio[]> {
  const dataFile = process.env.PORTFOLIO_JSON_PATH
    ? path.resolve(process.cwd(), process.env.PORTFOLIO_JSON_PATH)
    : path.resolve(__dirname, '../data/portfolios/portfolios.json');

  const raw = await fsp.readFile(dataFile, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Unexpected JSON structure in ${dataFile}`);
  }
  return parsed as LegacyPortfolio[];
}

async function upsertPortfolio(portfolio: LegacyPortfolio) {
  const leverage = portfolio.leverage ?? {};
  await prisma.portfolio.upsert({
    where: { id: portfolio.id },
    update: {
      name: portfolio.name,
      initialCash: decimal(portfolio.initialCash),
      cash: decimal(portfolio.cash),
      leverageTotalAmount: decimal(leverage.totalAmount),
      leverageUsedAmount: decimal(leverage.usedAmount),
      leverageAvailableAmount: decimal(leverage.availableAmount),
      leverageCostRate: decimal(leverage.costRate),
    },
    create: {
      id: portfolio.id,
      name: portfolio.name,
      initialCash: decimal(portfolio.initialCash),
      cash: decimal(portfolio.cash),
      leverageTotalAmount: decimal(leverage.totalAmount),
      leverageUsedAmount: decimal(leverage.usedAmount),
      leverageAvailableAmount: decimal(leverage.availableAmount),
      leverageCostRate: decimal(leverage.costRate),
    },
  });

  await prisma.transaction.deleteMany({ where: { portfolioId: portfolio.id } });

  const txList = portfolio.transactions ?? [];
  for (const tx of txList) {
    await prisma.transaction.create({
      data: {
        id: tx.id ?? randomUUID(),
        portfolioId: portfolio.id,
        type: mapTransactionType(tx.type),
        date: tx.date ? new Date(tx.date) : new Date(),
        assetCode: tx.assetCode ?? null,
        quantity: decimalOrNull(tx.quantity),
        price: decimalOrNull(tx.price),
        amount: decimalOrNull(tx.amount),
        commission: decimalOrNull(tx.commission),
        leverageUsed: decimalOrNull(tx.leverageUsed),
        currency: tx.currency ?? 'CNY',
        exchangeRate: decimalOrNull(tx.exchangeRate),
        notes: tx.notes ?? tx.note ?? null,
      },
    });
  }

  console.log(
    `? Imported portfolio ${portfolio.name} (${portfolio.id}) with ${txList.length} transactions.`
  );
}

async function main() {
  const portfolios = await loadPortfolios();
  for (const portfolio of portfolios) {
    await upsertPortfolio(portfolio);
  }
  console.log(
    `\n? Migration complete. Imported ${portfolios.length} portfolios.`
  );
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
