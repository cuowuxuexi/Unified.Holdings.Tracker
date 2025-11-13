import { v4 as uuidv4 } from 'uuid';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../database/prisma-client';
import { cacheService } from '../cache/cache-service';
import {
  Portfolio,
  Transaction,
  TransactionType,
  LeverageInfo,
} from '@uht/domain';
import type {
  Portfolio as PrismaPortfolio,
  Transaction as PrismaTransaction,
} from '@prisma/client';

// 缓存配置
const PORTFOLIOS_CACHE_KEY = 'portfolios:list';
const PORTFOLIO_CACHE_PREFIX = 'portfolio:';
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const epsilon = 1e-6;

// ============ 映射工具函数 ============

function decimalToNumber(d: Decimal | null | undefined): number {
  return d ? d.toNumber() : 0;
}

function toDecimal(n: number | undefined | null): Decimal {
  return new Decimal(n ?? 0);
}

function mapTransactionEntity(record: PrismaTransaction): Transaction {
  return {
    id: record.id,
    date: record.date.toISOString(),
    type: record.type as TransactionType,
    assetCode: record.assetCode ?? undefined,
    quantity: record.quantity ? Number(record.quantity) : undefined,
    price: record.price ? Number(record.price) : undefined,
    amount: record.amount ? Number(record.amount) : undefined,
    commission: record.commission ? Number(record.commission) : undefined,
    leverageUsed: record.leverageUsed ? Number(record.leverageUsed) : undefined,
    currency: record.currency,
    exchangeRate: record.exchangeRate ? Number(record.exchangeRate) : undefined,
    notes: record.notes ?? undefined,
  };
}

function mapPortfolioEntity(
  record: PrismaPortfolio & { transactions: PrismaTransaction[] }
): Portfolio {
  return {
    id: record.id,
    name: record.name,
    cash: decimalToNumber(record.cash),
    initialCash: decimalToNumber(record.initialCash),
    leverage: {
      totalAmount: decimalToNumber(record.leverageTotalAmount),
      usedAmount: decimalToNumber(record.leverageUsedAmount),
      availableAmount: decimalToNumber(record.leverageAvailableAmount),
      costRate: decimalToNumber(record.leverageCostRate),
    },
    attentionInfo: record.attentionInfo ?? undefined,
    transactions: record.transactions.map(mapTransactionEntity),
  };
}

// 用于列表查询的轻量级映射函数（不包含交易记录）
function mapPortfolioBasicEntity(record: PrismaPortfolio): Portfolio {
  return {
    id: record.id,
    name: record.name,
    cash: decimalToNumber(record.cash),
    initialCash: decimalToNumber(record.initialCash),
    leverage: {
      totalAmount: decimalToNumber(record.leverageTotalAmount),
      usedAmount: decimalToNumber(record.leverageUsedAmount),
      availableAmount: decimalToNumber(record.leverageAvailableAmount),
      costRate: decimalToNumber(record.leverageCostRate),
    },
    attentionInfo: record.attentionInfo ?? undefined,
    transactions: [], // 列表查询不需要交易记录
  };
}

// ============ 核心 CRUD 函数 ============

export async function readPortfolios(): Promise<Portfolio[]> {
  try {
    const cachedPortfolios =
      cacheService.get<Portfolio[]>(PORTFOLIOS_CACHE_KEY);
    if (cachedPortfolios !== null) {
      console.log('[storage.prisma] 从缓存读取投资组合列表');
      return cachedPortfolios;
    }

    console.log('[storage.prisma] 从数据库读取投资组合列表（仅基本信息）');
    // 性能优化：列表查询不加载交易记录
    const records = await prisma.portfolio.findMany({
      // 移除 include: { transactions: true }
    });

    const portfolios = records.map(mapPortfolioBasicEntity);
    cacheService.set(PORTFOLIOS_CACHE_KEY, portfolios, CACHE_TTL);
    return portfolios;
  } catch (error) {
    console.error('[storage.prisma] 读取投资组合数据失败:', error);
    return [];
  }
}

export async function writePortfolios(portfolios: Portfolio[]): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const portfolio of portfolios) {
        await tx.transaction.deleteMany({
          where: { portfolioId: portfolio.id },
        });

        await tx.portfolio.upsert({
          where: { id: portfolio.id },
          create: {
            id: portfolio.id,
            name: portfolio.name,
            initialCash: toDecimal(portfolio.initialCash),
            cash: toDecimal(portfolio.cash),
            leverageTotalAmount: toDecimal(portfolio.leverage.totalAmount),
            leverageUsedAmount: toDecimal(portfolio.leverage.usedAmount),
            leverageAvailableAmount: toDecimal(
              portfolio.leverage.availableAmount
            ),
            leverageCostRate: toDecimal(portfolio.leverage.costRate),
          },
          update: {
            name: portfolio.name,
            cash: toDecimal(portfolio.cash),
            leverageTotalAmount: toDecimal(portfolio.leverage.totalAmount),
            leverageUsedAmount: toDecimal(portfolio.leverage.usedAmount),
            leverageAvailableAmount: toDecimal(
              portfolio.leverage.availableAmount
            ),
            leverageCostRate: toDecimal(portfolio.leverage.costRate),
          },
        });

        if (portfolio.transactions.length > 0) {
          await tx.transaction.createMany({
            data: portfolio.transactions.map((t) => ({
              id: t.id,
              portfolioId: portfolio.id,
              type: t.type,
              date: new Date(t.date),
              assetCode: t.assetCode ?? null,
              quantity: t.quantity ? toDecimal(t.quantity) : null,
              price: t.price ? toDecimal(t.price) : null,
              amount: t.amount ? toDecimal(t.amount) : null,
              commission: t.commission ? toDecimal(t.commission) : null,
              leverageUsed: t.leverageUsed ? toDecimal(t.leverageUsed) : null,
              notes: t.notes ?? null,
            })),
          });
        }
      }
    });

    cacheService.set(PORTFOLIOS_CACHE_KEY, portfolios, CACHE_TTL);
    portfolios.forEach((portfolio) => {
      const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolio.id}`;
      cacheService.set(cacheKey, portfolio, CACHE_TTL);
    });
  } catch (error) {
    console.error('[storage.prisma] 写入投资组合数据失败:', error);
    throw error;
  }
}

export async function getPortfolioById(id: string): Promise<Portfolio | null> {
  try {
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${id}`;
    const cachedPortfolio = cacheService.get<Portfolio>(cacheKey);
    if (cachedPortfolio !== null) {
      console.log(`[storage.prisma] 从缓存读取投资组合 ${id}`);
      return cachedPortfolio;
    }

    const record = await prisma.portfolio.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { date: 'asc' }, // 按日期升序排序，确保计算持仓时顺序正确
        },
      },
    });

    if (!record) return null;

    const portfolio = mapPortfolioEntity(record);
    cacheService.set(cacheKey, portfolio, CACHE_TTL);
    return portfolio;
  } catch (error) {
    console.error(`[storage.prisma] 查找投资组合 ${id} 失败:`, error);
    return null;
  }
}

export async function addPortfolio(newPortfolioData: {
  name: string;
  initialCash: number;
  leverage?: LeverageInfo;
}): Promise<Portfolio> {
  const portfolioId = uuidv4();
  const leverageData = newPortfolioData.leverage || {
    totalAmount: 0,
    usedAmount: 0,
    availableAmount: 0,
    costRate: 0,
  };

  try {
    // 直接使用 Prisma 创建新记录，而不是调用 writePortfolios
    const record = await prisma.portfolio.create({
      data: {
        id: portfolioId,
        name: newPortfolioData.name,
        initialCash: toDecimal(newPortfolioData.initialCash),
        cash: toDecimal(newPortfolioData.initialCash),
        leverageTotalAmount: toDecimal(leverageData.totalAmount),
        leverageUsedAmount: toDecimal(leverageData.usedAmount),
        leverageAvailableAmount: toDecimal(leverageData.availableAmount),
        leverageCostRate: toDecimal(leverageData.costRate),
      },
      include: {
        transactions: {
          orderBy: { date: 'asc' }, // 按日期升序排序
        },
      },
    });

    const newPortfolio = mapPortfolioEntity(record);

    // 清除列表缓存，让下次读取时重新从数据库加载完整列表
    cacheService.delete(PORTFOLIOS_CACHE_KEY);
    // 设置单个投资组合的缓存
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
    cacheService.set(cacheKey, newPortfolio, CACHE_TTL);

    console.log(
      `[storage.prisma] 成功创建投资组合: ${newPortfolio.name} (${portfolioId})`
    );
    return newPortfolio;
  } catch (error) {
    console.error('[storage.prisma] 创建投资组合失败:', error);
    throw error;
  }
}

export async function deletePortfolio(portfolioId: string): Promise<boolean> {
  try {
    await prisma.portfolio.delete({ where: { id: portfolioId } });
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
    cacheService.delete(cacheKey);
    cacheService.delete(PORTFOLIOS_CACHE_KEY);
    return true;
  } catch (error) {
    console.error(`[storage.prisma] 删除投资组合 ${portfolioId} 失败:`, error);
    return false;
  }
}

// ============ 交易相关函数（复用 legacy 逻辑）============

import {
  cashRecalculateForPortfolioAsync as legacyCashRecalculate,
  correctHistoricalTransactionAmounts as legacyCorrectHistory,
} from './storage.legacy';

export async function addTransactionToPortfolio(
  portfolioId: string,
  transactionData: Omit<Transaction, 'id'>
): Promise<Transaction | null> {
  const portfolio = await getPortfolioById(portfolioId);
  if (!portfolio) return null;

  // 确保所有数值字段都是 number 类型，防止 Decimal 对象导致的字符串拼接问题
  const normalizedData = {
    ...transactionData,
    quantity:
      transactionData.quantity !== undefined &&
      transactionData.quantity !== null
        ? Number(transactionData.quantity)
        : undefined,
    price:
      transactionData.price !== undefined && transactionData.price !== null
        ? Number(transactionData.price)
        : undefined,
    amount:
      transactionData.amount !== undefined && transactionData.amount !== null
        ? Number(transactionData.amount)
        : undefined,
    commission:
      transactionData.commission !== undefined &&
      transactionData.commission !== null
        ? Number(transactionData.commission)
        : undefined,
    leverageUsed:
      transactionData.leverageUsed !== undefined &&
      transactionData.leverageUsed !== null
        ? Number(transactionData.leverageUsed)
        : undefined,
    exchangeRate:
      transactionData.exchangeRate !== undefined &&
      transactionData.exchangeRate !== null
        ? Number(transactionData.exchangeRate)
        : undefined,
  };

  const newTransaction: Transaction = {
    ...normalizedData,
    id: uuidv4(),
  };

  const amount =
    normalizedData.amount ??
    (normalizedData.quantity ?? 0) * (normalizedData.price ?? 0);
  const commission = normalizedData.commission ?? 0;

  switch (normalizedData.type) {
    case TransactionType.BUY: {
      const { getExchangeRateForAssetToCNY } = await import(
        '../providers/currency-service'
      );
      const originalQuantity = normalizedData.quantity ?? 0;
      const originalPrice = normalizedData.price ?? 0;
      const originalCommission = normalizedData.commission ?? 0;
      const originalTotalCost = originalQuantity * originalPrice;
      const originalLeverageUsed = normalizedData.leverageUsed ?? 0;

      let exchangeRate = 1.0;
      if (normalizedData.assetCode) {
        const isForeign =
          normalizedData.assetCode.toLowerCase().startsWith('hk') ||
          normalizedData.assetCode.toLowerCase().startsWith('us');
        if (isForeign) {
          try {
            exchangeRate = await getExchangeRateForAssetToCNY(
              normalizedData.assetCode
            );
          } catch (error) {
            console.error(
              `[storage.prisma BUY] Failed to get exchange rate for ${normalizedData.assetCode}:`,
              error
            );
            return null;
          }
        }
      }

      const totalCostCNY = originalTotalCost * exchangeRate;
      const commissionCNY = originalCommission * exchangeRate;
      const leverageUsedCNY = originalLeverageUsed * exchangeRate;

      if (portfolio.cash >= commissionCNY) {
        portfolio.cash -= commissionCNY;
      } else {
        const feeShortfall = commissionCNY - portfolio.cash;
        if (portfolio.leverage.availableAmount >= feeShortfall) {
          portfolio.cash = 0;
          portfolio.leverage.usedAmount += feeShortfall;
          portfolio.leverage.availableAmount -= feeShortfall;
        } else {
          console.error(
            'Insufficient funds and leverage to cover transaction fee.'
          );
          return null;
        }
      }

      const useLeverage = originalLeverageUsed > epsilon;
      if (useLeverage) {
        if (leverageUsedCNY < -epsilon) {
          console.error('leverageUsed (CNY) must be >= 0');
          return null;
        }
        if (leverageUsedCNY > portfolio.leverage.availableAmount + epsilon) {
          console.error(
            `融资额度不足 (CNY)。需要: ${leverageUsedCNY.toFixed(2)}, 可用: ${portfolio.leverage.availableAmount.toFixed(2)}`
          );
          return null;
        }
        const needCash = totalCostCNY - leverageUsedCNY;
        if (needCash < -epsilon) {
          console.error(
            `计算错误：需要支付的现金部分远小于零 (needCash: ${needCash.toFixed(8)})`
          );
          return null;
        }
        if (needCash > portfolio.cash + epsilon) {
          console.error(
            `现金余额不足 (CNY)。需要: ${needCash.toFixed(2)}, 可用: ${portfolio.cash.toFixed(2)}`
          );
          return null;
        }
        portfolio.leverage.usedAmount += leverageUsedCNY;
        portfolio.leverage.availableAmount -= leverageUsedCNY;
        portfolio.cash -= Math.max(0, needCash);
      } else {
        if (portfolio.cash >= totalCostCNY) {
          portfolio.cash -= totalCostCNY;
        } else {
          const neededLeverageCNY = totalCostCNY - portfolio.cash;
          if (portfolio.leverage.availableAmount >= neededLeverageCNY) {
            portfolio.leverage.usedAmount += neededLeverageCNY;
            portfolio.leverage.availableAmount -= neededLeverageCNY;
            portfolio.cash = 0;
          } else {
            console.error('Insufficient funds and leverage for trade cost.');
            return null;
          }
        }
      }

      newTransaction.amount = totalCostCNY + commissionCNY;
      newTransaction.exchangeRate = exchangeRate;
      if (normalizedData.currency) {
        newTransaction.currency = normalizedData.currency;
      }
      newTransaction.leverageUsed =
        originalLeverageUsed > epsilon ? originalLeverageUsed : undefined;
      break;
    }

    case TransactionType.SELL: {
      // 🔄 添加汇率换算逻辑（与BUY保持一致）
      const { getExchangeRateForAssetToCNY } = await import(
        '../providers/currency-service'
      );

      let exchangeRate = 1.0;
      if (normalizedData.assetCode) {
        const isForeign =
          normalizedData.assetCode.toLowerCase().startsWith('hk') ||
          normalizedData.assetCode.toLowerCase().startsWith('us');
        if (isForeign) {
          try {
            exchangeRate = await getExchangeRateForAssetToCNY(
              normalizedData.assetCode
            );
            console.log(
              `[storage.prisma SELL] Fetched exchange rate for ${normalizedData.assetCode}: ${exchangeRate}`
            );
          } catch (error) {
            console.error(
              `[storage.prisma SELL] Failed to get exchange rate for ${normalizedData.assetCode}:`,
              error
            );
            return null;
          }
        }
      }

      // 将卖出收入换算成CNY
      const amountCNY = amount * exchangeRate;
      const commissionCNY = commission * exchangeRate;
      const netAmountCNY = amountCNY - commissionCNY;

      console.log(
        `[storage.prisma SELL] Asset: ${normalizedData.assetCode}, Original Amount: ${amount}, Exchange Rate: ${exchangeRate}, Amount CNY: ${amountCNY.toFixed(2)}, Net CNY: ${netAmountCNY.toFixed(2)}`
      );

      if (portfolio.leverage.usedAmount > 0) {
        const repayAmount = Math.min(
          netAmountCNY,
          portfolio.leverage.usedAmount
        );
        portfolio.leverage.usedAmount -= repayAmount;
        portfolio.leverage.availableAmount += repayAmount;
        portfolio.cash += netAmountCNY - repayAmount;
      } else {
        portfolio.cash += netAmountCNY;
      }

      // 保存换算后的金额和汇率
      newTransaction.amount = amountCNY;
      newTransaction.exchangeRate = exchangeRate;
      if (normalizedData.currency) {
        newTransaction.currency = normalizedData.currency;
      }
      console.log(
        `[storage.prisma SELL] Currency: ${newTransaction.currency ?? 'CNY'}, Saving exchange rate: ${exchangeRate}`
      );
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

    case TransactionType.DIVIDEND: {
      // 🔄 添加汇率换算逻辑（与SELL保持一致）
      const { getExchangeRateForAssetToCNY } = await import(
        '../providers/currency-service'
      );

      let exchangeRate = 1.0;
      if (normalizedData.assetCode) {
        const isForeign =
          normalizedData.assetCode.toLowerCase().startsWith('hk') ||
          normalizedData.assetCode.toLowerCase().startsWith('us');
        if (isForeign) {
          try {
            exchangeRate = await getExchangeRateForAssetToCNY(
              normalizedData.assetCode
            );
            console.log(
              `[storage.prisma DIVIDEND] Asset: ${normalizedData.assetCode}, Is Foreign: ${isForeign}, Exchange Rate: ${exchangeRate}`
            );
          } catch (error) {
            console.error(
              `[storage.prisma DIVIDEND] Failed to get exchange rate for ${normalizedData.assetCode}:`,
              error
            );
            return null;
          }
        }
      }

      // 将股息换算成CNY
      const amountCNY = amount * exchangeRate;
      portfolio.cash += amountCNY;

      // 保存换算后的金额和汇率
      newTransaction.amount = amountCNY;
      newTransaction.exchangeRate = exchangeRate;
      if (normalizedData.currency) {
        newTransaction.currency = normalizedData.currency;
      }

      console.log(
        `[storage.prisma DIVIDEND] Original Amount: ${amount}, Rate: ${exchangeRate}, Amount CNY: ${amountCNY.toFixed(2)}`
      );
      console.log(
        `[storage.prisma DIVIDEND] Currency: ${newTransaction.currency ?? 'CNY'}, Saving exchange rate: ${exchangeRate}`
      );
      break;
    }

    case TransactionType.LEVERAGE_ADD:
      portfolio.leverage.totalAmount += amount;
      portfolio.leverage.availableAmount += amount;
      break;

    case TransactionType.LEVERAGE_REMOVE:
      if (portfolio.leverage.availableAmount >= amount) {
        portfolio.leverage.totalAmount -= amount;
        portfolio.leverage.availableAmount -= amount;
      } else {
        console.error(
          'Cannot remove leverage: amount exceeds available leverage'
        );
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

    default: {
      const exhaustiveCheck: never = normalizedData.type;
      console.warn(`Unhandled transaction type: ${exhaustiveCheck}`);
      return null;
    }
  }

  portfolio.transactions.push(newTransaction);

  // 更新数据库和缓存
  try {
    await prisma.$transaction(async (tx) => {
      // 如果有资产代码，确保Asset记录存在
      if (newTransaction.assetCode) {
        const assetCode = newTransaction.assetCode;
        // 尝试查找资产
        const existingAsset = await tx.asset.findUnique({
          where: { code: assetCode },
        });

        // 如果不存在，创建资产记录
        if (!existingAsset) {
          // 从资产代码推断市场
          let market: 'CN' | 'HK' | 'US' = 'CN';
          const lowerCode = assetCode.toLowerCase();
          if (lowerCode.startsWith('hk')) {
            market = 'HK';
          } else if (lowerCode.startsWith('us')) {
            market = 'US';
          } else if (lowerCode.startsWith('sh') || lowerCode.startsWith('sz')) {
            market = 'CN';
          }

          await tx.asset.create({
            data: {
              code: assetCode,
              name: assetCode, // 默认使用代码作为名称
              market: market,
            },
          });
          console.log(
            `[storage.prisma] 自动创建资产记录: ${assetCode} (${market})`
          );
        }
      }

      // 更新投资组合的现金和杠杆信息
      await tx.portfolio.update({
        where: { id: portfolioId },
        data: {
          cash: toDecimal(portfolio.cash),
          leverageTotalAmount: toDecimal(portfolio.leverage.totalAmount),
          leverageUsedAmount: toDecimal(portfolio.leverage.usedAmount),
          leverageAvailableAmount: toDecimal(
            portfolio.leverage.availableAmount
          ),
          leverageCostRate: toDecimal(portfolio.leverage.costRate),
        },
      });

      // 创建新交易记录
      console.log(
        `[storage.prisma DB Save] Transaction data:`,
        {
          type: newTransaction.type,
          assetCode: newTransaction.assetCode,
          currency: newTransaction.currency ?? 'CNY',
          exchangeRate: newTransaction.exchangeRate,
          amount: newTransaction.amount
        }
      );
      await tx.transaction.create({
        data: {
          id: newTransaction.id,
          portfolioId: portfolio.id,
          type: newTransaction.type,
          date: new Date(newTransaction.date),
          assetCode: newTransaction.assetCode ?? null,
          quantity: newTransaction.quantity
            ? toDecimal(newTransaction.quantity)
            : null,
          price: newTransaction.price ? toDecimal(newTransaction.price) : null,
          amount: newTransaction.amount
            ? toDecimal(newTransaction.amount)
            : null,
          commission: newTransaction.commission
            ? toDecimal(newTransaction.commission)
            : null,
          leverageUsed: newTransaction.leverageUsed
            ? toDecimal(newTransaction.leverageUsed)
            : null,
          currency: newTransaction.currency ?? 'CNY',
          exchangeRate: newTransaction.exchangeRate
            ? toDecimal(newTransaction.exchangeRate)
            : null,
          notes: newTransaction.notes ?? null,
        },
      });
    });

    // 更新缓存
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
    cacheService.set(cacheKey, portfolio, CACHE_TTL);
    // 清除列表缓存，确保下次获取时重新加载
    cacheService.delete(PORTFOLIOS_CACHE_KEY);

    console.log(
      `[storage.prisma] 成功添加交易记录 ${newTransaction.id} 到投资组合 ${portfolioId}`
    );
    return newTransaction;
  } catch (error) {
    console.error(`[storage.prisma] 添加交易记录失败:`, error);
    throw error;
  }
}

export async function deleteTransactionFromPortfolio(
  portfolioId: string,
  transactionId: string
): Promise<boolean> {
  const portfolio = await getPortfolioById(portfolioId);
  if (!portfolio) return false;

  const transactionIndex = portfolio.transactions.findIndex(
    (t) => t.id === transactionId
  );
  if (transactionIndex === -1) return false;

  const transactionToDelete = portfolio.transactions[transactionIndex];
  const amount =
    transactionToDelete.amount ??
    (transactionToDelete.quantity ?? 0) * (transactionToDelete.price ?? 0);

  switch (transactionToDelete.type) {
    case TransactionType.BUY: {
      const commission = transactionToDelete.commission ?? 0;
      if (portfolio.leverage.usedAmount > 0) {
        const leverageToReturn = Math.min(
          amount,
          portfolio.leverage.usedAmount
        );
        portfolio.leverage.usedAmount -= leverageToReturn;
        portfolio.leverage.availableAmount += leverageToReturn;
        portfolio.cash += amount - leverageToReturn + commission;
      } else {
        portfolio.cash += amount + commission;
      }
      break;
    }
    case TransactionType.SELL: {
      // 🔄 添加汇率换算逻辑（撤销卖出交易）
      const { getExchangeRateForAssetToCNY } = await import(
        '../providers/currency-service'
      );

      let exchangeRate = 1.0;
      if (transactionToDelete.assetCode) {
        const isForeign =
          transactionToDelete.assetCode.toLowerCase().startsWith('hk') ||
          transactionToDelete.assetCode.toLowerCase().startsWith('us');
        if (isForeign) {
          try {
            exchangeRate = await getExchangeRateForAssetToCNY(
              transactionToDelete.assetCode
            );
          } catch (error) {
            console.error(
              `[storage.prisma Delete SELL] Failed to get exchange rate for ${transactionToDelete.assetCode}:`,
              error
            );
            // 即使汇率获取失败，也继续处理，使用默认汇率1
          }
        }
      }

      const commission = transactionToDelete.commission ?? 0;
      const amountCNY = amount * exchangeRate;
      const commissionCNY = commission * exchangeRate;
      const netAmountCNY = amountCNY - commissionCNY;

      if (portfolio.cash >= netAmountCNY) {
        portfolio.cash -= netAmountCNY;
      } else {
        const neededLeverage = netAmountCNY - portfolio.cash;
        if (portfolio.leverage.availableAmount >= neededLeverage) {
          portfolio.leverage.usedAmount += neededLeverage;
          portfolio.leverage.availableAmount -= neededLeverage;
          portfolio.cash = 0;
        } else {
          console.error(
            'Cannot reverse sell transaction: insufficient funds and leverage'
          );
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
        console.error(
          'Cannot reverse leverage add: amount exceeds total leverage'
        );
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

    case TransactionType.DIVIDEND: {
      // 🔄 添加汇率换算逻辑（撤销股息交易）
      const { getExchangeRateForAssetToCNY } = await import(
        '../providers/currency-service'
      );

      let exchangeRate = 1.0;
      if (transactionToDelete.assetCode) {
        const isForeign =
          transactionToDelete.assetCode.toLowerCase().startsWith('hk') ||
          transactionToDelete.assetCode.toLowerCase().startsWith('us');
        if (isForeign) {
          try {
            exchangeRate = await getExchangeRateForAssetToCNY(
              transactionToDelete.assetCode
            );
            console.log(
              `[storage.prisma Delete DIVIDEND] Fetched exchange rate for ${transactionToDelete.assetCode}: ${exchangeRate}`
            );
          } catch (error) {
            console.error(
              `[storage.prisma Delete DIVIDEND] Failed to get exchange rate for ${transactionToDelete.assetCode}:`,
              error
            );
            // 即使汇率获取失败，也继续处理，使用默认汇率1
          }
        }
      }

      const amountCNY = amount * exchangeRate;
      if (portfolio.cash >= amountCNY) {
        portfolio.cash -= amountCNY;
      } else {
        console.error(
          `[storage.prisma Delete DIVIDEND] Reversing dividend would result in negative cash.`
        );
        portfolio.cash -= amountCNY;
      }

      console.log(
        `[storage.prisma Delete DIVIDEND] Reversed dividend: Original Amount: ${amount}, Rate: ${exchangeRate}, Amount CNY: ${amountCNY.toFixed(2)}`
      );
      break;
    }

    default: {
      const exhaustiveCheck: never = transactionToDelete.type;
      console.warn(
        `Unhandled transaction type for deletion: ${exhaustiveCheck}`
      );
      return false;
    }
  }

  portfolio.transactions.splice(transactionIndex, 1);

  // 更新数据库和缓存
  try {
    await prisma.$transaction(async (tx) => {
      // 删除交易记录
      await tx.transaction.delete({
        where: { id: transactionId },
      });

      // 更新投资组合的现金和杠杆信息
      await tx.portfolio.update({
        where: { id: portfolioId },
        data: {
          cash: toDecimal(portfolio.cash),
          leverageTotalAmount: toDecimal(portfolio.leverage.totalAmount),
          leverageUsedAmount: toDecimal(portfolio.leverage.usedAmount),
          leverageAvailableAmount: toDecimal(
            portfolio.leverage.availableAmount
          ),
          leverageCostRate: toDecimal(portfolio.leverage.costRate),
        },
      });
    });

    // 更新缓存
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
    cacheService.set(cacheKey, portfolio, CACHE_TTL);
    // 清除列表缓存，确保下次获取时重新加载
    cacheService.delete(PORTFOLIOS_CACHE_KEY);

    console.log(
      `[storage.prisma] 成功删除交易记录 ${transactionId} 从投资组合 ${portfolioId}`
    );
    return true;
  } catch (error) {
    console.error(`[storage.prisma] 删除交易记录失败:`, error);
    return false;
  }
}

export async function cashRecalculateForPortfolioAsync(
  portfolio: Portfolio
): Promise<{
  cash: number;
  diff: number;
  steps: Array<{
    txId: string;
    type: string;
    before: number;
    after: number;
    expected: number;
  }>;
}> {
  return legacyCashRecalculate(portfolio);
}

export async function correctHistoricalTransactionAmounts(): Promise<void> {
  return legacyCorrectHistory();
}

/**
 * 更新交易记录的备注
 */
export async function updateTransactionNotes(
  portfolioId: string,
  transactionId: string,
  notes: string
): Promise<Transaction | null> {
  try {
    // 更新数据库中的交易备注
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: { notes },
    });

    // 清除相关缓存
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
    cacheService.delete(cacheKey);
    cacheService.delete(PORTFOLIOS_CACHE_KEY);

    console.log(`[storage.prisma] 成功更新交易 ${transactionId} 的备注`);

    return mapTransactionEntity(updatedTransaction);
  } catch (error) {
    console.error(`[storage.prisma] 更新交易备注失败:`, error);
    return null;
  }
}

/**
 * 更新投资组合的注意信息
 */
export async function updatePortfolioAttention(
  portfolioId: string,
  attentionInfo: string
): Promise<Portfolio | null> {
  try {
    // 更新数据库中的注意信息
    const updatedPortfolio = await prisma.portfolio.update({
      where: { id: portfolioId },
      data: { attentionInfo },
      include: {
        transactions: {
          orderBy: { date: 'asc' }, // 按日期升序排序
        },
      },
    });

    // 更新缓存
    const portfolio = mapPortfolioEntity(updatedPortfolio);
    const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${portfolioId}`;
    cacheService.set(cacheKey, portfolio, CACHE_TTL);
    cacheService.delete(PORTFOLIOS_CACHE_KEY);

    console.log(`[storage.prisma] 成功更新投资组合 ${portfolioId} 的注意信息`);

    return portfolio;
  } catch (error) {
    console.error(`[storage.prisma] 更新注意信息失败:`, error);
    return null;
  }
}
