import {
  Transaction,
  PortfolioRepository,
} from '@uht/domain';
import { UseCase } from '../types';

export interface UpdateTransactionNotesInput {
  portfolioId: string;
  transactionId: string;
  notes: string;
}

export class UpdateTransactionNotesUseCase
  implements UseCase<UpdateTransactionNotesInput, Transaction | null>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async execute(input: UpdateTransactionNotesInput): Promise<Transaction | null> {
    // 基本验证
    if (!input.portfolioId || !input.transactionId) {
      throw new Error('Portfolio ID and Transaction ID are required');
    }

    // 验证投资组合是否存在
    const portfolio = await this.repository.findById(input.portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${input.portfolioId} not found`);
    }

    // 验证交易是否属于该投资组合
    const transaction = portfolio.transactions.find(
      (t) => t.id === input.transactionId
    );
    if (!transaction) {
      throw new Error(
        `Transaction ${input.transactionId} not found in portfolio ${input.portfolioId}`
      );
    }

    // 调用仓储更新备注
    if (!this.repository.updateTransactionNotes) {
      throw new Error('updateTransactionNotes not implemented in repository');
    }

    return this.repository.updateTransactionNotes(
      input.portfolioId,
      input.transactionId,
      input.notes
    );
  }
}

