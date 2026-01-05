import { Portfolio, Position, TransactionType } from '../../types';
import {
  LotTracker,
  getCommissionInCny,
  resolveTransactionExchangeRate,
} from '../portfolioReplay';
import { cacheService } from '@uht/infra/cache/cache-service';
import { hashTransactions } from './utils';

/**
 * 计算已实现盈亏（基于买卖交易和股息收入）
 * 已实现盈亏 = 所有卖出收入 - 对应的买入成本（包括手续费）+ 股息收入
 *
 * @description
 * 使用加权平均成本法（FIFO）计算已实现盈亏：
 * - 每次买入：累加成本（价格*数量 + 手续费）
 * - 每次卖出：按平均成本计算已实现盈亏 = 卖出收入 - 平均成本*数量 - 手续费
 * - 股息收入：直接计入已实现盈亏（已换算为CNY）
 *
 * @param portfolio 投资组合对象
 * @returns 已实现盈亏 (CNY)
 */
export async function calculateRealizedPnl(
  portfolio: Portfolio
): Promise<number> {
  if (!portfolio.transactions || portfolio.transactions.length === 0) {
    return 0;
  }

  // 【性能优化】使用交易记录的hash作为缓存键
  const txHash = hashTransactions(portfolio.transactions);
  const cacheKey = `realized-pnl:${portfolio.id}:${txHash}`;

  const cached = cacheService.get<number>(cacheKey);
  if (cached !== null) {
    console.log(`[calculateRealizedPnl] 使用缓存结果: ${cached.toFixed(2)}`);
    return cached;
  }

  const tracker = new LotTracker();
  let tradingPnl = 0;
  let totalDividendIncome = 0;

  const sortedTransactions = [...portfolio.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const tx of sortedTransactions) {
    if (tx.type === TransactionType.DIVIDEND) {
      const dividendAmount = Number(tx.amount || 0);
      totalDividendIncome += dividendAmount;
      console.log(
        `[calculateRealizedPnl] 股息收入: ${dividendAmount.toFixed(2)} CNY (资产: ${tx.assetCode || '未知'})`
      );
      continue;
    }

    if (tx.type === TransactionType.BUY) {
      tracker.applyBuy(tx);
      continue;
    }

    if (tx.type !== TransactionType.SELL) {
      continue;
    }

    const price = Number(tx.price ?? 0);
    const quantity = Number(tx.quantity ?? 0);
    if (!tx.assetCode || quantity <= 0 || price <= 0) {
      console.warn(
        `[calculateRealizedPnl] 忽略无效卖出交易 ${tx.id ?? tx.assetCode}`
      );
      continue;
    }

    const sellResult = tracker.applySell(tx);
    if (sellResult.matchedQuantity <= 0) {
      console.warn(
        `[calculateRealizedPnl] 卖出 ${tx.assetCode} 时没有匹配到持仓，跳过成本计算`
      );
      continue;
    }
    if (sellResult.matchedQuantity < quantity) {
      console.warn(
        `[calculateRealizedPnl] 卖出 ${tx.assetCode} 仅匹配到 ${sellResult.matchedQuantity}/${quantity} 股`
      );
    }

    const rate = resolveTransactionExchangeRate(tx);
    const revenueQuantity = sellResult.matchedQuantity;
    const grossRevenue = revenueQuantity * price * rate;
    const commissionCny = getCommissionInCny(tx);
    const effectiveCommission =
      quantity > 0
        ? (commissionCny * revenueQuantity) / quantity
        : commissionCny;
    const netRevenue = grossRevenue - effectiveCommission;
    const costRemoved = sellResult.costRemovedCny;
    const realizedFromSell = netRevenue - costRemoved;

    tradingPnl += realizedFromSell;
  }

  const totalRealizedPnl = tradingPnl + totalDividendIncome;

  console.log(
    `[calculateRealizedPnl] 交易盈亏: ${tradingPnl.toFixed(
      2
    )} CNY, 股息收入: ${totalDividendIncome.toFixed(
      2
    )} CNY, 总已实现盈亏: ${totalRealizedPnl.toFixed(2)} CNY`
  );

  cacheService.set(cacheKey, totalRealizedPnl, 0); // TTL=0 表示永久缓存
  console.log(`[calculateRealizedPnl] 缓存计算结果: ${cacheKey}`);

  return totalRealizedPnl;
}

/**
 * 计算未实现盈亏（基于当前持仓）
 * 未实现盈亏 = 当前持仓市值 - 当前持仓成本
 *
 * @param positions 当前持仓数组（已包含市值和成本信息）
 * @returns 未实现盈亏 (CNY)
 */
export function calculateUnrealizedPnl(positions: Position[]): number {
  return positions.reduce((sum, pos) => {
    const marketValue = pos.marketValueCNY ?? pos.marketValue ?? 0;
    const cost = pos.totalCost || 0;
    return sum + (marketValue - cost);
  }, 0);
}

/**
 * 计算总盈亏（与雪球/CSV一致的算法）
 * 总盈亏 = 已实现盈亏 + 浮动盈亏
 *
 * @description
 * 使用与雪球一致的计算方式：
 * - 浮动盈亏 = (现价 - 成本价) × 持仓数量（使用 position.floatingPnl）
 * - 累计盈亏 = 已实现盈亏 + 浮动盈亏
 *
 * 注意：这里的"浮动盈亏"与"未实现盈亏"含义相同，都是指当前持仓的账面盈亏
 *
 * @param portfolio 投资组合对象
 * @param positions 当前持仓数组（必须已经通过 calculateRealtimePnl 计算了 floatingPnl）
 * @returns { realizedPnl, unrealizedPnl, totalPnl }
 */
export async function calculateTotalPnlV2(
  portfolio: Portfolio,
  positions: Position[]
): Promise<{
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}> {
  const realizedPnl = await calculateRealizedPnl(portfolio);

  // 浮动盈亏（与雪球一致）= 各持仓的 (现价 - 成本价) × 数量 之和
  // 直接使用 realtime-pnl.ts 中已计算好的 floatingPnl，保证与 CSV 算法一致
  const unrealizedPnl = positions.reduce((sum, pos) => {
    // 优先使用已计算的 floatingPnl，这是 (现价 - 成本价) × 数量
    if (typeof pos.floatingPnl === 'number') {
      return sum + pos.floatingPnl;
    }
    // fallback: 如果 floatingPnl 未计算，使用 costPrice 手动计算
    const currentPrice = pos.currentPrice ?? 0;
    const costPrice = pos.costPrice ?? 0;
    const quantity = pos.quantity ?? 0;
    return sum + (currentPrice - costPrice) * quantity;
  }, 0);

  const totalPnl = realizedPnl + unrealizedPnl;

  console.log(`[calculateTotalPnlV2] 已实现盈亏: ${realizedPnl.toFixed(2)}`);
  console.log(`[calculateTotalPnlV2] 浮动盈亏(未实现): ${unrealizedPnl.toFixed(2)}`);
  console.log(`[calculateTotalPnlV2] 累计盈亏: ${totalPnl.toFixed(2)}`);

  return {
    realizedPnl,
    unrealizedPnl,
    totalPnl,
  };
}
