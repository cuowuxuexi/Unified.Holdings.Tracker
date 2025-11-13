import {
  Portfolio,
  PortfolioRepository,
} from '@uht/domain';
import { UseCase } from '../types';

export interface UpdatePortfolioAttentionInput {
  portfolioId: string;
  attentionInfo: string;
}

export class UpdatePortfolioAttentionUseCase
  implements UseCase<UpdatePortfolioAttentionInput, Portfolio | null>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async execute(input: UpdatePortfolioAttentionInput): Promise<Portfolio | null> {
    // 基本验证
    if (!input.portfolioId) {
      throw new Error('Portfolio ID is required');
    }

    // 验证投资组合是否存在
    const portfolio = await this.repository.findById(input.portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${input.portfolioId} not found`);
    }

    // 调用仓储更新注意信息
    if (!this.repository.updatePortfolioAttention) {
      throw new Error('updatePortfolioAttention not implemented in repository');
    }

    return this.repository.updatePortfolioAttention(
      input.portfolioId,
      input.attentionInfo
    );
  }
}

