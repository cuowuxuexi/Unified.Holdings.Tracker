import { create } from 'zustand';
import {
  AppState,
  Quote,
  TransactionInput,
  PortfolioInput,
  SelectedIndexItem,
  MarketConfig,
  IndexCategory,
  WatchlistPayload,
} from './types';
import apiClient from '../services/api'; // Import the API client
import { queryClient } from '../app/providers/queryClient';
import {
  decideWatchlistHydrate,
  getSavedIndexCategories,
  getSavedIndicesOrder,
  getSavedMarketConfigs,
  readLocalWatchlist,
  writeLocalWatchlist,
} from './watchlistSync';
import { normalizeSelectedIndexRows } from './watchlistLayout';

let watchlistPersistTimer: ReturnType<typeof setTimeout> | null = null;

const persistWatchlist = (payload: WatchlistPayload) => {
  writeLocalWatchlist(payload);
  if (watchlistPersistTimer) {
    clearTimeout(watchlistPersistTimer);
  }
  watchlistPersistTimer = setTimeout(() => {
    apiClient.saveWatchlistPreference(payload).catch((error) => {
      console.error('Failed to persist watchlist to server:', error);
    });
  }, 400);
};

// REMOVED: Helper function findClosestTradingDayClose is no longer needed as calculations are done in backend
/*
const findClosestTradingDayClose = (klineData: KlinePoint[], targetDateStr: string): number | null => {
  // ... (removed implementation) ...
*/

const useAppStore = create<AppState>((set, get) => ({
  // Added get to access state within actions
  // Market Indices State (Task 7.2)
  marketIndicesData: [],
  isLoadingMarketIndices: false,
  marketIndicesError: null,
  selectedIndices: getSavedIndicesOrder(), // 从本地存储获取对象数组

  // Index Categories State
  indexCategories: getSavedIndexCategories(), // 从本地存储获取指数分类

  // Market Configuration State
  marketConfigs: getSavedMarketConfigs(), // 从本地存储获取市场配置

  // Original state
  marketIndices: [], // Keep original for now, might deprecate
  stockQuotes: {},
  klineData: {},

  // Portfolio State
  portfolios: [],
  selectedPortfolioId: null,
  selectedPortfolioDetail: null,
  isLoadingPortfolios: false,
  isLoadingPortfolioDetail: false,
  portfolioError: null,

  // --- Actions ---
  fetchMarketIndices: async () => {
    set({ isLoadingMarketIndices: true, marketIndicesError: null });
    const selectedIndices = get().selectedIndices; // Get indices from state

    try {
      // Only fetch quotes, as the backend now includes calculated percentages
      const quotes = await apiClient.fetchQuotes(
        selectedIndices.map((item) => item.code)
      );

      // The Quote type from the backend should already include:
      // yearlyChangePercent?: number;

      // Map the received quotes directly to the CombinedIndexData structure
      // No need for frontend recalculations
      console.log('[fetchMarketIndices] Processing quotes data:', quotes);

      set({ marketIndicesData: quotes, isLoadingMarketIndices: false });
    } catch (error) {
      console.error('Error fetching market indices data in store:', error);
      set({
        marketIndicesError: 'Failed to fetch market indices data',
        isLoadingMarketIndices: false,
        marketIndicesData: [],
      }); // Clear data on error
    }
  },

  setSelectedIndices: (indices: SelectedIndexItem[]) => {
    if (
      Array.isArray(indices) &&
      indices.every((item) => typeof item === 'object' && item.code)
    ) {
      const next = normalizeSelectedIndexRows(indices);
      set({ selectedIndices: next });
      persistWatchlist({
        selectedIndices: next,
        indexCategories: get().indexCategories,
        marketConfigs: get().marketConfigs,
      });
    } else {
      console.error('setSelectedIndices received invalid data:', indices);
    }
  },

  setMarketConfigs: (configs: MarketConfig[]) => {
    if (
      Array.isArray(configs) &&
      configs.every((item) => typeof item === 'object' && item.key)
    ) {
      set({ marketConfigs: configs });
      persistWatchlist({
        selectedIndices: get().selectedIndices,
        indexCategories: get().indexCategories,
        marketConfigs: configs,
      });
    } else {
      console.error('setMarketConfigs received invalid data:', configs);
    }
  },

  // Index Categories Actions
  setIndexCategories: (categories: IndexCategory[]) => {
    if (
      Array.isArray(categories) &&
      categories.every((item) => typeof item === 'object' && item.id)
    ) {
      set({ indexCategories: categories });
      persistWatchlist({
        selectedIndices: get().selectedIndices,
        indexCategories: categories,
        marketConfigs: get().marketConfigs,
      });
    } else {
      console.error('setIndexCategories received invalid data:', categories);
    }
  },

  addIndexCategory: (category: Omit<IndexCategory, 'id' | 'order'>) => {
    const currentCategories = get().indexCategories;
    const newId = `category_${Date.now()}`;
    const newOrder =
      currentCategories.length > 0
        ? Math.max(...currentCategories.map((c) => c.order)) + 1
        : 0;
    const newCategory: IndexCategory = {
      ...category,
      id: newId,
      order: newOrder,
    };
    const updatedCategories = [...currentCategories, newCategory];
    set({ indexCategories: updatedCategories });
    persistWatchlist({
      selectedIndices: get().selectedIndices,
      indexCategories: updatedCategories,
      marketConfigs: get().marketConfigs,
    });
  },

  updateIndexCategory: (id: string, updates: Partial<IndexCategory>) => {
    const currentCategories = get().indexCategories;
    const updatedCategories = currentCategories.map((cat) =>
      cat.id === id ? { ...cat, ...updates } : cat
    );
    set({ indexCategories: updatedCategories });
    persistWatchlist({
      selectedIndices: get().selectedIndices,
      indexCategories: updatedCategories,
      marketConfigs: get().marketConfigs,
    });
  },

  deleteIndexCategory: (id: string) => {
    const currentCategories = get().indexCategories;
    const currentIndices = get().selectedIndices;

    // 删除该分类
    const updatedCategories = currentCategories.filter((cat) => cat.id !== id);

    // 删除该分类下的所有指数
    const updatedIndices = currentIndices.filter(
      (idx) => idx.categoryId !== id
    );

    set({
      indexCategories: updatedCategories,
      selectedIndices: updatedIndices,
    });
    persistWatchlist({
      selectedIndices: updatedIndices,
      indexCategories: updatedCategories,
      marketConfigs: get().marketConfigs,
    });
  },

  reorderIndexCategories: (categories: IndexCategory[]) => {
    // 重新分配 order
    const reorderedCategories = categories.map((cat, index) => ({
      ...cat,
      order: index,
    }));
    set({ indexCategories: reorderedCategories });
    persistWatchlist({
      selectedIndices: get().selectedIndices,
      indexCategories: reorderedCategories,
      marketConfigs: get().marketConfigs,
    });
  },

  hydrateWatchlist: async () => {
    const local = readLocalWatchlist();
    try {
      const remote = await apiClient.getWatchlistPreference();
      const decision = decideWatchlistHydrate(remote, local);
      set({
        selectedIndices: decision.payload.selectedIndices,
        indexCategories: decision.payload.indexCategories,
        marketConfigs: decision.payload.marketConfigs,
      });
      writeLocalWatchlist(decision.payload);
      if (decision.shouldUpload) {
        await apiClient.saveWatchlistPreference(decision.payload);
      }
      await get().fetchMarketIndices();
    } catch (error) {
      console.error('Failed to hydrate watchlist from server:', error);
    }
  },

  fetchStockQuotes: async (codes: string[]) => {
    try {
      const quotes = await apiClient.fetchQuotes(codes); // This will now throw on error
      const newQuotesMap = quotes.reduce(
        (acc, quote) => {
          acc[quote.code] = quote;
          return acc;
        },
        {} as Record<string, Quote>
      );
      set((state) => ({
        stockQuotes: { ...state.stockQuotes, ...newQuotesMap },
      }));
    } catch (error) {
      console.error('Error fetching stock quotes in store:', error);
      // Optionally set an error state specific to stock quotes
    }
  },

  // --- Portfolio Actions ---
  fetchPortfolios: async () => {
    set({ isLoadingPortfolios: true, portfolioError: null });
    try {
      const portfolios = await apiClient.fetchPortfolios();
      set({ portfolios, isLoadingPortfolios: false });
    } catch (error) {
      console.error('Error fetching portfolios in store:', error);
      set({
        portfolioError: 'Failed to fetch portfolios',
        isLoadingPortfolios: false,
      });
    }
  },

  createPortfolio: async (data: PortfolioInput) => {
    // Added type for data
    // Assuming createPortfolio in apiClient throws error on failure
    set({ isLoadingPortfolios: true, portfolioError: null }); // Indicate loading
    try {
      await apiClient.createPortfolio(data);
      await get().fetchPortfolios(); // Refresh list after creation
    } catch (error) {
      console.error('Error creating portfolio in store:', error);
      set({
        portfolioError: 'Failed to create portfolio',
        isLoadingPortfolios: false,
      }); // Set error, stop loading
    }
  },

  selectPortfolio: (id: string | null) => {
    // Added type for id
    set({
      selectedPortfolioId: id,
      selectedPortfolioDetail: null,
      portfolioError: null,
    }); // Reset detail
    if (id) {
      get().fetchPortfolioDetail(id); // Use get()
    }
  },

  fetchPortfolioDetail: async (id: string) => {
    // Added type for id
    set({ isLoadingPortfolioDetail: true, portfolioError: null });
    try {
      const detail = await apiClient.fetchPortfolioDetail(id);
      if (detail) {
        set({
          selectedPortfolioDetail: detail,
          isLoadingPortfolioDetail: false,
        });
      } else {
        // Handle case where API returns null (e.g., not found, but not an exception)
        set({
          portfolioError: 'Portfolio details not found.',
          isLoadingPortfolioDetail: false,
          selectedPortfolioDetail: null,
        });
      }
    } catch (error) {
      // Catch errors re-thrown by apiClient potentially
      console.error(
        `Error fetching portfolio detail for ${id} in store:`,
        error
      );
      set({
        portfolioError: 'Failed to fetch portfolio details',
        isLoadingPortfolioDetail: false,
      });
    }
  },

  addTransaction: async (portfolioId: string, data: TransactionInput) => {
    set({ portfolioError: null });
    try {
      await apiClient.addTransaction(portfolioId, data);
      await get().fetchPortfolioDetail(portfolioId);
      queryClient.invalidateQueries({
        queryKey: ['portfolio-stats', portfolioId],
      });
    } catch (error) {
      console.error('Error adding transaction in store:', error);
      throw error;
    }
  },

  deleteTransaction: async (portfolioId: string, transactionId: string) => {
    set({ portfolioError: null });
    try {
      await apiClient.deleteTransaction(portfolioId, transactionId);
      await get().fetchPortfolioDetail(portfolioId);
      queryClient.invalidateQueries({
        queryKey: ['portfolio-stats', portfolioId],
      });
      // 删除的可能是分红交易，分红台账状态随之变化
      queryClient.invalidateQueries({
        queryKey: ['portfolio-dividends', portfolioId],
      });
    } catch (error) {
      console.error('Error deleting transaction in store:', error);
      throw error;
    }
  },

  fetchKlineData: async (
    code: string,
    period: string = 'daily',
    fq: string = 'qfq'
  ) => {
    try {
      const klinePoints = await apiClient.fetchKline(
        code,
        period,
        undefined,
        undefined,
        fq
      ); // This will now throw on error
      set((state) => ({
        klineData: {
          ...state.klineData,
          [`${code}-${period}-${fq}`]: klinePoints,
        },
      }));
    } catch (error) {
      console.error(`Error fetching kline data for ${code} in store:`, error);
      // Optionally set an error state specific to kline data
    }
  },

  deletePortfolio: async (portfolioId: string) => {
    set({ portfolioError: null, isLoadingPortfolios: true });
    try {
      await apiClient.deletePortfolio(portfolioId);
      await get().fetchPortfolios();
      set({ selectedPortfolioId: null, selectedPortfolioDetail: null });
      queryClient.removeQueries({
        queryKey: ['portfolio-stats', portfolioId],
      });
    } catch (error) {
      console.error('Error deleting portfolio in store:', error);
      set({
        portfolioError: 'Failed to delete portfolio',
        isLoadingPortfolios: false,
      });
      throw error;
    } finally {
      set({ isLoadingPortfolios: false });
    }
  },

  updateTransactionNotes: async (
    portfolioId: string,
    transactionId: string,
    notes: string
  ) => {
    set({ portfolioError: null });
    try {
      const updatedTransaction = await apiClient.updateTransactionNotes(
        portfolioId,
        transactionId,
        notes
      );

      // 更新本地状态中的交易备注
      const currentDetail = get().selectedPortfolioDetail;
      if (currentDetail && currentDetail.id === portfolioId) {
        const updatedTransactions = currentDetail.transactions.map((tx) =>
          tx.id === transactionId
            ? { ...tx, notes: updatedTransaction.notes }
            : tx
        );
        set({
          selectedPortfolioDetail: {
            ...currentDetail,
            transactions: updatedTransactions,
          },
        });
      }
    } catch (error) {
      console.error('Error updating transaction notes in store:', error);
      set({ portfolioError: 'Failed to update transaction notes' });
      throw error;
    }
  },

  updateAttentionInfo: async (portfolioId: string, attentionInfo: string) => {
    set({ portfolioError: null });
    try {
      const response = await apiClient.updatePortfolioAttention(
        portfolioId,
        attentionInfo
      );

      // 更新本地状态中的注意信息
      const currentDetail = get().selectedPortfolioDetail;
      if (currentDetail && currentDetail.id === portfolioId) {
        set({
          selectedPortfolioDetail: {
            ...currentDetail,
            attentionInfo: response.attentionInfo,
          },
        });
      }
    } catch (error) {
      console.error('Error updating attention info in store:', error);
      set({ portfolioError: 'Failed to update attention info' });
      throw error;
    }
  },
}));

export default useAppStore; // Ensure default export exists
