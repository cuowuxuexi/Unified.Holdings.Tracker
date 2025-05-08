import { create } from 'zustand';
import { AppState, Quote, TransactionInput, PortfolioInput, PortfolioStats, SelectedIndexItem } from './types';
import apiClient from '../services/api'; // Import the API client
// import dayjs from 'dayjs'; // No longer needed here for calculations

// 本地存储键名
// const SELECTED_INDICES_STORAGE_KEY = 'stock-tracker-selected-indices'; // Removed old key
const MARKET_INDICES_ORDER_STORAGE_KEY = 'marketIndicesOrderV2'; // 新key，避免与老string[]混用

// 默认指数列表
const DEFAULT_INDICES: SelectedIndexItem[] = [
  { code: 'sh000001', name: '上证指数', visible: true, type: 'market' },
  { code: 'sz399001', name: '深证成指', visible: true, type: 'market' },
  { code: 'hkHSI', name: '恒生指数', visible: true, type: 'market' },
  { code: 'usDJI', name: '道琼斯', visible: true, type: 'market' },
  { code: 'usIXIC', name: '纳斯达克', visible: true, type: 'market' },
  { code: 'usINX', name: '标普500', visible: true, type: 'market' },
];

// 兼容老数据string[]自动转换为对象数组
const migrateStringArrayToSelectedIndexItem = (arr: string[]): SelectedIndexItem[] => {
  return arr.map(code => ({ code, name: code, visible: true, type: 'stock' }));
};

// 从localStorage获取保存的指数顺序
const getSavedIndicesOrder = (): SelectedIndexItem[] => {
  try {
    const savedOrder = localStorage.getItem(MARKET_INDICES_ORDER_STORAGE_KEY);
    if (savedOrder) {
      const parsed = JSON.parse(savedOrder);
      // 新对象数组格式
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'object' && item.code)) {
        if (parsed.length === 0) {
          console.warn('Saved indices order is empty, returning default indices.');
          return DEFAULT_INDICES;
        }
        return parsed;
      }
      // 老string[]格式
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return migrateStringArrayToSelectedIndexItem(parsed);
      }
      console.warn('Invalid indices order format found in localStorage, returning default indices.');
    }
  } catch (error) {
    console.error('Error loading saved indices order from localStorage:', error);
  }
  // Fallback to default indices if nothing valid is found
  return DEFAULT_INDICES;
};

// 保存指数顺序到localStorage
const saveIndicesOrder = (indices: SelectedIndexItem[]): void => {
  try {
    if (Array.isArray(indices) && indices.every(item => typeof item === 'object' && item.code)) {
      localStorage.setItem(MARKET_INDICES_ORDER_STORAGE_KEY, JSON.stringify(indices));
    } else {
      console.error('Attempted to save invalid indices order:', indices);
    }
  } catch (error) {
    console.error('Error saving indices order to localStorage:', error);
  }
};

// REMOVED: Helper function findClosestTradingDayClose is no longer needed as calculations are done in backend
/*
const findClosestTradingDayClose = (klineData: KlinePoint[], targetDateStr: string): number | null => {
  // ... (removed implementation) ...
*/

const useAppStore = create<AppState>((set, get) => ({ // Added get to access state within actions
 // Market Indices State (Task 7.2)
 marketIndicesData: [],
 isLoadingMarketIndices: false,
 marketIndicesError: null,
 selectedIndices: getSavedIndicesOrder(), // 从本地存储获取对象数组

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
 currentPortfolioStats: null, // Initialize stats state

 // --- Actions ---
 fetchMarketIndices: async () => {
   set({ isLoadingMarketIndices: true, marketIndicesError: null });
   const selectedIndices = get().selectedIndices; // Get indices from state

   try {
     // Only fetch quotes, as the backend now includes calculated percentages
     const quotes = await apiClient.fetchQuotes(selectedIndices.map(item => item.code));

     // The Quote type from the backend should already include:
     // yearChangePercent?: number;

     // Map the received quotes directly to the CombinedIndexData structure
     // No need for frontend recalculations
     console.log('[fetchMarketIndices] Processing quotes data:', quotes);
     
     set({ marketIndicesData: quotes, isLoadingMarketIndices: false });
   } catch (error) {
     console.error('Error fetching market indices data in store:', error);
     set({ marketIndicesError: 'Failed to fetch market indices data', isLoadingMarketIndices: false, marketIndicesData: [] }); // Clear data on error
   }
 },

 setSelectedIndices: (indices: SelectedIndexItem[]) => {
   if (Array.isArray(indices) && indices.every(item => typeof item === 'object' && item.code)) {
     set({ selectedIndices: indices });
     saveIndicesOrder(indices);
   } else {
     console.error('setSelectedIndices received invalid data:', indices);
   }
 },

 fetchStockQuotes: async (codes: string[]) => {
   try {
     const quotes = await apiClient.fetchQuotes(codes); // This will now throw on error
     const newQuotesMap = quotes.reduce((acc, quote) => {
       acc[quote.code] = quote;
       return acc;
     }, {} as Record<string, Quote>);
     set((state) => ({ stockQuotes: { ...state.stockQuotes, ...newQuotesMap } }));
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
     set({ portfolioError: 'Failed to fetch portfolios', isLoadingPortfolios: false });
   }
 },

 createPortfolio: async (data: PortfolioInput) => { // Added type for data
   // Assuming createPortfolio in apiClient throws error on failure
   set({ isLoadingPortfolios: true, portfolioError: null }); // Indicate loading
   try {
     await apiClient.createPortfolio(data);
     await get().fetchPortfolios(); // Refresh list after creation
   } catch (error) {
     console.error('Error creating portfolio in store:', error);
     set({ portfolioError: 'Failed to create portfolio', isLoadingPortfolios: false }); // Set error, stop loading
   }
 },

 selectPortfolio: (id: string | null) => { // Added type for id
   set({ selectedPortfolioId: id, selectedPortfolioDetail: null, portfolioError: null, currentPortfolioStats: null }); // Reset detail and stats
   if (id) {
     get().fetchPortfolioDetail(id); // Use get()
     get().fetchCurrentPortfolioStats(id); // Fetch stats when portfolio is selected
   }
 },

 fetchPortfolioDetail: async (id: string) => { // Added type for id
   set({ isLoadingPortfolioDetail: true, portfolioError: null });
   try {
     const detail = await apiClient.fetchPortfolioDetail(id);
     if (detail) {
        set({ selectedPortfolioDetail: detail, isLoadingPortfolioDetail: false });
     } else {
        // Handle case where API returns null (e.g., not found, but not an exception)
        set({ portfolioError: 'Portfolio details not found.', isLoadingPortfolioDetail: false, selectedPortfolioDetail: null });
     }
   } catch (error) { // Catch errors re-thrown by apiClient potentially
     console.error(`Error fetching portfolio detail for ${id} in store:`, error);
     set({ portfolioError: 'Failed to fetch portfolio details', isLoadingPortfolioDetail: false });
   }
 },

 addTransaction: async (portfolioId: string, data: TransactionInput) => { // Added types
   // Assuming addTransaction in apiClient throws error on failure
   set({ portfolioError: null }); // Clear previous error
   try {
     await apiClient.addTransaction(portfolioId, data);
     // Re-fetch both detail (for transaction list) and stats
     await Promise.all([
        get().fetchPortfolioDetail(portfolioId),
        get().fetchCurrentPortfolioStats(portfolioId)
     ]);
   } catch (error) {
     console.error('Error adding transaction in store:', error);
     set({ portfolioError: 'Failed to add transaction' });
   }
 },

 deleteTransaction: async (portfolioId: string, transactionId: string) => { // Added types
    // Assuming deleteTransaction in apiClient throws error on failure
   set({ portfolioError: null }); // Clear previous error
   try {
     await apiClient.deleteTransaction(portfolioId, transactionId);
      // Re-fetch both detail (for transaction list) and stats
     await Promise.all([
        get().fetchPortfolioDetail(portfolioId),
        get().fetchCurrentPortfolioStats(portfolioId)
     ]);
   } catch (error) {
     console.error('Error deleting transaction in store:', error);
     set({ portfolioError: 'Failed to delete transaction' });
   }
 },

 fetchKlineData: async (code: string, period: string = 'daily', fq: string = 'qfq') => {
   try {
     const klinePoints = await apiClient.fetchKline(code, period, undefined, undefined, fq); // This will now throw on error
     set((state) => ({
       klineData: { ...state.klineData, [`${code}-${period}-${fq}`]: klinePoints },
     }));
   } catch (error) {
     console.error(`Error fetching kline data for ${code} in store:`, error);
     // Optionally set an error state specific to kline data
   }
 },

 fetchCurrentPortfolioStats: async (portfolioId: string, period?: string, startDate?: string, endDate?: string) => {
   set({ portfolioError: null }); // Clear previous portfolio-specific error
   try {
     const statsData: PortfolioStats = await apiClient.fetchPortfolioStats(portfolioId, period, startDate, endDate); // 添加startDate和endDate参数
     set({ currentPortfolioStats: statsData });
   } catch (error) {
     console.error(`Error fetching portfolio stats for ${portfolioId} in store:`, error);
     set({ portfolioError: 'Failed to fetch portfolio statistics', currentPortfolioStats: null });
   }
 },

 deletePortfolio: async (portfolioId: string) => {
   set({ portfolioError: null, isLoadingPortfolios: true });
   try {
     await apiClient.deletePortfolio(portfolioId);
     await get().fetchPortfolios();
     set({ selectedPortfolioId: null, selectedPortfolioDetail: null, currentPortfolioStats: null });
   } catch (error) {
     console.error('Error deleting portfolio in store:', error);
     set({ portfolioError: 'Failed to delete portfolio', isLoadingPortfolios: false });
     throw error;
   } finally {
     set({ isLoadingPortfolios: false });
   }
 },
}));

export default useAppStore; // Ensure default export exists
