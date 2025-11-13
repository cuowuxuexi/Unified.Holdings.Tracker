import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/api';

export function usePortfolios() {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: () => apiClient.fetchPortfolios(),
  });
}

export function usePortfolio(id: string | null) {
  return useQuery({
    queryKey: ['portfolio', id],
    queryFn: () => {
      if (!id) throw new Error('Portfolio ID is required');
      return apiClient.fetchPortfolioDetail(id);
    },
    enabled: !!id,
  });
}

export function useCreatePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      cash: number;
      leverageInfo?: {
        totalCredit: number;
        usedCredit: number;
        availableCredit: number;
        interestRate: number;
      };
    }) => apiClient.createPortfolio(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function useDeletePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deletePortfolio(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

