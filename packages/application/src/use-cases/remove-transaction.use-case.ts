import { Portfolio, PortfolioRepository } from '@uht/domain';
import { UseCase } from '../types';

export interface RemoveTransactionInput {
  portfolioId: string;
  transactionId: string;
}

export class RemoveTransactionUseCase
  implements UseCase<RemoveTransactionInput, Portfolio>
{
  constructor(private readonly repository: PortfolioRepository) {}

  execute(input: RemoveTransactionInput): Promise<Portfolio> {
    return this.repository.removeTransaction(
      input.portfolioId,
      input.transactionId
    );
  }
}
