import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/api';

export function usePortfolioStats(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['portfolio-stats', portfolioId],
    queryFn: () => {
      if (!portfolioId) {
        throw new Error('portfolioId is required');
      }
      return apiClient.fetchPortfolioStats(portfolioId);
    },
    enabled: Boolean(portfolioId),
    staleTime: 30 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: undefined,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
