import { useQuery } from '@tanstack/react-query';
import apiClient from '../../services/api';

export function usePortfolioStats(portfolioId: string | null) {
  return useQuery({
    queryKey: ['portfolio-stats', portfolioId],
    queryFn: () => {
      if (!portfolioId) throw new Error('Portfolio ID is required');
      return apiClient.fetchPortfolioStats(portfolioId);
    },
    enabled: !!portfolioId,
  });
}

