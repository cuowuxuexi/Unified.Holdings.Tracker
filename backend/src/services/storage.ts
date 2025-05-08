import { v4 as uuidv4 } from 'uuid';
import { getExchangeRateForAssetToCNY } from './currencyService'; // Import currency service
import { dataService } from './dataService'; // 导入数据访问服务
import { Portfolio, Transaction, TransactionType, LeverageInfo } from '../types'; // 确保类型在 ../types 中正确定义
import { cacheService } from './cacheService';

// --- 添加模块级 epsilon 定义 ---
const epsilon = 1e-6; // 用于浮点数比较的小量
// --- 结束添加 ---

// 投资组合数据文件路径
const PORTFOLIOS_FILE = 'portfolios/portfolios.json';
const PORTFOLIOS_CACHE_KEY = 'portfolios:list';
const PORTFOLIO_CACHE_PREFIX = 'portfolio:';
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

/**
 * 从缓存或文件读取投资组合列表
 */
export async function readPortfolios(): Promise<Portfolio[]> {
  try {
    // 尝试从缓存读取
    const cachedPortfolios = cacheService.get<Portfolio[]>(PORTFOLIOS_CACHE_KEY);
    if (cachedPortfolios !== null) {
      console.log('[storage] 从缓存读取投资组合列表');
      return cachedPortfolios;
    }

    // 缓存未命中，从文件读取
    console.log('[storage] 从文件读取投资组合列表');
    const portfolios = dataService.readJsonFile<Portfolio[]>(PORTFOLIOS_FILE, []);

    // 自动补全initialCash字段并同步写回
    let needWrite = false;
    const updatedPortfolios = portfolios.map((p: any) => {
      if (typeof p.initialCash !== 'number') {
        p.initialCash = typeof p.cash === 'number' ? p.cash : 0;
        needWrite = true;
      }
      return p;
    });

    if (needWrite) {
      await writePortfolios(updatedPortfolios);
    } else {
      // 只有在不需要写回时才缓存，避免重复缓存
      cacheService.set(PORTFOLIOS_CACHE_KEY, updatedPortfolios, CACHE_TTL);
    }

    return updatedPortfolios;
  } catch (error) {
    console.error('[storage] 读取投资组合数据失败:', error);
    return [];
  }
}

/**
 * 将投资组合列表写入文件并更新缓存
 */
export async function writePortfolios(portfolios: Portfolio[]): Promise<void> {
  try {
    const success = dataService.writeJsonFile(PORTFOLIOS_FILE, portfolios);
    if (!success) {
      throw new Error('写入投资组合数据失败');
    }
    
    // 更新列表缓存
    cacheService.set(PORTFOLIOS_CACHE_KEY, portfolios, CACHE_TTL);
    
    // 更新单个投资组合缓存
    portfolios.forEach(portfolio => {
      const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolio.id}`;
      cacheService.set(cacheKey, portfolio, CACHE_TTL);
    });
  } catch (error) {
    console.error('[storage] 写入投资组合数据失败:', error);
    throw error;
  }
}

/**
 * 通过 ID 查找投资组合，优先从缓存读取
 */
export async function getPortfolioById(id: string): Promise<Portfolio | null> {
  try {
    // 尝试从单个投资组合缓存读取
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${id}`;
    const cachedPortfolio = cacheService.get<Portfolio>(cacheKey);
    if (cachedPortfolio !== null) {
      console.log(`[storage] 从缓存读取投资组合 ${id}`);
      return cachedPortfolio;
    }

    // 缓存未命中，从列表中查找
  const portfolios = await readPortfolios();
  const portfolio = portfolios.find(p => p.id === id);
    
    if (portfolio) {
      // 找到后缓存该投资组合
      cacheService.set(cacheKey, portfolio, CACHE_TTL);
    }
    
  return portfolio || null;
  } catch (error) {
    console.error(`[storage] 查找投资组合 ${id} 失败:`, error);
    return null;
  }
}

/**
 * 添加新的投资组合并更新缓存
 */
export async function addPortfolio(newPortfolioData: { name: string; initialCash: number; leverage?: LeverageInfo }): Promise<Portfolio> {
  const portfolios = await readPortfolios();
  const newPortfolio: Portfolio = {
    name: newPortfolioData.name,
    id: uuidv4(),
    transactions: [],
    cash: newPortfolioData.initialCash,
    initialCash: newPortfolioData.initialCash,
    leverage: newPortfolioData.leverage || { totalAmount: 0, usedAmount: 0, availableAmount: 0, costRate: 0 }
  };
  
  portfolios.push(newPortfolio);
  await writePortfolios(portfolios);
  
  // 单独缓存新投资组合
  const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${newPortfolio.id}`;
  cacheService.set(cacheKey, newPortfolio, CACHE_TTL);
  
  return newPortfolio;
}

/**
 * 向特定投资组合添加交易并更新缓存
 */
export async function addTransactionToPortfolio(
  portfolioId: string,
  transactionData: Omit<Transaction, 'id'>
): Promise<Transaction | null> {
  const portfolios = await readPortfolios();
  const portfolioIndex = portfolios.findIndex(p => p.id === portfolioId);

  if (portfolioIndex === -1) {
    console.error(`Portfolio with ID ${portfolioId} not found.`);
    return null;
  }

  const portfolio = portfolios[portfolioIndex];
  const newTransaction: Transaction = {
    ...transactionData,
    id: uuidv4(),
  };

  // --- 恢复 amount 定义，供非 BUY 分支使用 ---
  const amount = transactionData.amount ?? ((transactionData.quantity ?? 0) * (transactionData.price ?? 0));
  const commission = transactionData.commission ?? 0;

  switch (transactionData.type) {
    case TransactionType.BUY: {
      // 1. 计算原始货币总成本
      const originalQuantity = transactionData.quantity ?? 0;
      const originalPrice = transactionData.price ?? 0;
      const originalCommission = transactionData.commission ?? 0;
      const originalTotalCost = originalQuantity * originalPrice;
      const originalLeverageUsed = transactionData.leverageUsed ?? 0;

      // 2. 获取汇率 (默认为 1, 即 CNY)
      let exchangeRate = 1.0;
      if (transactionData.assetCode) {
        // --- 增加日志：获取汇率 ---
        console.log(`[storage.ts BUY] Asset code found: ${transactionData.assetCode}, checking for exchange rate.`);
        // --- 结束日志 ---
        // 简单的判断，实际项目中 getMarketFromCode 应该更健壮
        const isForeign = transactionData.assetCode.toLowerCase().startsWith('hk') || transactionData.assetCode.toLowerCase().startsWith('us');
        if (isForeign) {
          try {
            exchangeRate = await getExchangeRateForAssetToCNY(transactionData.assetCode);
            // --- 增加日志：获取汇率结果 ---
            console.log(`[storage.ts BUY] Fetched exchange rate for ${transactionData.assetCode}: ${exchangeRate}`);
            // --- 结束日志 ---
          } catch (error) {
            console.error(`[storage.ts BUY] Failed to get exchange rate for ${transactionData.assetCode}:`, error);
            // 根据业务决定是返回错误还是使用默认汇率，这里返回错误以提示问题
            return null;
          }
        }
      }

      // 3. 转换金额为 CNY
      const totalCostCNY = originalTotalCost * exchangeRate;
      const commissionCNY = originalCommission * exchangeRate;
      const leverageUsedCNY = originalLeverageUsed * exchangeRate;

      // --- 增加日志：CNY 金额 ---
      console.log(`[storage.ts BUY] Original Cost: ${originalTotalCost}, Rate: ${exchangeRate}, Total Cost CNY: ${totalCostCNY}`);
      console.log(`[storage.ts BUY] Commission CNY: ${commissionCNY}, Original Leverage Used: ${originalLeverageUsed}, Leverage Used CNY: ${leverageUsedCNY}`);
      // --- 结束日志 ---

      // 4. 处理手续费支付
      if (portfolio.cash >= commissionCNY) {
        // 现金足够支付手续费
        portfolio.cash -= commissionCNY;
        console.log(`[storage.ts BUY] Commission paid with cash. Cash after commission: ${portfolio.cash.toFixed(2)}`);
      } else {
        // 现金不足，检查融资额度
        const feeShortfall = commissionCNY - portfolio.cash;
        if (portfolio.leverage.availableAmount >= feeShortfall) {
          // 用完所有现金
          portfolio.cash = 0;
          // 使用融资支付剩余手续费
          portfolio.leverage.usedAmount += feeShortfall;
          portfolio.leverage.availableAmount -= feeShortfall;
          console.log(`[storage.ts BUY] Commission partially paid with cash (${(commissionCNY - feeShortfall).toFixed(2)}) and leverage (${feeShortfall.toFixed(2)})`);
        } else {
          // 现金和融资都不足以支付手续费
          console.error('Insufficient funds and leverage to cover transaction fee.');
          return null;
        }
      }

      // 5. 处理交易本金
      const useLeverage = originalLeverageUsed > epsilon;
      if (useLeverage) {
        // 使用指定的杠杆金额
        if (leverageUsedCNY < -epsilon) {
          console.error('leverageUsed (CNY) must be >= 0');
          return null;
        }
        if (leverageUsedCNY > portfolio.leverage.availableAmount + epsilon) {
          console.error(`融资额度不足 (CNY)。需要: ${leverageUsedCNY.toFixed(2)}, 可用: ${portfolio.leverage.availableAmount.toFixed(2)}`);
          return null;
        }
        // 计算需要用现金支付的部分 (CNY)
        const needCash = totalCostCNY - leverageUsedCNY;
        console.log(`[storage.ts BUY] Need Cash (CNY): ${needCash.toFixed(2)} (TotalCNY: ${totalCostCNY.toFixed(2)} - LeverageCNY: ${leverageUsedCNY.toFixed(2)})`);

        if (needCash < -epsilon) {
          console.error(`计算错误：需要支付的现金部分远小于零 (needCash: ${needCash.toFixed(8)}). 这可能发生在 leverageUsed > totalCost 时。`);
          return null;
        }
        if (needCash > portfolio.cash + epsilon) {
          console.error(`现金余额不足 (CNY)。需要: ${needCash.toFixed(2)}, 可用: ${portfolio.cash.toFixed(2)}`);
          return null;
        }
        portfolio.leverage.usedAmount += leverageUsedCNY;
        portfolio.leverage.availableAmount -= leverageUsedCNY;
        portfolio.cash -= Math.max(0, needCash);
      } else {
        // 现金优先
        if (portfolio.cash >= totalCostCNY) {
          // 现金足够支付交易本金
          portfolio.cash -= totalCostCNY;
          console.log(`[storage.ts BUY] Trade cost paid with cash. Cash after: ${portfolio.cash.toFixed(2)}`);
        } else {
          // 现金不足，尝试使用融资
          const neededLeverageCNY = totalCostCNY - portfolio.cash;
          if (portfolio.leverage.availableAmount >= neededLeverageCNY) {
            portfolio.leverage.usedAmount += neededLeverageCNY;
            portfolio.leverage.availableAmount -= neededLeverageCNY;
            portfolio.cash = 0;
            console.log(`[storage.ts BUY] Trade cost covered by cash (${portfolio.cash.toFixed(2)}) and leverage (${neededLeverageCNY.toFixed(2)})`);
          } else {
            console.error('Insufficient funds and leverage for trade cost.');
            return null;
          }
        }
      }

      // 6. 保存交易记录
      newTransaction.amount = totalCostCNY + commissionCNY;
      newTransaction.leverageUsed = originalLeverageUsed > epsilon ? originalLeverageUsed : undefined;
      break;
    }

    case TransactionType.SELL: {
      const commission = transactionData.commission ?? 0; // 使用 commission 字段
      // 卖出时，优先偿还融资，剩余部分计入现金
      const netAmount = amount - commission;
      if (portfolio.leverage.usedAmount > 0) {
        // 有未偿还的融资，优先偿还
        const repayAmount = Math.min(netAmount, portfolio.leverage.usedAmount);
        portfolio.leverage.usedAmount -= repayAmount;
        portfolio.leverage.availableAmount += repayAmount;
        // 剩余金额计入现金
        portfolio.cash += (netAmount - repayAmount);
      } else {
        // 没有未偿还的融资，全部计入现金
        portfolio.cash += netAmount;
      }
      break;
    }

    case TransactionType.DEPOSIT:
      portfolio.cash += amount;
      break;

    case TransactionType.WITHDRAW:
      if (portfolio.cash >= amount) {
        portfolio.cash -= amount;
      } else {
        console.error('Insufficient cash for withdrawal');
        return null;
      }
      break;

    case TransactionType.DIVIDEND:
      // Assuming amount is already in portfolio's base currency (CNY)
      console.log(`[storage.ts DIVIDEND] Received dividend amount: ${amount}. Adding to cash.`);
      portfolio.cash += amount;
      break;

    case TransactionType.LEVERAGE_ADD:
      portfolio.leverage.totalAmount += amount;
      portfolio.leverage.availableAmount += amount;
      break;

    case TransactionType.LEVERAGE_REMOVE:
      if (portfolio.leverage.availableAmount >= amount) {
        portfolio.leverage.totalAmount -= amount;
        portfolio.leverage.availableAmount -= amount;
      } else {
        console.error('Cannot remove leverage: amount exceeds available leverage');
        return null;
      }
      break;

    case TransactionType.LEVERAGE_COST:
      if (portfolio.cash >= amount) {
        portfolio.cash -= amount;
      } else {
        console.error('Insufficient cash for leverage cost payment');
        return null;
      }
      break;

    default:
      const exhaustiveCheck: never = transactionData.type;
      console.warn(`Unhandled transaction type: ${exhaustiveCheck}`);
      return null;
  }

  portfolio.transactions.push(newTransaction);
  portfolios[portfolioIndex] = portfolio;
  await writePortfolios(portfolios);
  return newTransaction;
}

/**
 * 从特定投资组合中删除交易并更新缓存
 */
export async function deleteTransactionFromPortfolio(
  portfolioId: string,
  transactionId: string
): Promise<boolean> {
  const portfolios = await readPortfolios();
  const portfolioIndex = portfolios.findIndex(p => p.id === portfolioId);

  if (portfolioIndex === -1) {
    console.error(`Portfolio with ID ${portfolioId} not found for deletion.`);
    return false;
  }

  const portfolio = portfolios[portfolioIndex];
  const transactionIndex = portfolio.transactions.findIndex(t => t.id === transactionId);

  if (transactionIndex === -1) {
    console.error(`Transaction with ID ${transactionId} not found in portfolio ${portfolioId}.`);
    return false;
  }

  const transactionToDelete = portfolio.transactions[transactionIndex];
  const amount = transactionToDelete.amount ?? ((transactionToDelete.quantity ?? 0) * (transactionToDelete.price ?? 0));

  switch (transactionToDelete.type) {
    case TransactionType.BUY: {
      const commission = transactionToDelete.commission ?? 0;
      // 删除买入交易时，需要考虑是否使用了融资
      if (portfolio.leverage.usedAmount > 0) {
        // 有融资，优先归还融资
        const leverageToReturn = Math.min(amount, portfolio.leverage.usedAmount);
        portfolio.leverage.usedAmount -= leverageToReturn;
        portfolio.leverage.availableAmount += leverageToReturn;
        // 剩余部分返还现金（含手续费）
        portfolio.cash += (amount - leverageToReturn + commission);
      } else {
        // 没有融资，全部返还现金（含手续费）
        portfolio.cash += (amount + commission);
      }
      break;
    }
    case TransactionType.SELL: {
      const commission = transactionToDelete.commission ?? 0;
      // 删除卖出交易时，需要扣减现金并可能需要恢复融资
      const netAmount = amount - commission;
      if (portfolio.cash >= netAmount) {
        // 现金足够，直接扣减
        portfolio.cash -= netAmount;
      } else {
        // 现金不足，需要使用融资
        const neededLeverage = netAmount - portfolio.cash;
        if (portfolio.leverage.availableAmount >= neededLeverage) {
          portfolio.leverage.usedAmount += neededLeverage;
          portfolio.leverage.availableAmount -= neededLeverage;
          portfolio.cash = 0;
        } else {
          console.error('Cannot reverse sell transaction: insufficient funds and leverage');
          return false;
        }
      }
      break;
    }
    case TransactionType.DEPOSIT:
      if (portfolio.cash >= amount) {
        portfolio.cash -= amount;
      } else {
        console.error('Cannot reverse deposit: insufficient cash');
        return false;
      }
      break;

    case TransactionType.WITHDRAW:
      portfolio.cash += amount;
      break;

    case TransactionType.LEVERAGE_ADD:
      if (portfolio.leverage.totalAmount >= amount) {
        portfolio.leverage.totalAmount -= amount;
        portfolio.leverage.availableAmount -= amount;
      } else {
        console.error('Cannot reverse leverage add: amount exceeds total leverage');
        return false;
      }
      break;

    case TransactionType.LEVERAGE_REMOVE:
      portfolio.leverage.totalAmount += amount;
      portfolio.leverage.availableAmount += amount;
      break;

    case TransactionType.LEVERAGE_COST:
      portfolio.cash += amount;
      break;

    case TransactionType.DIVIDEND:
      // Reversing dividend: subtract amount from cash
      if (portfolio.cash >= amount) {
        portfolio.cash -= amount;
      } else {
        // This case is tricky. If reversing a dividend makes cash negative,
        // it implies an inconsistency or an impossible scenario if withdrawals were properly checked.
        // Log an error, but perhaps allow it to proceed to highlight the data issue?
        // Or return false to prevent potentially invalid state.
        console.error(`[storage.ts Delete DIVIDEND] Reversing dividend ${transactionId} for portfolio ${portfolioId} would result in negative cash. Current cash: ${portfolio.cash}, Dividend amount: ${amount}. Proceeding, but data may be inconsistent.`);
        // For now, let it proceed but log error. Could return false here.
        portfolio.cash -= amount;
        // return false;
      }
      break;

    default:
      const exhaustiveCheck: never = transactionToDelete.type;
      console.warn(`Unhandled transaction type for deletion: ${exhaustiveCheck}`);
      return false;
  }

  // 移除交易记录
  portfolio.transactions.splice(transactionIndex, 1);
  portfolios[portfolioIndex] = portfolio;
  await writePortfolios(portfolios);
  return true;
}

/**
 * 删除投资组合并清除相关缓存
 */
export async function deletePortfolio(portfolioId: string): Promise<boolean> {
  const portfolios = await readPortfolios();
  const index = portfolios.findIndex(p => p.id === portfolioId);
  
  if (index === -1) {
    return false;
  }
  
  portfolios.splice(index, 1);
  await writePortfolios(portfolios);
  
  // 清除该投资组合的缓存
  const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
  cacheService.delete(cacheKey);
  
  return true;
}

/**
 * 现金重算工具：遍历所有交易流水，按规则重算每一步现金余额，并与portfolio.cash字段对比，输出差异报告。
 * 注意：此函数现在是异步的，因为它需要获取汇率。
 */
export async function cashRecalculateForPortfolioAsync(portfolio: Portfolio): Promise<{
  cash: number,
  diff: number,
  steps: Array<{ txId: string, type: string, before: number, after: number, expected: number }>
}> {
  let cash = portfolio.initialCash ?? 0;
  let usedLeverageCNY = portfolio.leverage?.usedAmount ?? 0;
  let availableLeverageCNY = portfolio.leverage?.availableAmount ?? (portfolio.leverage?.totalAmount ?? 0);
  const steps: Array<{ txId: string, type: string, before: number, after: number, expected: number }> = [];

  console.log(`[RecalculateAsync] Starting recalculation for portfolio ${portfolio.id}. Initial cash: ${cash}`);
  for (const tx of portfolio.transactions) {
    const before = cash;
    let exchangeRate = 1.0;
    const isForeign = tx.assetCode && (tx.assetCode.toLowerCase().startsWith('hk') || tx.assetCode.toLowerCase().startsWith('us'));

    // 获取汇率 (仅对外币)
    if (isForeign && tx.assetCode) {
      try {
        exchangeRate = await getExchangeRateForAssetToCNY(tx.assetCode);
      } catch (error) {
        console.error(`[RecalculateAsync] Failed to get exchange rate for ${tx.assetCode} on tx ${tx.id}. Skipping transaction. Error:`, error);
        continue; // 跳过此交易的处理
      }
    }

    const commission = tx.commission ?? 0;
    const originalQuantity = tx.quantity ?? 0;
    const originalPrice = tx.price ?? 0;
    // amount 现在应该代表持久化的 CNY 值 (来自 addTransactionToPortfolio 的修改)
    // 如果 amount 不存在，则基于原始价格和当前获取的汇率计算
    const amountCNY = tx.amount ?? (originalQuantity * originalPrice * exchangeRate);
    const commissionCNY = commission * exchangeRate; // 手续费也需要转换
    const totalCostCNY = amountCNY + commissionCNY; // 注意：BUY 的 amount 已经包含了成本

    // 兼容历史数据或不同来源的 leverageUsed
    const originalLeverageUsed = tx.leverageUsed !== undefined ? tx.leverageUsed :
                               (tx as any).useLeverageAmount !== undefined ? (tx as any).useLeverageAmount : 0;
    const leverageUsedCNY = originalLeverageUsed * exchangeRate;

    console.log(`[RecalculateAsync] Before Tx ${tx.id} (${tx.type}): cash=${before.toFixed(2)}, AmountCNY=${amountCNY.toFixed(2)}, CommissionCNY=${commissionCNY.toFixed(2)}, assetCode=${tx.assetCode}, Rate=${exchangeRate}, OrigLeverage=${originalLeverageUsed}`);

    switch (tx.type) {
      case TransactionType.BUY: {
        const useLeverage = originalLeverageUsed > epsilon;
        if (useLeverage) {
          const needCash = totalCostCNY - leverageUsedCNY;
          // 检查逻辑与 addTransactionToPortfolio 保持一致
          if (needCash < -epsilon) {
             console.warn(`[RecalculateAsync BUY Leveraged Tx ${tx.id}] needCash is significantly negative (${needCash.toFixed(8)}). Skipping.`);
             continue;
          }
          if (needCash > cash + epsilon) {
             console.warn(`[RecalculateAsync BUY Leveraged Tx ${tx.id}] Insufficient cash (Need ${needCash.toFixed(2)}, Have ${cash.toFixed(2)}). Skipping.`);
             continue;
          }
          if (leverageUsedCNY > availableLeverageCNY + epsilon) {
            console.warn(`[RecalculateAsync BUY Leveraged Tx ${tx.id}] Insufficient available leverage (Need ${leverageUsedCNY.toFixed(2)}, Have ${availableLeverageCNY.toFixed(2)}). Skipping.`);
            continue;
          }
          usedLeverageCNY += leverageUsedCNY;
          availableLeverageCNY -= leverageUsedCNY;
          cash -= Math.max(0, needCash);
        } else {
          // 现金优先
          if (cash >= totalCostCNY - epsilon) {
            cash -= totalCostCNY;
          } else {
            const neededLeverageCNY = totalCostCNY - cash;
             if (availableLeverageCNY >= neededLeverageCNY - epsilon) {
                usedLeverageCNY += neededLeverageCNY;
                availableLeverageCNY -= neededLeverageCNY;
                cash = 0;
             } else {
                console.warn(`[RecalculateAsync BUY CashFirst Tx ${tx.id}] Insufficient funds and leverage. Skipping.`);
                continue;
             }
          }
        }
        break;
      }
      case TransactionType.SELL: {
        // 卖出时，netAmount 是 CNY 值
        const netAmountCNY = amountCNY - commissionCNY;
        if (usedLeverageCNY > epsilon) {
          const repayAmountCNY = Math.min(netAmountCNY, usedLeverageCNY);
          usedLeverageCNY -= repayAmountCNY;
          availableLeverageCNY += repayAmountCNY;
          cash += (netAmountCNY - repayAmountCNY);
        } else {
          cash += netAmountCNY;
        }
        break;
      }
      // 其他类型假设 amount 字段已经是对应的 CNY 值
      case TransactionType.DEPOSIT:
        cash += amountCNY;
        break;
      case TransactionType.WITHDRAW:
        // 需要检查现金是否足够
        if (cash >= amountCNY - epsilon) {
            cash -= amountCNY;
        } else {
            console.warn(`[RecalculateAsync WITHDRAW Tx ${tx.id}] Insufficient cash (${cash.toFixed(2)} < ${amountCNY.toFixed(2)}). Skipping.`);
            continue;
        }
        break;
      case TransactionType.LEVERAGE_ADD:
        // 假设 LEVERAGE_ADD 的 amount 是 CNY
        availableLeverageCNY += amountCNY;
        // 注意：这里没有增加 totalAmount，取决于业务定义
        break;
      case TransactionType.LEVERAGE_REMOVE:
        // 假设 LEVERAGE_REMOVE 的 amount 是 CNY
        if (availableLeverageCNY >= amountCNY - epsilon) {
            availableLeverageCNY -= amountCNY;
            // 注意：这里没有减少 totalAmount
        } else {
             console.warn(`[RecalculateAsync LEVERAGE_REMOVE Tx ${tx.id}] Insufficient available leverage (${availableLeverageCNY.toFixed(2)} < ${amountCNY.toFixed(2)}). Skipping.`);
             continue;
        }
        break;
      case TransactionType.LEVERAGE_COST:
        // 假设 LEVERAGE_COST 的 amount 是 CNY
        if (cash >= amountCNY - epsilon) {
            cash -= amountCNY;
        } else {
             console.warn(`[RecalculateAsync LEVERAGE_COST Tx ${tx.id}] Insufficient cash (${cash.toFixed(2)} < ${amountCNY.toFixed(2)}). Skipping.`);
             continue;
        }
        break;
      default:
        break;
    }
    console.log(`[RecalculateAsync] After Tx ${tx.id} (${tx.type}): cash=${cash.toFixed(2)}, usedLeverageCNY=${usedLeverageCNY.toFixed(2)}, availableLeverageCNY=${availableLeverageCNY.toFixed(2)}`);
    steps.push({ txId: tx.id, type: tx.type, before, after: cash, expected: cash }); // Expected is the recalculated value
  }
  console.log(`[RecalculateAsync] Final recalculated cash for portfolio ${portfolio.id}: ${cash.toFixed(2)}`);
  // diff 现在比较的是 portfolio 对象中记录的 cash (可能未及时更新) 与我们重算的结果
  const diff = (portfolio.cash ?? 0) - cash;
  // 返回重算后的现金、差异以及步骤
  // 注意：此函数现在不直接修改 portfolio 对象，调用者需要根据返回值更新
  return { cash, diff, steps };
}

/**
 * 修正历史交易记录中的外币金额，并重新计算投资组合的现金余额。
 * 该函数应谨慎使用，建议在执行前备份数据。
 */
export async function correctHistoricalTransactionAmounts(): Promise<void> {
  console.log('[Correction] Starting historical transaction amount correction...');
  let portfolios: Portfolio[];
  try {
    portfolios = await readPortfolios();
    if (!portfolios || portfolios.length === 0) {
      console.log('[Correction] No portfolios found or data file is empty. Exiting correction.');
      return;
    }
  } catch (error) {
    console.error('[Correction] Error reading portfolios data during correction:', error);
    return;
  }
  let changesMade = false;

  for (const portfolio of portfolios) {
    let portfolioChanged = false;
    console.log(`[Correction] Processing portfolio: ${portfolio.name} (${portfolio.id})`);

    // --- 修改点：直接调用异步重算函数 ---
    console.log(`[Correction] Recalculating cash for portfolio ${portfolio.id} using async recalculator.`);
    try {
        const recalculationResult = await cashRecalculateForPortfolioAsync(portfolio);
        const recalculatedCash = recalculationResult.cash;
        // 只有当计算出的现金与记录的现金有显著差异时才更新并标记
        if (Math.abs(portfolio.cash - recalculatedCash) > epsilon) {
            console.log(`[Correction] Portfolio ${portfolio.id} cash requires update. Current: ${portfolio.cash.toFixed(2)}, Recalculated: ${recalculatedCash.toFixed(2)}`);
            portfolio.cash = recalculatedCash; // 更新现金余额
            // 同时更新杠杆使用额 (也以 CNY 计价)
            // 需要从 cashRecalculateForPortfolioAsync 返回 usedLeverageCNY
            // *** 暂时不更新杠杆，需要修改 cashRecalculateForPortfolioAsync 返回值 ***
            portfolioChanged = true;
            changesMade = true;
        } else {
             console.log(`[Correction] Portfolio ${portfolio.id} cash is consistent. Current: ${portfolio.cash.toFixed(2)}`);
        }
    } catch (recalcError) {
         console.error(`[Correction] Error recalculating cash for portfolio ${portfolio.id}:`, recalcError);
         //可以选择跳过此投资组合或停止整个过程
         continue; // 跳过此投资组合
    }
    // --- 结束修改点 ---

    // // -- 旧的逐条修正逻辑 (保留注释以供参考) ---
    // for (const tx of portfolio.transactions) {
    //   if ((tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) && tx.assetCode) {
    //     const lowerCode = tx.assetCode.toLowerCase();
    //     const isForeignCurrency = lowerCode.startsWith('hk') || lowerCode.startsWith('us');
    //     if (isForeignCurrency && tx.quantity !== undefined && tx.price !== undefined) {
    //        try {
    //           const originalAmount = tx.amount;
    //           const exchangeRate = await getExchangeRateForAssetToCNY(tx.assetCode);
    //           const correctAmountInCNY = tx.quantity * tx.price * exchangeRate;
    //           // 只在计算出的 CNY 金额与记录的 amount (假设也应是 CNY) 显著不同时更新
    //           if (Math.abs((originalAmount ?? 0) - correctAmountInCNY) > epsilon) {
    //              console.log(`[Correction] Correcting transaction ${tx.id} for ${tx.assetCode}: original amount ${originalAmount?.toFixed(2)}, calculated CNY amount ${correctAmountInCNY.toFixed(2)} (Rate: ${exchangeRate})`);
    //              tx.amount = correctAmountInCNY;
    //              portfolioChanged = true;
    //              changesMade = true;
    //           }
    //        } catch (error) {
    //           console.error(`[Correction] Failed to correct transaction ${tx.id} due to exchange rate error:`, error);
    //        }
    //     }
    //   }
    // }
    // // 如果投资组合的交易记录有变化，重新计算现金余额 (现在由上面的异步重算完成)
    // if (portfolioChanged) {
    //    // ... (旧的调用同步 cashRecalculateForPortfolio 的逻辑) ...
    // }
    // // --- 结束旧逻辑 ---
  }

  // 如果有任何投资组合被修改，写回文件
  if (changesMade) {
    console.log('[Correction] Saving updated portfolios...');
    await writePortfolios(portfolios);
    console.log('[Correction] Historical data correction and recalculation completed.');
  } else {
    console.log('[Correction] No portfolio data needed correction or update based on recalculation.');
  }
}

// 可选：如果需要，实现 updatePortfolio, deletePortfolio

// export async function updatePortfolio(portfolioId: string, updatedData: Partial<Omit<Portfolio, 'id' | 'transactions'>>): Promise<Portfolio | null> {
//   // 实现更新逻辑...
// }
//
// export async function deletePortfolio(portfolioId: string): Promise<boolean> {
//   // 实现删除逻辑...
// }