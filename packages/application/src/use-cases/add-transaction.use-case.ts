import {
  Portfolio,
  PortfolioRepository,
  NewTransactionInput,
} from '@uht/domain';
import { UseCase } from '../types';

export interface AddTransactionInput {
  portfolioId: string;
  transaction: NewTransactionInput;
}

export class AddTransactionUseCase
  implements UseCase<AddTransactionInput, Portfolio>
{
  constructor(private readonly repository: PortfolioRepository) {}

  execute(input: AddTransactionInput): Promise<Portfolio> {
    return this.repository.addTransaction(input.portfolioId, input.transaction);
  }
}
