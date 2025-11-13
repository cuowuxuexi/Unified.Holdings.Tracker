import { Portfolio, PortfolioRepository } from '@uht/domain';
import { UseCase } from '../types';

export class ListPortfoliosUseCase implements UseCase<void, Portfolio[]> {
  constructor(private readonly repository: PortfolioRepository) {}

  async execute(): Promise<Portfolio[]> {
    return this.repository.findAll();
  }
}
