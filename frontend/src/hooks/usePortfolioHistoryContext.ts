import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/api';

export function usePortfolioHistoryContext(
  portfolioId: string | null | undefined,
  year: number,
  date?: string
) {
  return useQuery({
    queryKey: ['portfolio-history-context', portfolioId, year, date ?? null],
    queryFn: () => {
      if (!portfolioId) {
        throw new Error('portfolioId is required');
      }
      return apiClient.fetchPortfolioHistoryContext(portfolioId, {
        year,
        date,
      });
    },
    enabled: Boolean(portfolioId && year),
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
