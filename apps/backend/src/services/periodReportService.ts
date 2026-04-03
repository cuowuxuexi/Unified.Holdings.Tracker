import { prisma } from '../lib/prisma';
import { container } from '../container';
import { getExchangeRate } from './currencyService';

// ==================== 类型定义 ====================

export interface ReportPosition {
  assetCode: string;
  name: string;
  market: string;
  start: {
    quantity: number;
    price: number;
    marketValue: number;
  } | null;
  end: {
    quantity: number;
    price: number;
    marketValue: number;
  } | null;
  periodPnl: number;
  priceReturn: number | null;
  isCleared: boolean;
}

export interface ReportTransaction {
  date: string;
  type: string;
  assetCode: string;
  assetName: string;
  quantity: number;
  price: number;
  amount: number;
  commission: number;
}

export interface PeriodReport {
  portfolioId: string;
  portfolioName: string;
  period: { from: string; to: string };
  periodType: string; // 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
  portfolio: {
    startNetAssets: number;
    endNetAssets: number;
    netAssetsChange: number;
    periodReturn: number;
    startTotalMarketValue: number;
    endTotalMarketValue: number;
    startCash: number;
    endCash: number;
  };
  costs: {
    commission: number;
    leverageInterest: number;
    total: number;
  };
  exchangeRates: {
    currency: string;
    rate: number;
  }[];
  transactions: ReportTransaction[];
  positions: ReportPosition[];
  meta: {
    snapshotAvailable: boolean;
    startSnapshotDate: string;
    endSnapshotDate: string;
  };
}

// ==================== 服务 ====================

export const periodReportService = {
  /**
   * 生成期间报表核心数据
   */
  async getPeriodReport(
    portfolioId: string,
    from: string,
    to: string,
    periodType: string = 'custom'
  ): Promise<PeriodReport> {
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) throw new Error(`Portfolio ${portfolioId} not found`);

    // 1. 获取期初期末的组合级别快照
    const portfolioSnapshots = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "PortfolioSnapshot" WHERE "portfolioId" = ? AND "date" >= ? AND "date" <= ? ORDER BY "date" ASC`,
      portfolioId,
      from,
      to
    );

    let startSnapshotDate = from;
    let endSnapshotDate = to;
    const snapshotAvailable = portfolioSnapshots.length > 0;

    let startNetAssets = 0;
    let endNetAssets = 0;
    let startTotalMarketValue = 0;
    let endTotalMarketValue = 0;
    let startCash = 0;
    let endCash = 0;

    if (snapshotAvailable) {
      const first = portfolioSnapshots[0];
      const last = portfolioSnapshots[portfolioSnapshots.length - 1];
      startSnapshotDate = first.date;
      endSnapshotDate = last.date;
      startNetAssets = Number(first.netAssets);
      endNetAssets = Number(last.netAssets);
      startTotalMarketValue = Number(first.totalMarketValue);
      endTotalMarketValue = Number(last.totalMarketValue);
      startCash = Number(first.cash);
      endCash = Number(last.cash);
    }

    // 2. 获取期初期末的个股快照
    const startPositions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "PositionSnapshot" WHERE "portfolioId" = ? AND "date" = ?`,
      portfolioId,
      startSnapshotDate
    );
    const endPositions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "PositionSnapshot" WHERE "portfolioId" = ? AND "date" = ?`,
      portfolioId,
      endSnapshotDate
    );

    // 3. 获取期间交易流水
    const rawTransactions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Transaction" WHERE "portfolioId" = ? AND "date" >= ? AND "date" <= ? ORDER BY "date" ASC`,
      portfolioId,
      startSnapshotDate,
      endSnapshotDate
    );

    // 计算成本和费用
    let commission = 0;
    let leverageInterest = 0;
    const tradeSummary: Record<string, { buys: number; sells: number }> = {};

    // 获取资产基础信息
    const assets = await prisma.asset.findMany();
    const assetDict = Object.fromEntries(assets.map((a: any) => [a.code, a]));

    // 结构化交易记录
    const transactions: ReportTransaction[] = [];

    for (const tx of rawTransactions) {
      commission += Number(tx.commission || 0);
      if (tx.type === 'LEVERAGE_COST') {
        leverageInterest += Number(tx.amount || 0);
      }

      if (tx.assetCode && (tx.type === 'BUY' || tx.type === 'SELL')) {
        if (!tradeSummary[tx.assetCode])
          tradeSummary[tx.assetCode] = { buys: 0, sells: 0 };
        const amount = Number(tx.amount || 0);
        if (tx.type === 'BUY') tradeSummary[tx.assetCode].buys += amount;
        if (tx.type === 'SELL') tradeSummary[tx.assetCode].sells += amount;

        transactions.push({
          date: tx.date,
          type: tx.type,
          assetCode: tx.assetCode,
          assetName: assetDict[tx.assetCode]?.name || tx.assetCode,
          quantity: Number(tx.quantity || 0),
          price: Number(tx.price || 0),
          amount,
          commission: Number(tx.commission || 0),
        });
      }
    }

    // 4. 计算每只股票的期间盈亏
    const positionsMap: Record<string, ReportPosition> = {};
    const assetCodes = new Set([
      ...startPositions.map((p) => p.assetCode),
      ...endPositions.map((p) => p.assetCode),
    ]);

    for (const code of assetCodes) {
      const startSnap = startPositions.find((p) => p.assetCode === code);
      const endSnap = endPositions.find((p) => p.assetCode === code);
      const trades = tradeSummary[code] || { buys: 0, sells: 0 };

      const startMV = startSnap ? Number(startSnap.marketValue) : 0;
      const endMV = endSnap ? Number(endSnap.marketValue) : 0;
      const periodPnl = endMV - startMV + trades.sells - trades.buys;

      let priceReturn = null;
      if (startSnap && endSnap && Number(startSnap.currentPrice) > 0) {
        priceReturn =
          (Number(endSnap.currentPrice) / Number(startSnap.currentPrice) - 1) *
          100;
      }

      const assetDef = assetDict[code];

      positionsMap[code] = {
        assetCode: code,
        name: assetDef?.name || code,
        market: assetDef?.market || 'CN',
        start: startSnap
          ? {
              quantity: Number(startSnap.quantity),
              price: Number(startSnap.currentPrice),
              marketValue: startMV,
            }
          : null,
        end: endSnap
          ? {
              quantity: Number(endSnap.quantity),
              price: Number(endSnap.currentPrice),
              marketValue: endMV,
            }
          : null,
        periodPnl,
        priceReturn,
        isCleared: !endSnap || Number(endSnap.quantity) === 0,
      };
    }

    // 5. 获取当前汇率
    const usdRate = getExchangeRate('USD', 'CNY') ?? 7.25;
    const hkdRate = getExchangeRate('HKD', 'CNY') ?? 0.91;
    const exchangeRates = [
      { currency: 'USD/CNY', rate: usdRate },
      { currency: 'HKD/CNY', rate: hkdRate },
    ];

    // 6. 计算期间资产总变化
    const netAssetsChange = endNetAssets - startNetAssets;
    const periodReturn =
      startNetAssets > 0 ? (netAssetsChange / startNetAssets) * 100 : 0;

    return {
      portfolioId,
      portfolioName: portfolio.name,
      period: { from, to },
      periodType,
      portfolio: {
        startNetAssets,
        endNetAssets,
        netAssetsChange,
        periodReturn,
        startTotalMarketValue,
        endTotalMarketValue,
        startCash,
        endCash,
      },
      costs: {
        commission,
        leverageInterest,
        total: commission + leverageInterest,
      },
      exchangeRates,
      transactions,
      positions: Object.values(positionsMap),
      meta: {
        snapshotAvailable,
        startSnapshotDate,
        endSnapshotDate,
      },
    };
  },
};
