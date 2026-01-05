import {
  Portfolio,
  PortfolioRepository,
  CreatePortfolioInput,
  ensureLeverageInfo,
} from '@uht/domain';
import { UseCase } from '../types';

export class CreatePortfolioUseCase
  implements UseCase<CreatePortfolioInput, Portfolio>
{
  constructor(private readonly repository: PortfolioRepository) {}

  execute(input: CreatePortfolioInput): Promise<Portfolio> {
    const normalizedInput: CreatePortfolioInput = {
      ...input,
      leverage: ensureLeverageInfo(input.leverage),
    };
    return this.repository.create(normalizedInput);
  }
}
