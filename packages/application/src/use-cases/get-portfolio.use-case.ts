import { Portfolio, PortfolioRepository } from '@uht/domain';
import { UseCase } from '../types';

export interface GetPortfolioInput {
  portfolioId: string;
}

export class GetPortfolioUseCase
  implements UseCase<GetPortfolioInput, Portfolio | null>
{
  constructor(private readonly repository: PortfolioRepository) {}

  execute(input: GetPortfolioInput): Promise<Portfolio | null> {
    return this.repository.findById(input.portfolioId);
  }
}
