import {
  differenceInCalendarDays,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { container } from '../container';
import { prisma } from '../lib/prisma';
import type {
  HistoricalLeverageInfo,
  HistoricalPortfolioStats,
  Market,
  PeriodStat,
  Portfolio,
  Position,
  Transaction,
} from '../types';
import {
  calculateNetDepositedCash,
  calculateRealizedPnl,
  calculateTotalCommission,
  calculateTotalDividendIncome,
} from './calculation';
import {
  buildPositionsUsingDilutedCost,
  buildPositionsUsingLots,
  getCurrencyForAsset,
} from './portfolioReplay';

type NumericLike = number | string | bigint | null | undefined;

type PortfolioSnapshotRecord = {
  date: string;
  cash: NumericLike;
  totalMarketValue: NumericLike;
  netAssets: NumericLike;
  totalPnl: NumericLike;
  dailyPnl: NumericLike;
  leverageUsed?: NumericLike;
  leverageTotal?: NumericLike;
  leverageCostRate?: NumericLike;
  leverageCumulativeCost?: NumericLike;
  usdCny?: NumericLike;
  hkdCny?: NumericLike;
  createdAt?: Date | string | null;
};

type PositionSnapshotRecord = {
  assetCode: string;
  quantity: NumericLike;
  currentPrice: NumericLike;
  marketValue: NumericLike;
  costPrice?: NumericLike;
  totalPnl?: NumericLike;
  dailyPnl?: NumericLike;
  dailyPct?: NumericLike;
};

type QuoteSnapshotRecord = {
  assetCode: string;
  currentPrice: NumericLike;
  changePercent?: NumericLike;
  changeAmount?: NumericLike;
  prevClosePrice?: NumericLike;
  weeklyChangePercent?: NumericLike;
  monthlyChangePercent?: NumericLike;
  yearlyChangePercent?: NumericLike;
};

type ExchangeRateSnapshotRecord = {
  pair: string;
  rate?: NumericLike;
};

type SnapshotRangePoint = {
  date: string;
  netAssets: NumericLike;
};

class HistoricalStatsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class HistoricalStatsNotFoundError extends HistoricalStatsError {}

function toNumber(value: NumericLike, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function toNullableNumber(value: NumericLike): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function parseDateOnly(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const parsed = parseISO(`${date}T00:00:00+08:00`);
  return isValid(parsed) ? parsed : null;
}

export function isValidHistoricalDate(date: string): boolean {
  return parseDateOnly(date) !== null;
}

function getBoundaryDate(
  date: string,
  period: 'total' | 'weekly' | 'monthly' | 'yearly'
): string | null {
  const parsed = parseDateOnly(date);
  if (!parsed) {
    return null;
  }

  switch (period) {
    case 'total':
      return null;
    case 'weekly':
      return formatDate(startOfWeek(parsed, { weekStartsOn: 1 }));
    case 'monthly':
      return formatDate(startOfMonth(parsed));
    case 'yearly':
      return formatDate(startOfYear(parsed));
  }
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMarketFromCode(assetCode: string): Market {
  const prefix = assetCode.slice(0, 2).toLowerCase();
  if (prefix === 'hk') return 'HK' as Market;
  if (prefix === 'us') return 'US' as Market;
  return 'CN' as Market;
}

function getExchangeRateForCurrency(
  currency: string,
  snapshot: PortfolioSnapshotRecord,
  snapshotRates: Map<string, number>,
  limitations: Set<string>
): number | null {
  if (currency === 'CNY') {
    return 1;
  }

  if (currency === 'USD') {
    const exact = snapshotRates.get('USD-CNY');
    if (exact && exact > 0) {
      return exact;
    }
    const fallback = toNullableNumber(snapshot.usdCny);
    if (fallback && fallback > 0) {
      limitations.add(
        'ExchangeRateSnapshot 缺少 USD-CNY，回退使用 PortfolioSnapshot.usdCny'
      );
      return fallback;
    }
    limitations.add('缺少 USD-CNY 历史汇率快照，USD 持仓原币字段降级为 null');
    return null;
  }

  if (currency === 'HKD') {
    const exact = snapshotRates.get('HKD-CNY');
    if (exact && exact > 0) {
      return exact;
    }
    const fallback = toNullableNumber(snapshot.hkdCny);
    if (fallback && fallback > 0) {
      limitations.add(
        'ExchangeRateSnapshot 缺少 HKD-CNY，回退使用 PortfolioSnapshot.hkdCny'
      );
      return fallback;
    }
    limitations.add('缺少 HKD-CNY 历史汇率快照，HKD 持仓原币字段降级为 null');
    return null;
  }

  limitations.add(
    `缺少 ${currency} 对 CNY 的历史汇率快照，原币字段降级为 null`
  );
  return null;
}

function getHistoricalLeverage(
  snapshot: PortfolioSnapshotRecord,
  limitations: Set<string>
): HistoricalLeverageInfo {
  const usedAmount =
    toNullableNumber(snapshot.leverageUsed) ??
    Math.max(
      0,
      toNumber(snapshot.totalMarketValue) +
        toNumber(snapshot.cash) -
        toNumber(snapshot.netAssets)
    );

  const totalAmount = toNullableNumber(snapshot.leverageTotal);
  const costRate = toNullableNumber(snapshot.leverageCostRate);

  if (toNullableNumber(snapshot.leverageTotal) === null) {
    limitations.add(
      'PortfolioSnapshot.leverageTotal 缺失，历史授信额度降级为 null'
    );
  }
  if (toNullableNumber(snapshot.leverageCostRate) === null) {
    limitations.add(
      'PortfolioSnapshot.leverageCostRate 缺失，历史融资利率降级为 null'
    );
  }

  return {
    totalAmount,
    usedAmount,
    availableAmount:
      totalAmount === null ? null : Math.max(0, totalAmount - usedAmount),
    costRate,
  };
}

async function buildHistoricalPeriodStat(params: {
  portfolioId: string;
  targetDate: string;
  targetSnapshot: PortfolioSnapshotRecord;
  period: 'total' | 'weekly' | 'monthly' | 'yearly';
  limitations: Set<string>;
}): Promise<PeriodStat | undefined> {
  const { portfolioId, targetDate, targetSnapshot, period, limitations } =
    params;
  const boundaryDate = getBoundaryDate(targetDate, period);
  const snapshots = (await prisma.portfolioSnapshot.findMany({
    where: {
      portfolioId,
      date: boundaryDate
        ? {
            gte: boundaryDate,
            lte: targetDate,
          }
        : {
            lte: targetDate,
          },
    },
    orderBy: {
      date: 'asc',
    },
    select: {
      date: true,
      netAssets: true,
    },
  })) as unknown as SnapshotRangePoint[];

  if (snapshots.length < 2) {
    limitations.add(
      period === 'total'
        ? '总收益缺少足够的历史快照基准，periodReturnPercent 降级为 null'
        : `${period} 周期缺少足够的历史快照基准，返回 null`
    );
    return {
      periodReturnPercent: null,
      periodPnl: null,
      baseDate: null,
      endDate: targetSnapshot.date,
    };
  }

  const baseSnapshot = snapshots[0];
  const endSnapshot = snapshots[snapshots.length - 1];
  const baseNetAssets = toNumber(baseSnapshot.netAssets);
  const endNetAssets = toNumber(endSnapshot.netAssets);
  const periodPnl = endNetAssets - baseNetAssets;
  const fallbackDays =
    boundaryDate === null
      ? undefined
      : differenceInCalendarDays(
          parseDateOnly(baseSnapshot.date) ??
            parseISO(`${baseSnapshot.date}T00:00:00+08:00`),
          parseDateOnly(boundaryDate) ??
            parseISO(`${boundaryDate}T00:00:00+08:00`)
        );

  if (boundaryDate !== null && baseSnapshot.date !== boundaryDate) {
    limitations.add(
      `${period} 周期未命中理想基准日 ${boundaryDate}，实际回退到 ${baseSnapshot.date}`
    );
  }

  return {
    periodReturnPercent:
      baseNetAssets > 0 ? (periodPnl / baseNetAssets) * 100 : null,
    periodPnl,
    totalValueChange: periodPnl,
    totalValueChangePercent:
      baseNetAssets > 0 ? (periodPnl / baseNetAssets) * 100 : null,
    baseDate: baseSnapshot.date,
    endDate: endSnapshot.date,
    fallbackDays:
      fallbackDays !== undefined && fallbackDays > 0 ? fallbackDays : undefined,
  };
}

function buildHistoricalPortfolioContext(
  portfolio: Portfolio,
  transactions: Transaction[],
  snapshot: PortfolioSnapshotRecord
): Portfolio {
  return {
    ...portfolio,
    cash: toNumber(snapshot.cash),
    transactions,
  };
}

function buildHistoricalPosition(params: {
  row: PositionSnapshotRecord;
  assetMap: Map<string, { code: string; name: string; market: Market }>;
  quoteMap: Map<string, QuoteSnapshotRecord>;
  snapshot: PortfolioSnapshotRecord;
  snapshotRates: Map<string, number>;
  lotPositions: ReturnType<typeof buildPositionsUsingLots>;
  dilutedPositions: ReturnType<typeof buildPositionsUsingDilutedCost>;
  limitations: Set<string>;
}): Position {
  const {
    row,
    assetMap,
    quoteMap,
    snapshot,
    snapshotRates,
    lotPositions,
    dilutedPositions,
    limitations,
  } = params;
  const assetCode = row.assetCode;
  const asset =
    assetMap.get(assetCode) ??
    ({
      code: assetCode,
      name: assetCode,
      market: getMarketFromCode(assetCode),
    } as const);
  const quote = quoteMap.get(assetCode);
  const lotState = lotPositions.get(assetCode);
  const dilutedState = dilutedPositions.get(assetCode);
  const currency =
    dilutedState?.currency ??
    lotState?.currency ??
    getCurrencyForAsset(assetCode);
  const quantity = toNumber(row.quantity);
  const costPrice =
    toNullableNumber(row.costPrice) ??
    (lotState && lotState.quantity > 0
      ? lotState.totalCostCny / lotState.quantity
      : null);
  if (toNullableNumber(row.costPrice) === null && costPrice !== null) {
    limitations.add(
      `PositionSnapshot.costPrice 缺失，${assetCode} 已回退为交易回放结果`
    );
  }

  const totalCost =
    dilutedState !== undefined
      ? dilutedState.totalBuyCostCny - dilutedState.totalSellProceedsCny
      : toNullableNumber(row.totalPnl) !== null
        ? toNumber(row.marketValue) - toNumber(row.totalPnl)
        : (costPrice ?? 0) * quantity;
  const totalCostLocal =
    dilutedState !== undefined
      ? dilutedState.totalBuyCostLocal - dilutedState.totalSellProceedsLocal
      : null;

  const fxRate = getExchangeRateForCurrency(
    currency,
    snapshot,
    snapshotRates,
    limitations
  );
  const marketValue = toNumber(row.marketValue);
  const dailyPnl = toNumber(row.dailyPnl);
  const totalPnl = toNumber(row.totalPnl);
  const costPriceLocal =
    lotState && lotState.quantity > 0
      ? lotState.totalCostLocal / lotState.quantity
      : fxRate && fxRate > 0
        ? (costPrice ?? 0) / fxRate
        : currency === 'CNY'
          ? (costPrice ?? 0)
          : undefined;
  const marketValueLocal =
    fxRate && fxRate > 0
      ? marketValue / fxRate
      : currency === 'CNY'
        ? marketValue
        : undefined;
  const dailyChangeLocal =
    fxRate && fxRate > 0
      ? dailyPnl / fxRate
      : currency === 'CNY'
        ? dailyPnl
        : undefined;
  const floatingPnl = marketValue - totalCost;
  const floatingPnlPercent =
    totalCost !== 0 ? (floatingPnl / totalCost) * 100 : undefined;

  return {
    asset,
    quantity,
    costPrice: costPrice ?? 0,
    costPriceLocal,
    totalCost,
    totalCostLocal: totalCostLocal ?? undefined,
    totalBuyCost: dilutedState?.totalBuyCostCny,
    totalBuyCostLocal: dilutedState?.totalBuyCostLocal,
    dilutedPrice:
      dilutedState && dilutedState.quantity > 0
        ? (dilutedState.totalBuyCostCny -
            dilutedState.totalSellProceedsCny -
            dilutedState.totalDividendCny) /
          dilutedState.quantity
        : undefined,
    dilutedPriceLocal:
      dilutedState && dilutedState.quantity > 0
        ? (dilutedState.totalBuyCostLocal -
            dilutedState.totalSellProceedsLocal -
            dilutedState.totalDividendLocal) /
          dilutedState.quantity
        : undefined,
    totalDividend: dilutedState?.totalDividendCny,
    totalDividendLocal: dilutedState?.totalDividendLocal,
    currency,
    marketValue,
    marketValueLocal,
    marketValueCNY: marketValue,
    currentPrice:
      toNullableNumber(row.currentPrice) ??
      toNullableNumber(quote?.currentPrice) ??
      0,
    dailyChange: dailyPnl,
    dailyChangeLocal,
    dailyChangePercent: toNullableNumber(row.dailyPct) ?? undefined,
    totalPnl,
    totalPnlLocal:
      fxRate && fxRate > 0
        ? totalPnl / fxRate
        : currency === 'CNY'
          ? totalPnl
          : undefined,
    totalPnlPercent:
      dilutedState?.totalBuyCostCny && dilutedState.totalBuyCostCny > 0
        ? (totalPnl / dilutedState.totalBuyCostCny) * 100
        : undefined,
    floatingPnl,
    floatingPnlLocal:
      fxRate && fxRate > 0
        ? floatingPnl / fxRate
        : currency === 'CNY'
          ? floatingPnl
          : undefined,
    floatingPnlPercent,
    weeklyChangePercent: toNullableNumber(quote?.weeklyChangePercent),
    monthlyChangePercent: toNullableNumber(quote?.monthlyChangePercent),
    yearlyChangePercent: toNullableNumber(quote?.yearlyChangePercent),
  };
}

export async function getHistoricalStats(
  portfolioId: string,
  date: string
): Promise<HistoricalPortfolioStats> {
  if (!isValidHistoricalDate(date)) {
    throw new HistoricalStatsError(
      `Invalid historical date: ${date}. Expected YYYY-MM-DD.`
    );
  }

  const portfolio = await container.getPortfolioUseCase.execute({
    portfolioId,
  });
  if (!portfolio) {
    throw new HistoricalStatsNotFoundError(
      `Portfolio ${portfolioId} not found`
    );
  }

  const snapshot = (await prisma.portfolioSnapshot.findFirst({
    where: {
      portfolioId,
      date,
    },
    select: {
      date: true,
      cash: true,
      totalMarketValue: true,
      netAssets: true,
      totalPnl: true,
      dailyPnl: true,
      leverageUsed: true,
      leverageTotal: true,
      leverageCostRate: true,
      leverageCumulativeCost: true,
      usdCny: true,
      hkdCny: true,
      createdAt: true,
    },
  })) as PortfolioSnapshotRecord | null;

  if (!snapshot) {
    throw new HistoricalStatsNotFoundError(
      `No snapshot found for portfolio ${portfolioId} on ${date}`
    );
  }

  const [positionRowsRaw, exchangeRateRowsRaw] = await Promise.all([
    prisma.positionSnapshot.findMany({
      where: {
        portfolioId,
        date,
      },
      orderBy: {
        assetCode: 'asc',
      },
      select: {
        assetCode: true,
        quantity: true,
        currentPrice: true,
        marketValue: true,
        costPrice: true,
        totalPnl: true,
        dailyPnl: true,
        dailyPct: true,
      },
    }),
    prisma.exchangeRateSnapshot.findMany({
      where: {
        date,
      },
      select: {
        pair: true,
        rate: true,
      },
    }),
  ]);

  const positionRows = positionRowsRaw as unknown as PositionSnapshotRecord[];
  const exchangeRateRows =
    exchangeRateRowsRaw as unknown as ExchangeRateSnapshotRecord[];
  const limitations = new Set<string>();

  if (positionRows.length === 0) {
    throw new HistoricalStatsNotFoundError(
      `No position snapshot rows found for portfolio ${portfolioId} on ${date}`
    );
  }

  const historicalTransactions = (portfolio.transactions ?? [])
    .filter((tx) => tx.date.slice(0, 10) <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailyTransactions = historicalTransactions.filter(
    (tx) => tx.date.slice(0, 10) === date
  );

  const lotPositions = buildPositionsUsingLots(historicalTransactions);
  const dilutedPositions = buildPositionsUsingDilutedCost(
    historicalTransactions
  );
  const assetCodes = Array.from(
    new Set(positionRows.map((row) => row.assetCode))
  );

  const [assets, quoteRowsRaw] = await Promise.all([
    prisma.asset.findMany({
      where: {
        code: {
          in: assetCodes,
        },
      },
      select: {
        code: true,
        name: true,
        market: true,
      },
    }),
    prisma.quoteSnapshot.findMany({
      where: {
        assetCode: {
          in: assetCodes,
        },
        date,
      },
      select: {
        assetCode: true,
        currentPrice: true,
        changePercent: true,
        changeAmount: true,
        prevClosePrice: true,
        weeklyChangePercent: true,
        monthlyChangePercent: true,
        yearlyChangePercent: true,
      },
    }),
  ]);

  const assetMap = new Map(
    assets.map((asset) => [
      asset.code,
      asset as { code: string; name: string; market: Market },
    ])
  );
  const quoteRows = quoteRowsRaw as unknown as QuoteSnapshotRecord[];
  const quoteMap = new Map(quoteRows.map((row) => [row.assetCode, row]));
  const snapshotRates = new Map(
    exchangeRateRows
      .map((row) => [row.pair, toNullableNumber(row.rate)])
      .filter((entry): entry is [string, number] => entry[1] !== null)
  );

  if (quoteRows.length < assetCodes.length) {
    limitations.add(
      'QuoteSnapshot 未覆盖全部持仓；周/月/年个股涨跌幅按可用快照补充，缺失部分返回 null'
    );
  }
  if (exchangeRateRows.length === 0) {
    limitations.add(
      'ExchangeRateSnapshot 缺失；非 CNY 持仓的原币金额字段将按 null 降级'
    );
  }
  limitations.add(
    'benchmark/index 历史序列当前未接入，historical API 不返回指数比较数据'
  );

  const positions = positionRows.map((row) =>
    buildHistoricalPosition({
      row,
      assetMap,
      quoteMap,
      snapshot,
      snapshotRates,
      lotPositions,
      dilutedPositions,
      limitations,
    })
  );

  const leverage = getHistoricalLeverage(snapshot, limitations);
  const historicalPortfolio = buildHistoricalPortfolioContext(
    portfolio,
    historicalTransactions,
    snapshot
  );

  const [
    weeklyStats,
    monthlyStats,
    yearlyStats,
    totalStats,
    totalCommission,
    realizedPnl,
  ] = await Promise.all([
    buildHistoricalPeriodStat({
      portfolioId,
      targetDate: date,
      targetSnapshot: snapshot,
      period: 'weekly',
      limitations,
    }),
    buildHistoricalPeriodStat({
      portfolioId,
      targetDate: date,
      targetSnapshot: snapshot,
      period: 'monthly',
      limitations,
    }),
    buildHistoricalPeriodStat({
      portfolioId,
      targetDate: date,
      targetSnapshot: snapshot,
      period: 'yearly',
      limitations,
    }),
    buildHistoricalPeriodStat({
      portfolioId,
      targetDate: date,
      targetSnapshot: snapshot,
      period: 'total',
      limitations,
    }),
    calculateTotalCommission(historicalPortfolio),
    calculateRealizedPnl(historicalPortfolio),
  ]);

  const leverageCost = toNullableNumber(snapshot.leverageCumulativeCost);
  if (leverageCost === null) {
    limitations.add(
      'PortfolioSnapshot.leverageCumulativeCost 缺失，历史融资成本降级为 null'
    );
  }

  const totalMarketValue = toNumber(snapshot.totalMarketValue);
  const cash = toNumber(snapshot.cash);
  const totalAssets = cash + totalMarketValue;
  const totalPnl = toNumber(snapshot.totalPnl);
  const timestamp =
    snapshot.createdAt && !Number.isNaN(new Date(snapshot.createdAt).getTime())
      ? new Date(snapshot.createdAt).getTime()
      : new Date(`${date}T15:00:00+08:00`).getTime();

  return {
    portfolioId: portfolio.id,
    name: portfolio.name,
    date,
    cash,
    leverage,
    totalMarketValue,
    totalAssets,
    netAssets: toNumber(snapshot.netAssets),
    netDepositedCash: calculateNetDepositedCash(historicalPortfolio),
    totalCommission,
    leverageCost,
    totalDividendIncome: calculateTotalDividendIncome(historicalPortfolio),
    dailyPnl: toNumber(snapshot.dailyPnl),
    totalPnl,
    realizedPnl,
    unrealizedPnl: totalPnl - realizedPnl,
    periodReturnPercent: totalStats?.periodReturnPercent ?? null,
    weeklyStats,
    monthlyStats,
    yearlyStats,
    positions,
    timestamp,
    transactions: dailyTransactions,
    meta: {
      requestedDate: date,
      snapshotDate: snapshot.date,
      quoteSnapshotUsed: quoteRows.length > 0,
      exchangeRateSnapshotUsed: exchangeRateRows.length > 0,
      limitations: Array.from(limitations),
    },
  };
}
