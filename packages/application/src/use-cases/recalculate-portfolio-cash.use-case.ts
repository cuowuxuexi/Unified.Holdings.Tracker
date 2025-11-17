import { Portfolio, PortfolioRepository } from '@uht/domain';
import { UseCase } from '../types';

export interface RecalculatePortfolioCashInput {
  portfolioId: string;
}

export class RecalculatePortfolioCashUseCase
  implements UseCase<RecalculatePortfolioCashInput, Portfolio>
{
  constructor(private readonly repository: PortfolioRepository) {}

  execute(input: RecalculatePortfolioCashInput): Promise<Portfolio> {
    return this.repository.recalculateCash(input.portfolioId);
  }
}
