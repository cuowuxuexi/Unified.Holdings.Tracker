import { create } from 'zustand';
import {
  AppState,
  Quote,
  TransactionInput,
  PortfolioInput,
  SelectedIndexItem,
  MarketConfig,
  IndexCategory,
} from './types';
import apiClient from '../services/api'; // Import the API client
import { queryClient } from '../app/providers/queryClient';
// import dayjs from 'dayjs'; // No longer needed here for calculations

// 本地存储键名
// const SELECTED_INDICES_STORAGE_KEY = 'stock-tracker-selected-indices'; // Removed old key
const MARKET_INDICES_ORDER_STORAGE_KEY = 'marketIndicesOrderV2'; // 新key，避免与老string[]混用
const MARKET_CONFIGS_STORAGE_KEY = 'marketConfigsV1'; // 市场配置存储键
const INDEX_CATEGORIES_STORAGE_KEY = 'indexCategoriesV1'; // 指数分类存储键

// 默认分类栏目
const DEFAULT_INDEX_CATEGORIES: IndexCategory[] = [
  { id: 'market', label: '大盘', order: 0, visible: true },
  { id: 'stock', label: '个股', order: 1, visible: true },
];

// 默认指数列表（迁移到新的 categoryId 结构）
const DEFAULT_INDICES: SelectedIndexItem[] = [
  { code: 'sh000001', name: '上证指数', visible: true, categoryId: 'market' },
  { code: 'sz399001', name: '深证成指', visible: true, categoryId: 'market' },
  { code: 'hkHSI', name: '恒生指数', visible: true, categoryId: 'market' },
  { code: 'usDJI', name: '道琼斯', visible: true, categoryId: 'market' },
  { code: 'usIXIC', name: '纳斯达克', visible: true, categoryId: 'market' },
  { code: 'usINX', name: '标普500', visible: true, categoryId: 'market' },
];

// 默认市场配置
const DEFAULT_MARKET_CONFIGS: MarketConfig[] = [
  {
    key: 'A股',
    label: 'A股',
    currency: 'CNY',
    symbol: '¥',
    codePrefix: ['sh', 'sz'],
    visible: true,
  },
  {
    key: '港股',
    label: '港股',
    currency: 'HKD',
    symbol: 'HK$',
    codePrefix: ['hk'],
    visible: true,
  },
  {
    key: '美股',
    label: '美股',
    currency: 'USD',
    symbol: '$',
    codePrefix: ['us'],
    visible: true,
  },
];

// 兼容老数据string[]自动转换为对象数组
const migrateStringArrayToSelectedIndexItem = (
  arr: string[]
): SelectedIndexItem[] => {
  return arr.map((code) => ({
    code,
    name: code,
    visible: true,
    categoryId: 'stock',
  }));
};

type StoredSelectedIndexItem = SelectedIndexItem & {
  type?: string;
};

const isStoredSelectedIndexItem = (
  item: unknown
): item is StoredSelectedIndexItem => {
  return (
    typeof item === 'object' &&
    item !== null &&
    'code' in item &&
    typeof item.code === 'string'
  );
};

// 迁移老的 type 字段到新的 categoryId 字段
const migrateTypeToCategory = (
  items: StoredSelectedIndexItem[]
): SelectedIndexItem[] => {
  return items.map((item) => {
    if (item.type && !item.categoryId) {
      // 有 type 但没有 categoryId，进行迁移
      return { ...item, categoryId: item.type };
    }
    return item;
  });
};

// 从localStorage获取保存的指数顺序
const getSavedIndicesOrder = (): SelectedIndexItem[] => {
  try {
    const savedOrder = localStorage.getItem(MARKET_INDICES_ORDER_STORAGE_KEY);
    if (savedOrder) {
      const parsed = JSON.parse(savedOrder);
      // 新对象数组格式
      if (Array.isArray(parsed) && parsed.every(isStoredSelectedIndexItem)) {
        if (parsed.length === 0) {
          console.warn(
            'Saved indices order is empty, returning default indices.'
          );
          return DEFAULT_INDICES;
        }
        // 迁移老的 type 字段到 categoryId
        return migrateTypeToCategory(parsed);
      }
      // 老string[]格式
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return migrateStringArrayToSelectedIndexItem(parsed);
      }
      console.warn(
        'Invalid indices order format found in localStorage, returning default indices.'
      );
    }
  } catch (error) {
    console.error(
      'Error loading saved indices order from localStorage:',
      error
    );
  }
  // Fallback to default indices if nothing valid is found
  return DEFAULT_INDICES;
};

// 保存指数顺序到localStorage
const saveIndicesOrder = (indices: SelectedIndexItem[]): void => {
  try {
    if (
      Array.isArray(indices) &&
      indices.every((item) => typeof item === 'object' && item.code)
    ) {
      localStorage.setItem(
        MARKET_INDICES_ORDER_STORAGE_KEY,
        JSON.stringify(indices)
      );
    } else {
      console.error('Attempted to save invalid indices order:', indices);
    }
  } catch (error) {
    console.error('Error saving indices order to localStorage:', error);
  }
};

// 从localStorage获取保存的市场配置
const getSavedMarketConfigs = (): MarketConfig[] => {
  try {
    const savedConfigs = localStorage.getItem(MARKET_CONFIGS_STORAGE_KEY);
    if (savedConfigs) {
      const parsed = JSON.parse(savedConfigs);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'object' && item.key)
      ) {
        return parsed;
      }
      console.warn(
        'Invalid market configs format found in localStorage, returning default configs.'
      );
    }
  } catch (error) {
    console.error(
      'Error loading saved market configs from localStorage:',
      error
    );
  }
  return DEFAULT_MARKET_CONFIGS;
};

// 保存市场配置到localStorage
const saveMarketConfigs = (configs: MarketConfig[]): void => {
  try {
    if (
      Array.isArray(configs) &&
      configs.every((item) => typeof item === 'object' && item.key)
    ) {
      localStorage.setItem(MARKET_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    } else {
      console.error('Attempted to save invalid market configs:', configs);
    }
  } catch (error) {
    console.error('Error saving market configs to localStorage:', error);
  }
};

// 从localStorage获取保存的指数分类
const getSavedIndexCategories = (): IndexCategory[] => {
  try {
    const savedCategories = localStorage.getItem(INDEX_CATEGORIES_STORAGE_KEY);
    if (savedCategories) {
      const parsed = JSON.parse(savedCategories);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'object' && item.id)
      ) {
        return parsed;
      }
      console.warn(
        'Invalid index categories format found in localStorage, returning default categories.'
      );
    }
  } catch (error) {
    console.error(
      'Error loading saved index categories from localStorage:',
      error
    );
  }
  return DEFAULT_INDEX_CATEGORIES;
};

// 保存指数分类到localStorage
const saveIndexCategories = (categories: IndexCategory[]): void => {
  try {
    if (
      Array.isArray(categories) &&
      categories.every((item) => typeof item === 'object' && item.id)
    ) {
      localStorage.setItem(
        INDEX_CATEGORIES_STORAGE_KEY,
        JSON.stringify(categories)
      );
    } else {
      console.error('Attempted to save invalid index categories:', categories);
    }
  } catch (error) {
    console.error('Error saving index categories to localStorage:', error);
  }
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
      set({ selectedIndices: indices });
      saveIndicesOrder(indices);
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
      saveMarketConfigs(configs);
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
      saveIndexCategories(categories);
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
    saveIndexCategories(updatedCategories);
  },

  updateIndexCategory: (id: string, updates: Partial<IndexCategory>) => {
    const currentCategories = get().indexCategories;
    const updatedCategories = currentCategories.map((cat) =>
      cat.id === id ? { ...cat, ...updates } : cat
    );
    set({ indexCategories: updatedCategories });
    saveIndexCategories(updatedCategories);
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
    saveIndexCategories(updatedCategories);
    saveIndicesOrder(updatedIndices);
  },

  reorderIndexCategories: (categories: IndexCategory[]) => {
    // 重新分配 order
    const reorderedCategories = categories.map((cat, index) => ({
      ...cat,
      order: index,
    }));
    set({ indexCategories: reorderedCategories });
    saveIndexCategories(reorderedCategories);
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
