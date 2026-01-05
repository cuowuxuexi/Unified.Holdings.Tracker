import {
  Portfolio,
  TransactionType,
  KlinePoint,
  Quote,
} from '../../types';
import { fetchKline } from '../tencentApi';
import {
  getUnixTime,
  startOfDay,
  endOfDay,
  subDays,
  parseISO,
  differenceInCalendarDays,
} from 'date-fns';
import { getExchangeRateForAssetToCNY } from '../currencyService';
import {
  LotTracker,
  LotPositionState,
  resolveTransactionExchangeRate,
  getBuyCashRequirementInCny,
  getSellCashProceedsInCny,
} from '../portfolioReplay';
import {
  formatDate,
  getLastWeekSaturdayDate,
  getFirstDayOfCurrentMonth,
  getFirstDayOfCurrentYear,
  findClosestKlinePoint,
} from './utils';
import {
  PeriodStatsOptions,
  PeriodStatsResult,
  ValueMetadata,
  ValueComputationResult,
  PriceSource,
} from './types';

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
  period: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'total' = 'total',
  options?: PeriodStatsOptions
): Promise<PeriodStatsResult> {
  try {
    const quotesMap = options?.quotes;
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
          // 本周一作为周度起始日（周度收益 = 本周至今的表现）
          // 周一时起始日是今天，期初会使用 prevClosePrice（昨收价）
          startDate = startOfDay(getLastWeekSaturdayDate(endDate));
          console.log(`[calculatePeriodStats] weekly: 起始日=${formatDate(startDate)}（本周一）`);
          break;
        case 'monthly':
          // 本月1日作为月度起始日
          startDate = startOfDay(getFirstDayOfCurrentMonth(endDate));
          break;
        case 'yearly':
          // 今年1月1日作为年度起始日
          startDate = startOfDay(getFirstDayOfCurrentYear(endDate));
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

    // 🔧 改进：记录每笔现金流的时间和金额，用于精确的 Modified Dietz 计算
    interface CashFlowWithTime {
      amount: number;      // 现金流金额（入金为正，出金为负）
      timestamp: number;   // 发生时间戳
      date: string;        // 日期（用于日志）
      type: string;        // 类型（用于日志）
    }

    const cashFlowsWithTime: CashFlowWithTime[] = [];
    const periodTransactions = sortedTransactions.filter((tx) => {
      const txTimestamp = getUnixTime(new Date(tx.date));
      // Include transactions from the start of startDate up to (but not including) the start of the day AFTER endDate
      return (
        txTimestamp >= startTimestamp && txTimestamp < exclusiveEndTimestamp
      );
    });

    periodTransactions.forEach((tx) => {
      const txTimestamp = getUnixTime(new Date(tx.date));
      if (tx.type === TransactionType.DEPOSIT) {
        cashFlowsWithTime.push({
          amount: Number(tx.amount || 0),
          timestamp: txTimestamp,
          date: tx.date,
          type: 'DEPOSIT',
        });
      } else if (tx.type === TransactionType.WITHDRAW) {
        cashFlowsWithTime.push({
          amount: -Number(tx.amount || 0), // 出金为负数
          timestamp: txTimestamp,
          date: tx.date,
          type: 'WITHDRAW',
        });
      }
      // BUY/SELL affect cash balance but are part of investment value changes, not external cash flow here.
    });

    /**
     * 重建指定日期的投资组合状态
     * @param atDate 目标日期
     * @param includeTargetDay 是否包含目标日当天的交易
     *   - true: 用于期末，包含当天交易（截止到当天收盘）
     *   - false: 用于期初，不包含当天交易（截止到前一天收盘）
     */
    function reconstructPortfolioState(atDate: Date, includeTargetDay: boolean = true) {
      const tracker = new LotTracker();
      let cash = portfolio.initialCash || 0;
      let usedLeverage = 0;
      const canUseLeverage = (portfolio.leverage?.totalAmount ?? 0) > 0;

      // 🔧 修复：期初不应包含起始日当天的交易
      // 例如：月度期初（12-01）应该是 11-30 收盘时的状态
      const targetTimestamp = includeTargetDay
        ? getUnixTime(endOfDay(atDate))           // 包含当天：截止到当天 23:59:59
        : getUnixTime(startOfDay(atDate)) - 1;    // 不包含当天：截止到当天 00:00:00 前一秒

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
          case TransactionType.LEVERAGE_ADD:
          case TransactionType.LEVERAGE_REMOVE:
            // 不影响现金与持仓，周期估值这里无需处理
            break;
          case TransactionType.BUY: {
            tracker.applyBuy(tx);
            const buyTotal = getBuyCashRequirementInCny(tx);

            // leverageUsed 在持久化层已统一为 CNY；这里不要再做汇率换算
            const txLeverageUsed = Math.max(0, Number(tx.leverageUsed ?? 0));

            if (txLeverageUsed > 0) {
              // 显式使用融资：现金支付 = 总成本 - 融资部分（手续费已包含在 buyTotal 内）
              cash -= buyTotal - txLeverageUsed;
              usedLeverage += txLeverageUsed;
              break;
            }

            // 未显式标注融资：若现金不足且允许融资，则按差额自动融资（与入库逻辑保持一致）
            if (canUseLeverage && cash + 1e-9 < buyTotal) {
              const shortfall = buyTotal - cash;
              cash = 0;
              usedLeverage += shortfall;
              break;
            }

            // 无融资：全额现金支付（现金不足时允许为负，以兼容历史异常数据）
            cash -= buyTotal;
            break;
          }
          case TransactionType.SELL: {
            tracker.applySell(tx);
            const proceeds = getSellCashProceedsInCny(tx);
            if (usedLeverage > 0) {
              const repay = Math.min(proceeds, usedLeverage);
              usedLeverage -= repay;
              cash += proceeds - repay;
            } else {
              cash += proceeds;
            }
            break;
          }
          default:
            break;
        }
      }

      return { positions: tracker.getPositionsSnapshot(), cash, usedLeverage };
    }

    // --- 2. 获取所有相关股票的K线 ---
    // 需要期初用 startDate 当天的收盘价，期末用 endDate 当天的收盘价
    // 🔧 修复：向前扩展 K 线获取范围，确保能覆盖非交易日（周末、假期）的回退需求
    const KLINE_LOOKBACK_DAYS = 120; // 覆盖长假期或停牌窗口
    const extendedStartDate = subDays(startDate, KLINE_LOOKBACK_DAYS);
    const startKlineDate = formatDate(extendedStartDate);
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
      if (!klineMap[code] || klineMap[code].length === 0) {
        console.warn(
          `[calculatePeriodStats] ${code} 缺少 ${period} 周期的 K 线数据，后续将使用成本价估算`
        );
      }
    }

    // --- 3. 计算期初/期末市值 ---
    // 🔧 修复：统一使用当前汇率，与 totalPnl 计算口径保持一致
    // 原逻辑使用历史交易汇率，导致港股/美股的 periodPnl 与 totalPnl 不一致
    function getHistoricalRate(code: string, _timestamp: number): number {
      // 始终使用当前汇率，保证与 floatingPnl 计算口径一致
      return getExchangeRateForAssetToCNY(code);
    }

    /**
     * 🔧 修复：改进价格点查找逻辑
     * 1. 优先精确匹配
     * 2. 其次向前回退（找 <= priceDate 的最近日期）
     * 3. 最后向后回退（找 > priceDate 的最早日期，用于期初基准日是非交易日的情况）
     */
    function findPricePoint(
      code: string,
      priceDate: string
    ): KlinePoint | undefined {
      const klineArr = klineMap[code];
      if (!klineArr || klineArr.length === 0) return undefined;

      // 1. 精确匹配
      const exact = klineArr.find((k) => k.date === priceDate);
      if (exact) return exact;

      // 2. 向前回退：找 < priceDate 的最近日期
      const backward = [...klineArr]
        .filter((k) => k.date < priceDate)
        .sort((a, b) => b.date.localeCompare(a.date));
      if (backward.length > 0) return backward[0];

      // 3. 向后回退：找 > priceDate 的最早日期（用于非交易日基准）
      const forward = [...klineArr]
        .filter((k) => k.date > priceDate)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (forward.length > 0) {
        console.log(
          `[findPricePoint] ${code} 在 ${priceDate} 无数据，向后回退到 ${forward[0].date}`
        );
        return forward[0];
      }

      return undefined;
    }

    async function calcValue(
      state: {
        positions: Map<string, LotPositionState>;
        cash: number;
        usedLeverage: number;
      },
      priceDate: string,
      mode: 'start' | 'end'
    ): Promise<ValueComputationResult> {
      let value = state.cash;
      const metadata: ValueMetadata = {
        anchorDate: priceDate,
        effectiveDate: priceDate,
        source: 'kline',
        fallbackDays: 0,
      };
      const anchorDate = new Date(`${priceDate}T00:00:00Z`);
      // 🔧 可选：期末使用实时价格 currentPrice（默认关闭，收益计算统一用 K 线）
      const allowRealtimeEnd =
        mode === 'end' && (options?.useRealtimeEndValue ?? false);
      // 🔧 可选：只有当期初日期是今天时，才使用 prevClosePrice
      // 这样：周一的周度用 prevClosePrice（今天开盘前），月度用 K 线（本月1日）
      const todayStr = formatDate(new Date());
      const isStartDateToday = priceDate === todayStr;
      const allowPreCloseStart =
        mode === 'start' &&
        isStartDateToday &&
        (options?.usePreCloseStartValue ?? false);
      let usedRealtimeForAll = allowRealtimeEnd || allowPreCloseStart;
      let usedCostFallback = false;

      for (const [code, posState] of state.positions.entries()) {
        if (posState.quantity <= 0) continue;
        const quote = quotesMap?.[code];
        const exchangeRate = getExchangeRateForAssetToCNY(code);

        // 🔧 期末：使用实时价格 currentPrice
        if (allowRealtimeEnd && quote && typeof quote.currentPrice === 'number') {
          value += posState.quantity * quote.currentPrice * exchangeRate;
          continue;
        }

        // 🔧 期初（仅当期初是今天）：使用昨收价 prevClosePrice
        // 适用场景：周一计算周度，期初是今天，用昨收价代表开盘前状态
        if (allowPreCloseStart && quote && typeof quote.prevClosePrice === 'number') {
          value += posState.quantity * quote.prevClosePrice * exchangeRate;
          console.log(
            `[calcValue] ${code} 期初使用 prevClosePrice: ${quote.prevClosePrice}（昨收价，因为期初是今天）`
          );
          continue;
        }

        usedRealtimeForAll = false;

        const pricePoint = findPricePoint(code, priceDate);
        const effectivePriceDate = pricePoint?.date ?? priceDate;
        const priceTimestamp = new Date(
          `${effectivePriceDate}T23:59:59Z`
        ).getTime();
        const rate = getHistoricalRate(code, priceTimestamp);

        if (pricePoint && pricePoint.close != null) {
          value += posState.quantity * pricePoint.close * rate;
          const candidateDate = pricePoint.date;
          if (candidateDate) {
            const diff = Math.abs(
              differenceInCalendarDays(
                anchorDate,
                new Date(`${candidateDate}T00:00:00Z`)
              )
            );
            if (diff > metadata.fallbackDays) {
              metadata.fallbackDays = diff;
              metadata.effectiveDate = candidateDate;
            }
          }
          continue;
        }

        const fallbackUnitLocal =
          posState.quantity > 0
            ? posState.totalCostLocal / posState.quantity
            : null;

        if (fallbackUnitLocal === null || Number.isNaN(fallbackUnitLocal)) {
          console.warn(
            `[calculatePeriodStats] 无法为 ${code} 在 ${priceDate} 推导价格，跳过该资产`
          );
          continue;
        }

        usedCostFallback = true;
        console.warn(
          `[calculatePeriodStats] 使用成本价估算 ${code} 在 ${priceDate} 的市值`
        );
        value += posState.quantity * fallbackUnitLocal * rate;
      }

      if (usedCostFallback) {
        metadata.source = 'cost';
        metadata.effectiveDate = null;
      } else if (usedRealtimeForAll) {
        // 🔧 修复：期初使用 prevClosePrice 时也标记为 realtime
        metadata.source = 'realtime';
        metadata.effectiveDate = formatDate(new Date());
        metadata.fallbackDays = 0;
      } else {
        metadata.source = 'kline';
      }

      return { value, metadata };
    }

    // 重建期初和期末状态
    // 🔧 修复：期初不包含起始日当天交易，期末包含当天交易
    const startState = reconstructPortfolioState(startDate, false);  // 期初：不含当天
    const endState = reconstructPortfolioState(endDate, true);       // 期末：含当天

    // 计算期初和期末估值
    // 🔧 修复：期初价格日期的处理
    // 1. 如果 startDate 是今天（如周一的周度）：使用 prevClosePrice，不需要指定日期
    // 2. 如果 startDate 不是今天（如月度 12-01）：使用 startDate-1 的 K 线收盘价
    //    因为期初持仓是 startDate 开盘前的状态 = startDate-1 收盘时的状态
    const todayStr = formatDate(new Date());
    const startDateStr = formatDate(startDate);
    const isStartToday = startDateStr === todayStr;

    // 期初价格日期：今天则用今天（触发 prevClosePrice），否则用前一天
    const actualStartPriceDate = isStartToday ? todayStr : formatDate(subDays(startDate, 1));
    console.log(`[calculatePeriodStats] 周期=${period}, startDate=${startDateStr}, 期初价格日期=${actualStartPriceDate}, isStartToday=${isStartToday}`);
    const startResult = await calcValue(startState, actualStartPriceDate, 'start');
    const endResult = await calcValue(endState, endKlineDate, 'end');
    // 口径：按"净资产/净值"估值，避免融资买入导致的总资产虚增被误判为收益
    // 净值 = 总资产(现金+市值) - 已用杠杆
    const startValue = startResult.value - startState.usedLeverage;
    const endValue = endResult.value - endState.usedLeverage;

    // 🔧 调试日志：输出详细的估值信息
    console.log(`[calculatePeriodStats] ${period} 估值详情:
      期初持仓: ${startState.positions.size} 只, 现金: ${startState.cash.toFixed(2)}, 杠杆: ${startState.usedLeverage.toFixed(2)}
      期初估值(含杠杆): ${startResult.value.toFixed(2)}, 期初净值: ${startValue.toFixed(2)}
      期末持仓: ${endState.positions.size} 只, 现金: ${endState.cash.toFixed(2)}, 杠杆: ${endState.usedLeverage.toFixed(2)}
      期末估值(含杠杆): ${endResult.value.toFixed(2)}, 期末净值: ${endValue.toFixed(2)}
      期初价格来源: ${startResult.metadata.source}, 期末价格来源: ${endResult.metadata.source}
      期初实际日期: ${startResult.metadata.effectiveDate}, 期末实际日期: ${endResult.metadata.effectiveDate}
    `);

    // --- 5. 计算收益率 ---

    // 5.1 净值变化（简单收益率）
    const totalValueChange = endValue - startValue;
    const totalValueChangePercent =
      startValue > 0 ? totalValueChange / startValue : null;

    // 5.2 投资收益率（Modified Dietz - 精确时间加权版本）
    // 计算加权现金流：每笔现金流 × 该现金流在周期内的权重
    // 权重 = (周期结束时间 - 现金流发生时间) / 周期总时长
    const periodDurationSeconds = exclusiveEndTimestamp - startTimestamp;
    const periodDurationSecondsBig =
      periodDurationSeconds > 0 ? BigInt(periodDurationSeconds) : 0n;
    let weightedCashFlowsCents = 0n;
    let totalCashFlowsCents = 0n;

    cashFlowsWithTime.forEach((cf) => {
      const remainingSeconds = exclusiveEndTimestamp - cf.timestamp;
      const safeRemainingSeconds = Math.max(0, remainingSeconds);
      const amountCents = BigInt(Math.round(cf.amount * 100));
      totalCashFlowsCents += amountCents;

      let weight = 0;
      let weightedAmountCents = 0n;

      if (periodDurationSeconds > 0 && periodDurationSecondsBig > 0n) {
        weight = safeRemainingSeconds / periodDurationSeconds;
        const numerator = amountCents * BigInt(safeRemainingSeconds);
        const halfDenominator = periodDurationSecondsBig / 2n;
        const adjustedNumerator =
          numerator >= 0n ? numerator + halfDenominator : numerator - halfDenominator;
        weightedAmountCents = adjustedNumerator / periodDurationSecondsBig;
        weightedCashFlowsCents += weightedAmountCents;
      }

      const weightedAmount = Number(weightedAmountCents) / 100;

      console.log(
        `[Modified Dietz] ${cf.type} ${cf.date}: 金额=${cf.amount.toFixed(2)}, ` +
          `权重=${weight.toFixed(4)}, 加权=${weightedAmount.toFixed(2)}`
      );
    });

    const weightedCashFlows = Number(weightedCashFlowsCents) / 100;
    const totalCashFlows = Number(totalCashFlowsCents) / 100;

    console.log(
      `[Modified Dietz] 周期: ${period}, 总现金流=${totalCashFlows.toFixed(2)}, ` +
        `加权现金流=${weightedCashFlows.toFixed(2)}`
    );

    // 🔧 修复：移除 startValue > 0 的限制
    // 当期初值为0时（新建仓），只要分母（期初值 + 加权现金流）足够大，仍可计算收益率
    // 这对于投资组合创建当天即有入金的情况非常重要
    let periodReturnPercent: number | null = null;
    const denominator = startValue + weightedCashFlows;
    if (Math.abs(denominator) > 1e-9) {
      periodReturnPercent =
        (endValue - startValue - totalCashFlows) / denominator;
      console.log(
        `[Modified Dietz] 期初=${startValue.toFixed(2)}, 期末=${endValue.toFixed(2)}, ` +
          `分母=${denominator.toFixed(2)}, 收益率=${(periodReturnPercent * 100).toFixed(4)}%`
      );
    }

    // 🔧 修复：Period PnL 应该是绝对值变化扣除净现金流，而不是 收益率 * 期初值
    // 当期初值(V0)为0或很小时（例如新建仓），用 R * V0 计算 PnL 会导致严重误差
    // PnL = V1 - V0 - C
    const periodPnl = endValue - startValue - totalCashFlows;

    return {
      periodReturnPercent,
      periodPnl,
      totalValueChange,
      totalValueChangePercent,
      baseDate: startResult.metadata.effectiveDate ?? actualStartPriceDate,
      baseDateSource: startResult.metadata.source,
      endDate: endResult.metadata.effectiveDate ?? endKlineDate,
      endDateSource: endResult.metadata.source,
      fallbackDays: startResult.metadata.fallbackDays,
    };
  } catch (error) {
    console.error(
      `Error calculating period stats for period "${period}":`,
      error
    );
    return { periodReturnPercent: null, periodPnl: null };
  }
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
): { yearChangePercent?: number; yearChangeBaseDate?: string } {
  const results: { yearChangePercent?: number; yearChangeBaseDate?: string } =
    {};

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
    // 返回小数形式（0-1范围），前端会乘以100显示
    const change =
      (effectiveCurrentPrice - yearChangeBasePoint.close) /
      yearChangeBasePoint.close;
    results.yearChangePercent = parseFloat(change.toFixed(4));
    results.yearChangeBaseDate = yearChangeBasePoint.date;
  } else {
    results.yearChangePercent = undefined;
    results.yearChangeBaseDate = undefined;
  }

  return results;
}
