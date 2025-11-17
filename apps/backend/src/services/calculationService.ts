import {
  Position,
  Portfolio,
  Transaction,
  TransactionType,
  KlinePoint,
  Quote,
} from '../types'; // Adjust path if needed
import { fetchKline } from './tencentApi'; // Assuming fetchKline is here
import { cacheService } from '@uht/infra/cache/cache-service'; // 缓存服务
import {
  getUnixTime,
  startOfDay,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  formatISO,
  parseISO,
  getDay,
  eachDayOfInterval,
  format,
} from 'date-fns'; // Using date-fns for date manipulation, added parseISO back
import { getExchangeRateForAssetToCNY } from './currencyService';
import {
  LotTracker,
  LotPositionState,
  getCommissionInCny,
  getCurrencyForAsset,
  resolveTransactionExchangeRate,
  getBuyCashRequirementInCny,
  getSellCashProceedsInCny,
} from './portfolioReplay';

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calculates real-time profit and loss for each position based on current quotes.
 * Updates the position objects in place (or returns new objects).
 *
 * @description
 * 注意：position.totalCost 可能为负数，这通常意味着该股票的累计卖出收入已超过买入成本。
 * 在这种情况下：
 * - totalPnl 仍然是有效的（当前市值减去历史买卖差额）
 * - totalPnlPercent 在数学上仍然有效，但其业务含义需要特别解读
 *
 * @param positions - Array of current positions.
 * @param quotes - A map of stock codes to their latest quotes.
 * @returns The updated array of positions with PnL calculations.
 */
export function calculateRealtimePnl(
  positions: Position[],
  quotes: Record<string, Quote>
): Position[] {
  return positions.map((position) => {
    const quote = quotes[position.asset.code];
    const currency =
      position.currency || getCurrencyForAsset(position.asset.code);
    const updatedPosition: Position = {
      ...position,
      currency,
    }; // Create a copy to avoid modifying the original object directly

    if (quote && quote.currentPrice != null) {
      updatedPosition.currentPrice = quote.currentPrice;
      // Update asset name from the quote if available
      if (quote.name) {
        updatedPosition.asset = { ...updatedPosition.asset, name: quote.name };
      }

      const exchangeRate = getExchangeRateForAssetToCNY(position.asset.code);
      const marketValueLocal = quote.currentPrice * position.quantity;
      const marketValueCny = marketValueLocal * exchangeRate;

      updatedPosition.marketValueLocal = marketValueLocal;
      updatedPosition.marketValue = marketValueCny;
      updatedPosition.marketValueCNY = marketValueCny;

      updatedPosition.totalPnl = marketValueCny - (position.totalCost || 0);
      if (typeof position.totalCostLocal === 'number') {
        updatedPosition.totalPnlLocal =
          marketValueLocal - position.totalCostLocal;
      }

      // 计算盈亏百分比（注意：当 totalCost 为负时，结果在数学上仍然有效，但可能需要特殊解读）
      updatedPosition.totalPnlPercent =
        position.totalCost !== 0
          ? (updatedPosition.totalPnl / position.totalCost) * 100
          : 0;

      // Calculate daily PnL based on changeAmount if available
      if (quote.changeAmount != null) {
        const dailyChangeLocal = quote.changeAmount * position.quantity;
        updatedPosition.dailyChangeLocal = dailyChangeLocal;
        updatedPosition.dailyChange = dailyChangeLocal * exchangeRate;
      } else {
        updatedPosition.dailyChange = undefined;
        updatedPosition.dailyChangeLocal = undefined;
      }
      updatedPosition.dailyChangePercent = quote.changePercent ?? undefined;
      updatedPosition.weeklyChangePercent =
        quote.weekChangePercent ?? undefined;
      updatedPosition.monthlyChangePercent =
        quote.monthChangePercent ?? undefined;
      updatedPosition.yearlyChangePercent =
        quote.yearChangePercent ?? undefined;
    } else {
      // Handle cases where quote is missing or doesn't have price
      console.warn(
        `Quote not found or invalid for ${position.asset.code}, cannot calculate real-time PnL.`
      );
      updatedPosition.currentPrice = undefined; // Or position.costPrice? or null?
      updatedPosition.marketValue = 0; // Or based on cost?
      updatedPosition.marketValueCNY = 0;
      updatedPosition.marketValueLocal = 0;
      updatedPosition.totalPnl = undefined;
      updatedPosition.totalPnlPercent = undefined;
      updatedPosition.dailyChange = undefined;
      updatedPosition.dailyChangeLocal = undefined;
      updatedPosition.dailyChangePercent = undefined;
    }
    return updatedPosition;
  });
}
/**
 * Calculates portfolio statistics for a given period, focusing on return percentage.
 * NOTE: This implementation is basic and uses placeholders for valuation.
 * TODO: Implement accurate start/end value calculation using historical positions and prices.
 * TODO: Consider implementing Modified Dietz or TWRR for more accurate return calculation.
 *
 * @param portfolio The portfolio object containing all transactions.
 * @param period The calculation period ('daily', 'weekly', 'monthly', 'yearly', 'total').
 * @returns An object containing the period return percentage, or null if calculation fails.
 */
export async function calculatePeriodStats(
  portfolio: Portfolio,
  period: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'total' = 'total'
): Promise<{ periodReturnPercent: number | null; periodPnl: number | null }> {
  try {
    const transactions = portfolio.transactions || [];
    if (transactions.length === 0 && period !== 'total') {
      // No transactions, return 0% for specific periods, null for total unless there's initial cash?
      // Let's return 0 for simplicity for now if no transactions in the period.
      return { periodReturnPercent: 0, periodPnl: 0 };
    }

    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    type RateSample = { timestamp: number; rate: number };
    const rateHistory: Record<string, RateSample[]> = {};
    sortedTransactions.forEach((tx) => {
      if (!tx.assetCode) return;
      const rate = resolveTransactionExchangeRate(tx);
      const timestamp = new Date(tx.date).getTime();
      if (!rateHistory[tx.assetCode]) {
        rateHistory[tx.assetCode] = [];
      }
      rateHistory[tx.assetCode].push({ timestamp, rate });
    });

    // 1. Determine Start and End Dates (using date-fns)
    const endDate = startOfDay(new Date()); // Use start of today for consistency
    let startDate: Date;

    if (period === 'total') {
      if (transactions.length === 0)
        return { periodReturnPercent: 0, periodPnl: 0 }; // Or null? If no transactions ever.
      // Find the earliest transaction date
      startDate = sortedTransactions.reduce((earliest, current) => {
        const currentTs = new Date(current.date);
        return currentTs < earliest ? currentTs : earliest;
      }, new Date(sortedTransactions[0].date));
      startDate = startOfDay(startDate);
    } else {
      switch (period) {
        case 'daily':
          startDate = startOfDay(subDays(endDate, 1));
          break;
        case 'weekly':
          startDate = startOfDay(subWeeks(endDate, 1));
          break;
        case 'monthly':
          startDate = startOfDay(subMonths(endDate, 1));
          break;
        case 'yearly':
          startDate = startOfDay(subYears(endDate, 1));
          break;
        default: // Should not happen with TS types, but good practice
          console.error(`Invalid period specified: ${period}`);
          return { periodReturnPercent: null, periodPnl: null };
      }
    }

    const startTimestamp = getUnixTime(startDate);
    // Use start of the day *after* the period ends for exclusive filtering
    const exclusiveEndDate = startOfDay(subDays(endDate, -1));
    const exclusiveEndTimestamp = getUnixTime(exclusiveEndDate);

    // 2. Filter Transactions and Calculate Cash Flows within the period
    // Cash flow = Deposits - Withdrawals
    // Transactions *on* startDate are considered part of the period's cash flow.
    // Transactions *before* exclusiveEndDate are included.
    let cashFlows = 0;
    const periodTransactions = sortedTransactions.filter((tx) => {
      const txTimestamp = getUnixTime(new Date(tx.date));
      // Include transactions from the start of startDate up to (but not including) the start of the day AFTER endDate
      return (
        txTimestamp >= startTimestamp && txTimestamp < exclusiveEndTimestamp
      );
    });

    periodTransactions.forEach((tx) => {
      if (tx.type === TransactionType.DEPOSIT) {
        cashFlows += Number(tx.amount || 0);
      } else if (tx.type === TransactionType.WITHDRAW) {
        cashFlows -= Number(tx.amount || 0); // Amount is positive, so subtract
      }
      // BUY/SELL affect cash balance but are part of investment value changes, not external cash flow here.
    });

    function reconstructPortfolioState(atDate: Date) {
      const tracker = new LotTracker();
      let cash = portfolio.initialCash || 0;
      const targetTimestamp = getUnixTime(atDate);
      for (const tx of sortedTransactions) {
        const txTimestamp = getUnixTime(new Date(tx.date));
        if (txTimestamp > targetTimestamp) break;
        switch (tx.type) {
          case TransactionType.DEPOSIT:
            cash += Number(tx.amount || 0);
            break;
          case TransactionType.WITHDRAW:
            cash -= Number(tx.amount || 0);
            break;
          case TransactionType.DIVIDEND:
            cash += Number(tx.amount || 0);
            break;
          case TransactionType.LEVERAGE_COST:
            cash -= Number(tx.amount || 0);
            break;
          case TransactionType.BUY:
            tracker.applyBuy(tx);
            cash -= getBuyCashRequirementInCny(tx);
            break;
          case TransactionType.SELL:
            tracker.applySell(tx);
            cash += getSellCashProceedsInCny(tx);
            break;
          default:
            break;
        }
      }
      return { positions: tracker.getPositionsSnapshot(), cash };
    }

    // --- 2. 获取所有相关股票的K线 ---
    // 需要期初用 startDate 前一天的收盘价，期末用 endDate 当天的收盘价
    const startKlineDate = formatDate(subDays(startDate, 1));
    const endKlineDate = formatDate(endDate);

    // 收集期间涉及的股票代码
    const allAssetCodes = Array.from(
      new Set(
        sortedTransactions
          .filter((tx) => tx.assetCode)
          .map((tx) => tx.assetCode!)
      )
    );

    // 获取K线数据
    const klineMap: Record<string, KlinePoint[]> = {};
    for (const code of allAssetCodes) {
      // 获取期初和期末所需的K线
      klineMap[code] = await fetchKline(
        code,
        'daily',
        startKlineDate,
        endKlineDate,
        'qfq'
      );
    }

    // 检查是否有股票K线数据缺失
    const hasMissingKlineData = allAssetCodes.some(
      (code) => !klineMap[code] || klineMap[code].length === 0
    );

    if (hasMissingKlineData) {
      console.warn(
        `[calculatePeriodStats] Missing K-line data for some assets in period ${period}`
      );
      return { periodReturnPercent: null, periodPnl: null };
    }

    // --- 3. 计算期初/期末市值 ---
    function getHistoricalRate(code: string, timestamp: number): number {
      const history = rateHistory[code];
      if (!history || history.length === 0) {
        return getExchangeRateForAssetToCNY(code);
      }
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].timestamp <= timestamp) {
          return history[i].rate;
        }
      }
      return history[0].rate;
    }

    function findPricePoint(
      code: string,
      priceDate: string
    ): KlinePoint | undefined {
      const klineArr = klineMap[code];
      if (!klineArr || klineArr.length === 0) return undefined;
      const exact = klineArr.find((k) => k.date === priceDate);
      if (exact) return exact;
      const fallback = [...klineArr]
        .filter((k) => k.date < priceDate)
        .sort((a, b) => b.date.localeCompare(a.date));
      return fallback.length > 0 ? fallback[0] : undefined;
    }

    async function calcValue(
      state: { positions: Map<string, LotPositionState>; cash: number },
      priceDate: string
    ) {
      let value = state.cash;
      for (const [code, posState] of state.positions.entries()) {
        if (posState.quantity <= 0) continue;
        const pricePoint = findPricePoint(code, priceDate);
        if (!pricePoint || pricePoint.close == null) continue;
        const priceTimestamp = new Date(
          `${pricePoint.date}T23:59:59Z`
        ).getTime();
        const rate = getHistoricalRate(code, priceTimestamp);
        value += posState.quantity * pricePoint.close * rate;
      }
      return value;
    }

    // 重建期初和期末状态
    const startState = reconstructPortfolioState(subDays(startDate, 1));
    const endState = reconstructPortfolioState(endDate);

    // 计算期初和期末估值
    const startValue = await calcValue(startState, startKlineDate);
    const endValue = await calcValue(endState, endKlineDate);

    // --- 4. 计算期间收益率（简化 Modified Dietz 法）---
    // periodReturnPercent = (endValue - startValue - cashFlows) / (startValue + cashFlows * 0.5) * 100
    let periodReturnPercent: number | null = null;
    let periodPnl: number | null = null;
    if (startValue !== 0) {
      periodReturnPercent =
        ((endValue - startValue - cashFlows) / (startValue + cashFlows * 0.5)) *
        100;
      periodPnl = endValue - startValue - cashFlows;
    } else if (endValue === 0 && cashFlows === 0 && startValue === 0) {
      periodReturnPercent = 0;
      periodPnl = 0;
    } else {
      periodReturnPercent = null;
      periodPnl = null;
    }

    return { periodReturnPercent, periodPnl };
  } catch (error) {
    console.error(
      `Error calculating period stats for period "${period}":`,
      error
    );
    return { periodReturnPercent: null, periodPnl: null };
  }
}

// --- Helper function placeholder ---
// async function getPortfolioValueAtDate(portfolio: Portfolio, date: Date): Promise<number> {
//   // 1. Reconstruct positions at 'date' by processing transactions up to 'date'
//   // 2. Get unique asset codes from positions
//   // 3. Fetch K-line data for these assets for the specific 'date' using fetchKline
//   // 4. Calculate market value of positions using historical prices
//   // 5. Calculate cash balance at 'date'
//   // 6. Return total value (market value + cash)
//   return 0; // Placeholder
// }

// --- Placeholder for other calculation functions ---

// Removed duplicate imports as they are already imported at the top of the file

/**
 * 获取指定日期的上周五日期
 * @param date 参考日期
 * @returns 上周五的日期
 */
function getLastFriday(date: Date): Date {
  const dayOfWeek = getDay(date); // 0-6 代表周日到周六
  let daysToSubtract: number;

  if (dayOfWeek === 5) {
    // 如果今天是周五
    daysToSubtract = 7; // 上周五
  } else if (dayOfWeek < 5) {
    // 周日到周四
    daysToSubtract = 2 + dayOfWeek; // 上周五
  } else {
    // 周六
    daysToSubtract = 1; // 昨天是周五
  }

  return subDays(date, daysToSubtract);
}

/**
 * Finds the closest K-line point on or before a target date.
 * @param klineData Array of K-line points.
 * @param targetDate The target date string (YYYY-MM-DD).
 * @returns The closest KlinePoint or null if none found.
 */
function findClosestKlinePoint(
  klineData: KlinePoint[],
  targetDate: string
): KlinePoint | null {
  if (!klineData || klineData.length === 0) return null;
  const targetDateTime = parseISO(targetDate).getTime();
  let closestPoint: KlinePoint | null = null;
  let closestDiff = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < klineData.length; i++) {
    const point = klineData[i];
    const pointDateStr = point.date;
    const pointDate = parseISO(pointDateStr);
    const pointDateTime = pointDate.getTime();
    // 调试日志：打印每个K线点与目标日期的对比
    console.log(
      `[DEBUG] K线点: ${pointDateStr}, 目标: ${targetDate}, 解析: ${pointDateTime}, 目标: ${targetDateTime}, 差值: ${targetDateTime - pointDateTime}`
    );
    if (pointDateTime <= targetDateTime) {
      const diff = targetDateTime - pointDateTime;
      if (diff < closestDiff) {
        closestDiff = diff;
        closestPoint = point;
      }
    }
  }
  // 额外日志：最终选中的K线点
  if (closestPoint) {
    console.log(`[DEBUG] 最终选中的K线点: ${closestPoint.date}`);
  } else {
    console.log('[DEBUG] 未找到合适的K线点');
  }
  return closestPoint;
}

/**
 * 计算指数年初至今涨幅（YTD），基于日K线推算基准日。
 * @param indexCode 指数代码
 * @param klineData 日K线数据，需包含年初基准日
 * @param currentQuote 当前实时报价
 * @returns 包含 yearChangePercent 字段
 */
export function calculateIndexPeriodChanges(
  indexCode: string,
  klineData: KlinePoint[],
  currentQuote: Quote | null
): { yearChangePercent?: number } {
  const results: { yearChangePercent?: number } = {};

  // 输入验证
  if (
    !klineData ||
    klineData.length === 0 ||
    !currentQuote ||
    currentQuote.currentPrice == null
  ) {
    console.warn(
      `[calculateIndexPeriodChanges] Insufficient data for ${indexCode}. Kline length: ${klineData?.length}, Current Price: ${currentQuote?.currentPrice}`
    );
    return results;
  }

  const effectiveCurrentPrice = currentQuote.currentPrice;
  if (effectiveCurrentPrice == null) {
    console.warn(
      `[calculateIndexPeriodChanges] Current price from quote is null for ${indexCode}.`
    );
    return results;
  }

  const today = new Date();

  // --- Yearly Change (Year-to-Date) ---
  const thisYear = today.getFullYear();
  const firstDayOfThisYear = new Date(thisYear, 0, 1)
    .toISOString()
    .slice(0, 10); // YYYY-01-01
  const yearChangeBasePoint = findClosestKlinePoint(
    klineData,
    firstDayOfThisYear
  );

  if (
    yearChangeBasePoint &&
    yearChangeBasePoint.close != null &&
    yearChangeBasePoint.close !== 0
  ) {
    const change =
      ((effectiveCurrentPrice - yearChangeBasePoint.close) /
        yearChangeBasePoint.close) *
      100;
    results.yearChangePercent = parseFloat(change.toFixed(2));
    (results as any).yearChangeBaseDate = yearChangeBasePoint.date;
  } else {
    results.yearChangePercent = undefined;
    (results as any).yearChangeBaseDate = undefined;
  }

  return results;
}

/**
 * 计算净入金（netDepositedCash）：仅由初始现金、所有入金（DEPOSIT）、所有出金（WITHDRAW）决定，反映账户历史实际净投入现金总额。买卖股票、分红、费用等不影响此数值。
 * @param portfolio 投资组合对象，需包含初始现金和所有交易记录
 * @returns 净入金 netDepositedCash
 */
export function calculateNetDepositedCash(portfolio: Portfolio): number {
  // 兼容历史数据：无initialCash字段时默认为0
  const initialCash =
    typeof portfolio.initialCash === 'number' ? portfolio.initialCash : 0;
  // 计算所有DEPOSIT和WITHDRAW
  const totalDeposit = portfolio.transactions
    .filter((tx) => tx.type === TransactionType.DEPOSIT)
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const totalWithdraw = portfolio.transactions
    .filter((tx) => tx.type === TransactionType.WITHDRAW)
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  // 净入金 = 初始现金 + 所有入金 - 所有出金
  return initialCash + totalDeposit - totalWithdraw;
}

/**
 * 统计所有买卖交易手续费（折算为CNY）总和
 * @param portfolio 投资组合对象
 * @returns Promise<number> 手续费总和（CNY）
 */
export async function calculateTotalCommission(
  portfolio: Portfolio
): Promise<number> {
  console.log(
    `[calculateTotalCommission] 开始计算手续费，组合ID: ${portfolio.id}, 交易数量: ${portfolio.transactions?.length || 0}`
  );

  if (!portfolio.transactions || portfolio.transactions.length === 0) {
    console.log(`[calculateTotalCommission] 无交易记录，返回0`);
    return 0;
  }

  let total = 0;
  for (const tx of portfolio.transactions) {
    if (tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) {
      const commissionCny = getCommissionInCny(tx);
      console.log(
        `[calculateTotalCommission] 交易ID: ${tx.id}, 类型: ${tx.type}, 手续费(折算CNY): ${commissionCny.toFixed(
          2
        )}`
      );
      total += commissionCny;
    }
  }

  console.log(`[calculateTotalCommission] 最终计算结果: ${total}`);
  return total;
}

/**
 * 逐日余额法：统计区间内实际融资利息（券商级）
 * @param portfolio 投资组合对象
 * @param startDate 区间起始日期（Date对象）
 * @param endDate 区间结束日期（Date对象，含当日）
 * @returns 区间累计融资利息
 */
export function calculateLeverageCostByDay(
  portfolio: Portfolio,
  startDate: Date,
  endDate: Date
): number {
  if (!portfolio.leverage) return 0;
  const costRate = portfolio.leverage.costRate || 0;
  const txs = [...portfolio.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  // 1. 构建每日融资余额表
  const dailyBalance: Record<string, number> = {};
  let currentBalance = 0;
  let txIndex = 0;
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  for (const day of days) {
    const dayStr = format(day, 'yyyy-MM-dd');
    // 处理当天所有交易
    while (txIndex < txs.length && txs[txIndex].date.slice(0, 10) === dayStr) {
      const tx = txs[txIndex];
      // 只考虑影响融资余额的交易类型
      if (tx.type === 'BUY' && tx.leverageUsed) {
        currentBalance += Number(tx.leverageUsed);
      } else if (tx.type === 'SELL') {
        // 卖出优先还融资，假设归还额度为min(卖出净额, 当前融资余额)
        // 这里简化为每次卖出都优先归还融资
        const repay = Math.min(Number(tx.amount || 0), currentBalance);
        currentBalance -= repay;
      } else if (tx.type === 'LEVERAGE_ADD') {
        // 追加融资额度不影响已用余额
      } else if (tx.type === 'LEVERAGE_REMOVE') {
        // 减少授信额度不影响已用余额
      } else if (tx.type === 'LEVERAGE_COST') {
        // 支付利息不影响已用余额
      }
      txIndex++;
    }
    dailyBalance[dayStr] = currentBalance;
  }
  // 2. 按天计息累计
  let totalInterest = 0;
  for (const day of days) {
    const dayStr = format(day, 'yyyy-MM-dd');
    totalInterest += (dailyBalance[dayStr] * costRate) / 365;
  }
  return Number(totalInterest.toFixed(2));
}

/**
 * 计算投资组合的总股息收入。
 * 假设交易记录中的 amount 已经是投资组合基础货币 (CNY)。
 * @param portfolio 投资组合对象
 * @returns 总股息收入 (CNY)
 */
export function calculateTotalDividendIncome(portfolio: Portfolio): number {
  if (!portfolio.transactions || portfolio.transactions.length === 0) {
    return 0;
  }
  return portfolio.transactions
    .filter(
      (tx) =>
        tx.type === TransactionType.DIVIDEND &&
        tx.amount !== null &&
        tx.amount !== undefined
    )
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
}

/**
 * 获取指定日期的基准价，如果当日无数据则向前回溯
 * @param code 股票代码
 * @param anchorDate 锚点日期
 * @param maxLookbackDays 最大回溯天数
 * @param cacheTTL 缓存过期时间（秒），默认1小时
 * @returns 返回基准价或null
 */
export async function getBasePrice(
  code: string,
  anchorDate: Date,
  maxLookbackDays: number,
  cacheTTL: number = 3600
): Promise<{ price: number | null; date: string | null }> {
  try {
    // 格式化日期为 YYYY-MM-DD
    const endDateStr = formatDate(anchorDate);
    const startDateStr = formatDate(subDays(anchorDate, maxLookbackDays));

    // 构建缓存键
    const cacheKey = `base-price:${code}:${endDateStr}:${maxLookbackDays}`;

    // 尝试从缓存获取
    const cached = cacheService.get<{
      price: number | null;
      date: string | null;
    }>(cacheKey);
    if (cached) {
      console.log(
        `[getBasePrice] 缓存命中 ${cacheKey} - 价格: ${cached.price}, 日期: ${cached.date}`
      );
      return cached;
    }

    console.log(`[getBasePrice] 缓存未命中 ${cacheKey}，开始获取K线数据...`);

    // 获取历史K线数据
    const klineData = await fetchKline(
      code,
      'daily',
      startDateStr,
      endDateStr,
      'qfq'
    );

    if (!klineData || klineData.length === 0) {
      console.warn(
        `[getBasePrice] ${code} 在 ${startDateStr} 至 ${endDateStr} 期间无K线数据`
      );
      return { price: null, date: null };
    }

    // 按日期降序排序（从近到远）
    const sortedKline = [...klineData].sort((a, b) =>
      b.date.localeCompare(a.date)
    );

    // 从锚点日期开始向前查找第一个有效的收盘价
    for (const point of sortedKline) {
      if (point.close && !isNaN(point.close)) {
        const result = {
          price: point.close,
          date: point.date,
        };

        // 计算实际回溯天数
        const actualDate = new Date(point.date);
        const daysDiff = Math.floor(
          (anchorDate.getTime() - actualDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff > 0) {
          console.log(
            `[getBasePrice] ${code} 目标日期 ${endDateStr} 无数据，使用 ${point.date} 的价格 ${point.close}（回溯 ${daysDiff} 天）`
          );
        } else {
          console.log(
            `[getBasePrice] ${code} 成功获取基准价格: ${point.close} (日期: ${point.date})`
          );
        }

        // 缓存结果
        cacheService.set(cacheKey, result, cacheTTL);

        return result;
      }
    }

    console.warn(
      `[getBasePrice] ${code} 在 ${maxLookbackDays} 天回溯窗口内无有效收盘价`
    );
    return { price: null, date: null };
  } catch (error) {
    console.error(`[getBasePrice] ${code} 获取基准价格失败:`, error);
    return { price: null, date: null };
  }
}

/**
 * 获取年线基准价（今年1月1日，向前回溯最多60天）
 * 缓存24小时
 */
export async function getYearBasePrice(
  code: string
): Promise<{ price: number | null; date: string | null }> {
  const today = new Date();
  const thisYear = today.getFullYear();
  const anchorDate = new Date(thisYear, 0, 1); // 1月1日
  const result = await getBasePrice(code, anchorDate, 60, 86400); // 60天回溯，24小时缓存

  if (result.price) {
    console.log(
      `[getYearBasePrice] ${code} 年线基准价: ${result.price} (日期: ${result.date})`
    );
  } else {
    console.warn(`[getYearBasePrice] ${code} 无法获取年线基准价`);
  }

  return result;
}

/**
 * 获取月线基准价（本月1日，向前回溯最多20天）
 * 缓存6小时
 */
export async function getMonthBasePrice(
  code: string
): Promise<{ price: number | null; date: string | null }> {
  const today = new Date();
  const thisMonth = today.getMonth();
  const anchorDate = new Date(today.getFullYear(), thisMonth, 1); // 本月1日
  const result = await getBasePrice(code, anchorDate, 20, 21600); // 20天回溯，6小时缓存

  if (result.price) {
    console.log(
      `[getMonthBasePrice] ${code} 月线基准价: ${result.price} (日期: ${result.date})`
    );
  } else {
    console.warn(`[getMonthBasePrice] ${code} 无法获取月线基准价`);
  }

  return result;
}

/**
 * 获取周线基准价（上周最后一个交易日，通常为上周五，向前回溯最多15天）
 * 缓存1小时
 */
export async function getWeekBasePrice(
  code: string,
  today: Date = new Date()
): Promise<{ price: number | null; date: string | null }> {
  const dayOfWeek = today.getDay(); // 0=周日, 1=周一, ..., 6=周六

  // 将周日视为一周的最后一天，使得"上周五"始终指向完整自然周的最后交易日
  const daysSinceMonday = (dayOfWeek + 6) % 7; // 周一=0，周日=6
  const daysToLastFriday = daysSinceMonday + 3; // 回溯到上周五（含周末自动跨周）

  const lastWeekFriday = new Date(today);
  lastWeekFriday.setDate(today.getDate() - daysToLastFriday);

  console.log(
    `[getWeekBasePrice] ${code} 目标日期: ${formatDate(lastWeekFriday)} (上周五)`
  );

  const result = await getBasePrice(code, lastWeekFriday, 15, 3600); // 15天回溯，1小时缓存

  if (result.price) {
    console.log(
      `[getWeekBasePrice] ${code} 周线基准价: ${result.price} (日期: ${result.date})`
    );
  } else {
    console.warn(`[getWeekBasePrice] ${code} 无法获取周线基准价`);
  }

  return result;
}

/**
 * 生成交易记录的哈希值（用于缓存键）
 * 简化版本：基于交易数量和最后一笔交易ID
 */
function hashTransactions(transactions: Transaction[]): string {
  if (transactions.length === 0) return '0';
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const lastTx = sortedTxs[sortedTxs.length - 1];
  return `${transactions.length}-${lastTx.id}`;
}

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
 * 计算总盈亏（新方法：已实现 + 未实现）
 * 总盈亏 = 已实现盈亏 + 未实现盈亏
 *
 * @param portfolio 投资组合对象
 * @param positions 当前持仓数组（已包含市值和成本信息）
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
  const unrealizedPnl = calculateUnrealizedPnl(positions);
  const totalPnl = realizedPnl + unrealizedPnl;

  console.log(`[calculateTotalPnlV2] 已实现盈亏: ${realizedPnl.toFixed(2)}`);
  console.log(`[calculateTotalPnlV2] 未实现盈亏: ${unrealizedPnl.toFixed(2)}`);
  console.log(`[calculateTotalPnlV2] 总盈亏: ${totalPnl.toFixed(2)}`);

  return {
    realizedPnl,
    unrealizedPnl,
    totalPnl,
  };
}
