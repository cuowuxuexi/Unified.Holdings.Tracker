import { Position, Portfolio, Transaction, TransactionType, KlinePoint, Quote } from '../types'; // Adjust path if needed
import { fetchKline } from './tencentApi'; // Assuming fetchKline is here
import { getUnixTime, startOfDay, subDays, subWeeks, subMonths, subYears, formatISO, parseISO, getDay, eachDayOfInterval, format } from 'date-fns'; // Using date-fns for date manipulation, added parseISO back
import { getExchangeRateForAssetToCNY } from './currencyService';

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
    const updatedPosition = { ...position }; // Create a copy to avoid modifying the original object directly

    if (quote && quote.currentPrice != null) {
      updatedPosition.currentPrice = quote.currentPrice;
      // Update asset name from the quote if available
      if (quote.name) {
        updatedPosition.asset = { ...updatedPosition.asset, name: quote.name };
      }

      updatedPosition.marketValue = quote.currentPrice * position.quantity;
      updatedPosition.totalPnl = updatedPosition.marketValue - position.totalCost;
      
      // 计算盈亏百分比（注意：当 totalCost 为负时，结果在数学上仍然有效，但可能需要特殊解读）
      updatedPosition.totalPnlPercent =
        position.totalCost !== 0 ? (updatedPosition.totalPnl / position.totalCost) * 100 : 0;

      // Calculate daily PnL based on changeAmount if available
      if (quote.changeAmount != null) {
        updatedPosition.dailyChange = quote.changeAmount * position.quantity;
      } else {
        updatedPosition.dailyChange = undefined;
      }
      updatedPosition.dailyChangePercent = quote.changePercent ?? undefined;
      updatedPosition.yearlyChangePercent = quote.yearChangePercent ?? undefined;

    } else {
      // Handle cases where quote is missing or doesn't have price
      console.warn(`Quote not found or invalid for ${position.asset.code}, cannot calculate real-time PnL.`);
      updatedPosition.currentPrice = undefined; // Or position.costPrice? or null?
      updatedPosition.marketValue = 0; // Or based on cost?
      updatedPosition.totalPnl = undefined;
      updatedPosition.totalPnlPercent = undefined;
      updatedPosition.dailyChange = undefined;
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

    // 1. Determine Start and End Dates (using date-fns)
    const endDate = startOfDay(new Date()); // Use start of today for consistency
    let startDate: Date;

    if (period === 'total') {
      if (transactions.length === 0) return { periodReturnPercent: 0, periodPnl: 0 }; // Or null? If no transactions ever.
      // Find the earliest transaction date
      startDate = transactions.reduce((earliest, current) => {
        const currentTs = new Date(current.date);
        return currentTs < earliest ? currentTs : earliest;
      }, new Date(transactions[0].date));
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
    const periodTransactions = transactions.filter(tx => {
        const txTimestamp = getUnixTime(new Date(tx.date));
        // Include transactions from the start of startDate up to (but not including) the start of the day AFTER endDate
        return txTimestamp >= startTimestamp && txTimestamp < exclusiveEndTimestamp;
    });

    periodTransactions.forEach(tx => {
      if (tx.type === TransactionType.DEPOSIT) {
        cashFlows += tx.amount!;
      } else if (tx.type === TransactionType.WITHDRAW) {
        cashFlows -= tx.amount!; // Amount is positive, so subtract
      }
      // BUY/SELL affect cash balance but are part of investment value changes, not external cash flow here.
    });

// 3. Calculate Start Value and End Value (实现期间收益率核心逻辑)
// --- 1. 重建期初/期末持仓和现金 ---
// 辅助函数：重建某一时点的持仓和现金
async function reconstructPortfolioState(atDate: Date) {
  const positions: Record<string, { quantity: number; cost: number }> = {};
  let cash = portfolio.initialCash || 0;
  for (const tx of transactions) {
    const txTime = getUnixTime(new Date(tx.date));
    if (txTime > getUnixTime(atDate)) continue;
    if (tx.type === TransactionType.DEPOSIT) {
      cash += tx.amount || 0;
    } else if (tx.type === TransactionType.WITHDRAW) {
      cash -= tx.amount || 0;
    } else if (tx.type === TransactionType.BUY) {
      if (!tx.assetCode || !tx.quantity || !tx.price) continue;
      if (!positions[tx.assetCode]) positions[tx.assetCode] = { quantity: 0, cost: 0 };
      positions[tx.assetCode].quantity += tx.quantity;
      positions[tx.assetCode].cost += tx.quantity * tx.price + (tx.commission || 0);
      cash -= tx.quantity * tx.price + (tx.commission || 0);
    } else if (tx.type === TransactionType.SELL) {
      if (!tx.assetCode || !tx.quantity || !tx.price) continue;
      if (!positions[tx.assetCode]) positions[tx.assetCode] = { quantity: 0, cost: 0 };
      positions[tx.assetCode].quantity -= tx.quantity;
      // 简化：卖出时按比例减少成本
      const avgCost = positions[tx.assetCode].quantity + tx.quantity > 0
        ? positions[tx.assetCode].cost / (positions[tx.assetCode].quantity + tx.quantity)
        : 0;
      positions[tx.assetCode].cost -= avgCost * tx.quantity;
      cash += tx.quantity * tx.price - (tx.commission || 0);
    }
  }
  // 移除数量为0的持仓
  Object.keys(positions).forEach(code => {
    if (positions[code].quantity === 0) delete positions[code];
  });
  return { positions, cash };
}

// --- 2. 获取所有相关股票的K线 ---
// 需要期初用 startDate 前一天的收盘价，期末用 endDate 当天的收盘价
const startKlineDate = formatDate(subDays(startDate, 1));
const endKlineDate = formatDate(endDate);

// 收集期间涉及的股票代码
const allAssetCodes = Array.from(
  new Set(
    transactions
      .filter(tx => tx.assetCode)
      .map(tx => tx.assetCode!)
  )
);

// 获取K线数据
const klineMap: Record<string, KlinePoint[]> = {};
for (const code of allAssetCodes) {
  // 获取期初和期末所需的K线
  klineMap[code] = await fetchKline(code, 'daily', startKlineDate, endKlineDate, 'qfq');
}

// --- 3. 计算期初/期末市值 ---
async function calcValue(state: { positions: Record<string, { quantity: number; cost: number }>; cash: number }, priceDate: string) {
  let value = state.cash;
  for (const code of Object.keys(state.positions)) {
    const klineArr = klineMap[code];
    if (!klineArr || klineArr.length === 0) continue;
    // 找到对应日期的收盘价
    const kline = klineArr.find(k => k.date === priceDate);
    if (kline) {
      value += state.positions[code].quantity * kline.close;
    } else {
      // 如果没有该日K线，尝试用最近的前一日
      const sorted = klineArr
        .filter(k => k.date < priceDate)
        .sort((a, b) => b.date.localeCompare(a.date));
      if (sorted.length > 0) {
        value += state.positions[code].quantity * sorted[0].close;
      }
    }
  }
  return value;
}

// 重建期初和期末状态
const startState = await reconstructPortfolioState(subDays(startDate, 1));
const endState = await reconstructPortfolioState(endDate);

// 计算期初和期末估值
const startValue = await calcValue(startState, startKlineDate);
const endValue = await calcValue(endState, endKlineDate);

// --- 4. 计算期间收益率（简化 Modified Dietz 法）---
// periodReturnPercent = (endValue - startValue - cashFlows) / (startValue + cashFlows * 0.5) * 100
let periodReturnPercent: number | null = null;
let periodPnl: number | null = null;
if (startValue !== 0) {
  periodReturnPercent = ((endValue - startValue - cashFlows) / (startValue + cashFlows * 0.5)) * 100;
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
    console.error(`Error calculating period stats for period "${period}":`, error);
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
  
  if (dayOfWeek === 5) { // 如果今天是周五
    daysToSubtract = 7; // 上周五
  } else if (dayOfWeek < 5) { // 周日到周四
    daysToSubtract = 2 + dayOfWeek; // 上周五
  } else { // 周六
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
function findClosestKlinePoint(klineData: KlinePoint[], targetDate: string): KlinePoint | null {
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
    console.log(`[DEBUG] K线点: ${pointDateStr}, 目标: ${targetDate}, 解析: ${pointDateTime}, 目标: ${targetDateTime}, 差值: ${targetDateTime - pointDateTime}`);
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
    if (!klineData || klineData.length === 0 || !currentQuote || currentQuote.currentPrice == null) {
        console.warn(`[calculateIndexPeriodChanges] Insufficient data for ${indexCode}. Kline length: ${klineData?.length}, Current Price: ${currentQuote?.currentPrice}`);
        return results;
    }

    const effectiveCurrentPrice = currentQuote.currentPrice;
    if (effectiveCurrentPrice == null) {
        console.warn(`[calculateIndexPeriodChanges] Current price from quote is null for ${indexCode}.`);
        return results;
    }

    const today = new Date();
    
    // --- Yearly Change (Year-to-Date) ---
    const thisYear = today.getFullYear();
    const firstDayOfThisYear = new Date(thisYear, 0, 1).toISOString().slice(0, 10); // YYYY-01-01
    const yearChangeBasePoint = findClosestKlinePoint(klineData, firstDayOfThisYear);
    
    if (yearChangeBasePoint && yearChangeBasePoint.close != null && yearChangeBasePoint.close !== 0) {
        const change = ((effectiveCurrentPrice - yearChangeBasePoint.close) / yearChangeBasePoint.close) * 100;
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
  const initialCash = typeof portfolio.initialCash === 'number' ? portfolio.initialCash : 0;
  // 计算所有DEPOSIT和WITHDRAW
  const totalDeposit = portfolio.transactions.filter(tx => tx.type === TransactionType.DEPOSIT).reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const totalWithdraw = portfolio.transactions.filter(tx => tx.type === TransactionType.WITHDRAW).reduce((sum, tx) => sum + (tx.amount || 0), 0);
  // 净入金 = 初始现金 + 所有入金 - 所有出金
  return initialCash + totalDeposit - totalWithdraw;
}

/**
 * 统计所有买卖交易手续费（折算为CNY）总和
 * @param portfolio 投资组合对象
 * @returns Promise<number> 手续费总和（CNY）
 */
export async function calculateTotalCommission(portfolio: Portfolio): Promise<number> {
  console.log(`[calculateTotalCommission] 开始计算手续费，组合ID: ${portfolio.id}, 交易数量: ${portfolio.transactions?.length || 0}`);
  
  if (!portfolio.transactions || portfolio.transactions.length === 0) {
    console.log(`[calculateTotalCommission] 无交易记录，返回0`);
    return 0;
  }
  
  let total = 0;
  for (const tx of portfolio.transactions) {
    if (tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) {
      // 仅统计 commission 字段
      const commission = typeof tx.commission === 'number' ? tx.commission : 0;
      console.log(`[calculateTotalCommission] 交易ID: ${tx.id}, 类型: ${tx.type}, 原始手续费: ${commission}, 资产代码: ${tx.assetCode || '无'}`);
      
      if (commission && tx.assetCode) {
        const rate = getExchangeRateForAssetToCNY(tx.assetCode);
        console.log(`[calculateTotalCommission] 使用汇率: ${rate} 折算`);
        total += commission * rate;
      } else {
        total += commission;
      }
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
export function calculateLeverageCostByDay(portfolio: Portfolio, startDate: Date, endDate: Date): number {
  if (!portfolio.leverage) return 0;
  const costRate = portfolio.leverage.costRate || 0;
  const txs = [...portfolio.transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  // 1. 构建每日融资余额表
  let dailyBalance: Record<string, number> = {};
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
        currentBalance += tx.leverageUsed;
      } else if (tx.type === 'SELL') {
        // 卖出优先还融资，假设归还额度为min(卖出净额, 当前融资余额)
        // 这里简化为每次卖出都优先归还融资
        const repay = Math.min((tx.amount || 0), currentBalance);
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
    totalInterest += dailyBalance[dayStr] * costRate / 365;
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
    .filter(tx => tx.type === TransactionType.DIVIDEND && typeof tx.amount === 'number')
    .reduce((sum, tx) => sum + tx.amount!, 0);
}

/**
 * 获取指定日期的基准价，如果当日无数据则向前回溯
 * @param code 股票代码
 * @param anchorDate 锚点日期
 * @param maxLookbackDays 最大回溯天数
 * @returns 返回基准价或null
 */
export async function getBasePrice(
  code: string,
  anchorDate: Date,
  maxLookbackDays: number
): Promise<{ price: number | null; date: string | null }> {
  try {
    // 格式化日期为 YYYY-MM-DD
    const endDateStr = formatDate(anchorDate);
    const startDateStr = formatDate(subDays(anchorDate, maxLookbackDays));

    // 获取历史K线数据
    const klineData = await fetchKline(code, 'daily', startDateStr, endDateStr, 'qfq');
    
    if (!klineData || klineData.length === 0) {
      console.warn(`[getBasePrice] No kline data found for ${code} between ${startDateStr} and ${endDateStr}`);
      return { price: null, date: null };
    }

    // 按日期降序排序（从近到远）
    const sortedKline = [...klineData].sort((a, b) => b.date.localeCompare(a.date));

    // 从锚点日期开始向前查找第一个有效的收盘价
    for (const point of sortedKline) {
      if (point.close && !isNaN(point.close)) {
        return { 
          price: point.close,
          date: point.date
        };
      }
    }

    console.warn(`[getBasePrice] No valid close price found for ${code}`);
    return { price: null, date: null };
  } catch (error) {
    console.error(`[getBasePrice] Error getting base price for ${code}:`, error);
    return { price: null, date: null };
  }
}

/**
 * 获取年线基准价（今年1月1日，向前回溯最多30天）
 */
export async function getYearBasePrice(code: string): Promise<{ price: number | null; date: string | null }> {
  const today = new Date();
  const thisYear = today.getFullYear();
  const anchorDate = new Date(thisYear, 0, 1); // 1月1日
  return getBasePrice(code, anchorDate, 30);
}

/**
 * 获取月线基准价（本月1日，向前回溯最多10天）
 */
export async function getMonthBasePrice(code: string): Promise<{ price: number | null; date: string | null }> {
  const today = new Date();
  const thisMonth = today.getMonth();
  const anchorDate = new Date(today.getFullYear(), thisMonth, 1); // 本月1日
  return getBasePrice(code, anchorDate, 10);
}

/**
 * 获取周线基准价（本周一，向前回溯最多5天）
 */
export async function getWeekBasePrice(code: string): Promise<{ price: number | null; date: string | null }> {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (today.getDay() || 7) + 1); // 获取本周一
  return getBasePrice(code, monday, 5);
}
