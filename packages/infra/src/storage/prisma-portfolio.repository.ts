import {
  Portfolio,
  Transaction,
  PortfolioRepository,
  CreatePortfolioInput,
  NewTransactionInput,
  ensureLeverageInfo,
} from '@uht/domain';
import {
  readPortfolios,
  getPortfolioById,
  addPortfolio,
  deletePortfolio,
  addTransactionToPortfolio,
  deleteTransactionFromPortfolio,
  cashRecalculateForPortfolioAsync,
  correctHistoricalTransactionAmounts,
  updateTransactionNotes,
  updatePortfolioAttention,
} from './storage.prisma';

/**
 * Prisma 实现的 PortfolioRepository
 * 适配 storage.prisma.ts 中的函数以符合领域层接口
 */
export class PrismaPortfolioRepository implements PortfolioRepository {
  async findAll(): Promise<Portfolio[]> {
    return readPortfolios();
  }

  async findById(id: string): Promise<Portfolio | null> {
    return getPortfolioById(id);
  }

  async create(input: CreatePortfolioInput): Promise<Portfolio> {
    return addPortfolio({
      name: input.name,
      initialCash: input.initialCash,
      leverage: ensureLeverageInfo(input.leverage),
    });
  }

  async save(portfolio: Portfolio): Promise<void> {
    // 注意：当前 storage.prisma 没有直接的 save 方法
    // 这里需要使用 writePortfolios，但这个方法接受 Portfolio[]
    // 为了简化，我们暂时不实现这个方法，因为当前流程主要使用其他方法
    throw new Error(
      'save method not implemented yet. Use specific methods like addTransaction instead.'
    );
  }

  async delete(id: string): Promise<void> {
    const success = await deletePortfolio(id);
    if (!success) {
      throw new Error(`Failed to delete portfolio ${id}`);
    }
  }

  async addTransaction(
    portfolioId: string,
    transaction: NewTransactionInput
  ): Promise<Portfolio> {
    const result = await addTransactionToPortfolio(portfolioId, transaction);
    if (!result) {
      throw new Error(`Failed to add transaction to portfolio ${portfolioId}`);
    }

    // 添加交易后，重新获取完整的 Portfolio 对象
    const portfolio = await getPortfolioById(portfolioId);
    if (!portfolio) {
      throw new Error(
        `Portfolio ${portfolioId} not found after adding transaction`
      );
    }
    return portfolio;
  }

  async removeTransaction(
    portfolioId: string,
    transactionId: string
  ): Promise<Portfolio> {
    const success = await deleteTransactionFromPortfolio(
      portfolioId,
      transactionId
    );
    if (!success) {
      throw new Error(
        `Failed to remove transaction ${transactionId} from portfolio ${portfolioId}`
      );
    }

    // 删除交易后，重新获取完整的 Portfolio 对象
    const portfolio = await getPortfolioById(portfolioId);
    if (!portfolio) {
      throw new Error(
        `Portfolio ${portfolioId} not found after removing transaction`
      );
    }
    return portfolio;
  }

  async recalculateCash(portfolioId: string): Promise<Portfolio> {
    const portfolio = await getPortfolioById(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }

    // 执行现金重算
    await cashRecalculateForPortfolioAsync(portfolio);

    // 重新获取更新后的 Portfolio
    const updatedPortfolio = await getPortfolioById(portfolioId);
    if (!updatedPortfolio) {
      throw new Error(`Portfolio ${portfolioId} not found after recalculation`);
    }
    return updatedPortfolio;
  }

  async correctHistoricalTransactions(): Promise<void> {
    await correctHistoricalTransactionAmounts();
  }

  async updateTransactionNotes(
    portfolioId: string,
    transactionId: string,
    notes: string
  ): Promise<Transaction | null> {
    return updateTransactionNotes(portfolioId, transactionId, notes);
  }

  async updatePortfolioAttention(
    portfolioId: string,
    attentionInfo: string
  ): Promise<Portfolio | null> {
    return updatePortfolioAttention(portfolioId, attentionInfo);
  }
}
