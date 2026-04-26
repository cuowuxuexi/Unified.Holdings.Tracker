import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TransactionInput } from '../../generated/api';
import apiClient from '../../services/api';

export function useTransactions(portfolioId: string | null) {
  return useQuery({
    queryKey: ['transactions', portfolioId],
    queryFn: async () => {
      if (!portfolioId) throw new Error('Portfolio ID is required');
      const portfolio = await apiClient.fetchPortfolioDetail(portfolioId);
      return portfolio?.transactions || [];
    },
    enabled: !!portfolioId,
  });
}

export function useAddTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      portfolioId,
      transaction,
    }: {
      portfolioId: string;
      transaction: TransactionInput;
    }) => apiClient.addTransaction(portfolioId, transaction),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['transactions', variables.portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ['portfolio', variables.portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ['portfolio-stats', variables.portfolioId],
      });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      portfolioId,
      txId,
    }: {
      portfolioId: string;
      txId: string;
    }) => apiClient.deleteTransaction(portfolioId, txId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['transactions', variables.portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ['portfolio', variables.portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ['portfolio-stats', variables.portfolioId],
      });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}
