import { Portfolio, TransactionType } from '../../types';
import { getCommissionInCny } from '../portfolioReplay';
import { eachDayOfInterval, format } from 'date-fns';

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

  console.log(
    `[calculateLeverageCostByDay] 计算融资成本，利率: ${costRate}, 区间: ${format(startDate, 'yyyy-MM-dd')} ~ ${format(endDate, 'yyyy-MM-dd')}`
  );
  console.log(`[calculateLeverageCostByDay] 交易数量: ${txs.length}`);

  // DEBUG: 打印所有交易的日期和融资信息
  txs.forEach((tx, idx) => {
    console.log(
      `[calculateLeverageCostByDay] 交易${idx}: 日期=${tx.date}, 日期前10位=${tx.date.slice(0, 10)}, 类型=${tx.type}, leverageUsed=${tx.leverageUsed}`
    );
  });

  // 1. 构建每日融资余额表
  const dailyBalance: Record<string, number> = {};
  let currentBalance = 0;
  let txIndex = 0;

  // 🔥 修复：确保 startDate 包含第一笔交易的日期
  // 如果第一笔交易的日期早于 startDate，则使用第一笔交易的日期
  if (txs.length > 0) {
    const firstTxDateStr = txs[0].date.slice(0, 10); // "2025-01-18"
    const startDateStr = format(startDate, 'yyyy-MM-dd'); // "2025-01-19"

    if (firstTxDateStr < startDateStr) {
      // 将 startDate 调整为第一笔交易的日期
      const [year, month, day] = firstTxDateStr.split('-').map(Number);
      startDate = new Date(year, month - 1, day);
      console.log(
        `[calculateLeverageCostByDay] 调整起始日期为第一笔交易日期: ${firstTxDateStr}`
      );
    }
  }

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  console.log(
    `[calculateLeverageCostByDay] 总天数: ${days.length}, 第一天: ${format(days[0], 'yyyy-MM-dd')}, 最后一天: ${format(days[days.length - 1], 'yyyy-MM-dd')}`
  );

  for (const day of days) {
    const dayStr = format(day, 'yyyy-MM-dd');
    // 处理当天所有交易
    while (txIndex < txs.length && txs[txIndex].date.slice(0, 10) === dayStr) {
      const tx = txs[txIndex];

      // DEBUG: 打印所有交易的融资信息
      if (tx.type === 'BUY') {
        console.log(
          `[calculateLeverageCostByDay] ${dayStr} 买入交易 ${tx.assetCode}: leverageUsed=${tx.leverageUsed}, type=${typeof tx.leverageUsed}`
        );
      }

      // 只考虑影响融资余额的交易类型
      if (tx.type === 'BUY' && tx.leverageUsed && Number(tx.leverageUsed) > 0) {
        const leverageAmount = Number(tx.leverageUsed);
        currentBalance += leverageAmount;
        console.log(
          `[calculateLeverageCostByDay] ${dayStr} 买入 ${tx.assetCode}，使用融资: ${leverageAmount}, 新余额: ${currentBalance}`
        );
      } else if (tx.type === 'SELL') {
        // 卖出优先还融资，使用净收入（扣除手续费后）
        const grossAmount = Number(tx.amount || 0);
        const commission = getCommissionInCny(tx);
        const netAmount = grossAmount - commission;
        const repay = Math.min(netAmount, currentBalance);
        if (repay > 0) {
          currentBalance -= repay;
          console.log(
            `[calculateLeverageCostByDay] ${dayStr} 卖出 ${tx.assetCode}，偿还融资: ${repay}, 新余额: ${currentBalance}`
          );
        }
      } else if (tx.type === 'LEVERAGE_ADD') {
        // 追加融资额度不影响已用余额
        console.log(
          `[calculateLeverageCostByDay] ${dayStr} 追加融资额度: ${tx.amount}`
        );
      } else if (tx.type === 'LEVERAGE_REMOVE') {
        // 减少授信额度不影响已用余额
        console.log(
          `[calculateLeverageCostByDay] ${dayStr} 减少融资额度: ${tx.amount}`
        );
      } else if (tx.type === 'LEVERAGE_COST') {
        // 支付利息不影响已用余额
        console.log(
          `[calculateLeverageCostByDay] ${dayStr} 支付融资利息: ${tx.amount}`
        );
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

  console.log(
    `[calculateLeverageCostByDay] 计算完成，总利息: ${totalInterest.toFixed(2)}`
  );
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
