import axios from 'axios';
import { Quote, KlinePoint } from '../store/types'; // Adjust path if needed
import { Portfolio, PortfolioDetail, Transaction, TransactionInput, PortfolioInput, PortfolioStats } from '../store/types'; // 添加 PortfolioStats 导入

const API_BASE_URL = 'http://localhost:3001'; // Corrected: Removed trailing /api

const apiClient = {
  // Add the /api prefix back to specific routes that need it (assuming routes are defined with /api in server.ts)
  fetchQuotes: async (codes: string[]): Promise<Quote[]> => {
    if (!codes || codes.length === 0) {
      return [];
    }
    try {
      // Use the correct path including /api/market
      const response = await axios.get<Quote[]>(`${API_BASE_URL}/api/market/quote`, {
        params: { codes: codes.join(',') },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching quotes from API client:', error);
      // MODIFIED: Re-throw error instead of returning empty array
      throw error;
    }
  },

  fetchKline: async (
    code: string,
    period: string = 'daily',
    startDate?: string,
    endDate?: string,
    fq: string = 'qfq'
  ): Promise<KlinePoint[]> => {
    try {
      const params: Record<string, string> = { code, period, fq };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      // Use the correct path including /api/market
      const response = await axios.get<KlinePoint[]>(`${API_BASE_URL}/api/market/kline`, { params });
      return response.data;
    } catch (error) {
      console.error(`Error fetching kline for ${code} from API client:`, error);
      // MODIFIED: Re-throw error instead of returning empty array
      throw error;
    }
  },
  // Portfolio Management API Calls
  fetchPortfolios: async (): Promise<Portfolio[]> => {
    try {
      // Use the correct path including /api/portfolio
      const response = await axios.get<Portfolio[]>(`${API_BASE_URL}/api/portfolio`);
      return response.data;
    } catch (error) {
      console.error('Error fetching portfolios from API client:', error);
      // Keep returning empty array for list view robustness
      return [];
    }
  },

  createPortfolio: async (portfolioData: PortfolioInput): Promise<Portfolio> => {
    try {
      // Use the correct path including /api/portfolio
      const response = await axios.post<Portfolio>(`${API_BASE_URL}/api/portfolio`, portfolioData);
      return response.data;
    } catch (error) {
      console.error('Error creating portfolio from API client:', error);
      throw error; // Re-throw for store to handle
    }
  },


  fetchPortfolioDetail: async (id: string): Promise<PortfolioDetail | null> => {
    try {
      // Use the correct path including /api/portfolio
      const response = await axios.get<PortfolioDetail>(`${API_BASE_URL}/api/portfolio/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching portfolio detail for ${id} from API client:`, error);
      // Keep returning null for detail view robustness
      return null;
    }
  },

  addTransaction: async (portfolioId: string, transactionData: TransactionInput & { leverageUsed?: number }): Promise<Transaction> => {
    try {
      // 重构数据结构：将 asset.code 转换为顶层 assetCode
      const restructuredData = {
        assetCode: transactionData.asset?.code,  // 使用可选链操作符，当 asset 不存在时返回 undefined
        date: transactionData.date,
        type: transactionData.type,
        quantity: transactionData.quantity,
        price: transactionData.price,
        amount: transactionData.amount,
        commission: transactionData.commission,
        leverageUsed: transactionData.leverageUsed
      };

      // Log the data being sent to the backend
      console.log(`[API Client] Sending transaction data to portfolio ${portfolioId}:`, JSON.stringify(restructuredData, null, 2));
      // Use the correct path including /api/portfolio
      const response = await axios.post<Transaction>(`${API_BASE_URL}/api/portfolio/${portfolioId}/transactions`, restructuredData);
      return response.data;
    } catch (error) {
      console.error(`Error adding transaction to portfolio ${portfolioId} from API client:`, error);
      throw error; // Re-throw for store to handle
    }
  },

  deleteTransaction: async (portfolioId: string, transactionId: string): Promise<void> => {
    try {
      // Use the correct path including /api/portfolio
      await axios.delete(`${API_BASE_URL}/api/portfolio/${portfolioId}/transactions/${transactionId}`);
    } catch (error) {
      console.error(`Error deleting transaction ${transactionId} from portfolio ${portfolioId} from API client:`, error);
      throw error; // Re-throw for store to handle
    }
  },
  fetchPortfolioStats: async (portfolioId: string, period?: string, startDate?: string, endDate?: string): Promise<PortfolioStats> => {
    try {
      const params: Record<string, string> = {};
      if (period) {
        params.period = period;
      }
      if (startDate) {
        params.startDate = startDate;
      }
      if (endDate) {
        params.endDate = endDate;
      }
      // Use the correct path including /api/portfolio
      const response = await axios.get<PortfolioStats>(`${API_BASE_URL}/api/portfolio/${portfolioId}/stats`, { params });
      console.log(`[API Debug] Portfolio stats response for ${portfolioId}:`, response.data); // 添加调试日志
      return response.data;
    } catch (error) {
      console.error(`Error fetching portfolio stats for ${portfolioId} from API client:`, error);
      throw error; // Re-throw error to be handled by the caller (e.g., store action)
    }
  },
  deletePortfolio: async (portfolioId: string): Promise<void> => {
    try {
      // Use the correct path including /api/portfolio
      await axios.delete(`${API_BASE_URL}/api/portfolio/${portfolioId}`);
    } catch (error) {
      console.error(`Error deleting portfolio ${portfolioId} from API client:`, error);
      throw error;
    }
  }
};

export default apiClient;

// 获取实时汇率
export const fetchExchangeRates = async (): Promise<{ USD: number; HKD: number; CNY: number; updatedAt: string; error?: boolean }> => {
  try {
    // 使用 axios.get 并指定完整的 URL, including /api/portfolio
    const response = await axios.get<{ USD: number; HKD: number; CNY: number; updatedAt: string }>(`${API_BASE_URL}/api/portfolio/exchange-rates`);
    console.log('[API Service] Fetched exchange rates:', response.data);
    // 确保返回的数据包含必要的字段
    if (response.data && typeof response.data.USD === 'number' && typeof response.data.HKD === 'number') {
      return {
        USD: response.data.USD,
        HKD: response.data.HKD,
        CNY: 1.0,
        updatedAt: response.data.updatedAt || new Date().toISOString(), // Use server time or fallback
      };
    } else {
      console.error('[API Service] Invalid exchange rate data received:', response.data);
      throw new Error('Invalid exchange rate data received');
    }
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    // 返回包含错误标记和默认值的对象，以便 UI 可以处理
    // 恢复原始默认值，尽管后端现在应该提供模拟值
    return {
      USD: 7.25, // Default fallback
      HKD: 0.92, // Default fallback
      CNY: 1.0,
      updatedAt: new Date().toISOString(),
      error: true,
    };
  }
};
