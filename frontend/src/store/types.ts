// Example in frontend/src/store/types.ts or frontend/src/types/index.ts
export interface Quote {
  code: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  changeAmount: number;
  volume?: number;
  turnover?: number;
  timestamp: number;
  // Add other fields from backend Quote if needed
  prevClosePrice?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  peRatio?: number;
  marketCap?: number;
  // Add period change fields returned by the backend /quotes endpoint
  yearChangePercent?: number | null;
  weekChangePercent?: number | null;
  monthChangePercent?: number | null;
}

export interface KlinePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Portfolio Management Types ---

export enum TransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  DEPOSIT = 'DEPOSIT', // 入金
  WITHDRAW = 'WITHDRAW', // 出金
  DIVIDEND = 'DIVIDEND', // 股息
}

export interface Transaction {
  id: string;
  portfolioId: string;
  assetCode: string;  // 添加 assetCode 字段
  asset?: {
    code: string;
    name?: string;
  };
  type: TransactionType;
  amount: number;
  price: number;
  fee: number;
  date: string;
  currency: string;
  exchangeRate: number;
  note?: string;
  quantity?: number;  // 添加可选的数量字段，用于买入/卖出交易
  commission?: number;  // 添加可选的手续费字段
}

// Type for creating new transactions (omits id, portfolioId)
export type TransactionInput = Omit<Transaction, 'id' | 'portfolioId'>;

export interface Position {
  asset: {
    code: string;
    name: string;
    market?: string;
  };
  quantity: number;
  costPrice: number;
  // Optional fields that might be calculated backend or added later
  currentPrice?: number;
  marketValue?: number;
  profitLoss?: number;
  profitLossPercent?: number;
}

export interface LeverageInfo {
  totalCredit: number; // 总额度
  usedCredit: number; // 已用额度
  availableCredit: number; // 可用额度
  interestRate: number; // 年利率 (%)
}

// Basic portfolio info (for lists)
export interface Portfolio {
  id: string;
  name: string;
  cash: number;
  leverageInfo?: LeverageInfo;
}

// Interface for positions with calculated stats from the /stats endpoint
export interface PositionWithStats extends Position {
  currentPrice: number; // Ensure this is always present in stats
  marketValue: number;
  dailyChange?: number; // Pnl amount for the day
  dailyChangePercent?: number; // Pnl percentage for the day
  totalPnl?: number; // Total profit/loss amount
  totalPnlPercent?: number; // Total profit/loss percentage
  weeklyChangePercent?: number;
  monthlyChangePercent?: number;
  yearlyChangePercent?: number;
}

// Interface for the data returned by the /portfolio/:id/stats endpoint
export interface PortfolioStats {
  totalMarketValue: number; // 总市值 (股票+基金等)
  cash: number; // 现金
  totalAssets: number; // 总资产 (市值 + 现金)
  netAssets: number; // 净资产 (总资产 - 负债/已用杠杆) - Assuming leverage is handled
  dailyPnl: number; // 当日盈亏金额
  totalPnl: number; // 累计盈亏金额
  periodReturnPercent?: number; // 期间收益率 (%) - Optional as it depends on 'period' param
  positions: PositionWithStats[]; // Updated positions list with stats
  // Add other potential fields from backend if necessary
  timestamp: number; // Timestamp of when the stats were calculated
  weeklyStats?: { periodReturnPercent: number | null; periodPnl: number | null };
  monthlyStats?: { periodReturnPercent: number | null; periodPnl: number | null };
  yearlyStats?: { periodReturnPercent: number | null; periodPnl: number | null };
  totalCommission?: number; // 添加手续费总额字段
  leverageCost?: number; // 添加融资成本字段
  totalDividendIncome?: number; // 新增：总股息收入
}

// Type for creating new portfolios (omits id)
export type PortfolioInput = Omit<Portfolio, 'id'>;

// Detailed portfolio view
export interface PortfolioDetail extends Portfolio {
  positions: Position[];
  transactions: Transaction[];
  /**
   * 净入金：仅由初始现金、所有入金（DEPOSIT）、所有出金（WITHDRAW）决定，反映账户历史实际净投入现金总额。买卖股票、分红、费用等不影响此数值。
   */
  netDepositedCash: number;
}

// 新增已选指数对象类型
export interface SelectedIndexItem {
  code: string;
  name: string;
  visible: boolean;
  type: 'market' | 'stock'; // 新增字段，区分大盘和个股
}

// --- Update AppState ---
// Add portfolio related state fields
export interface AppState {
  marketIndices: Quote[]; // Original field, might be deprecated later if only CombinedIndexData is used
  stockQuotes: Record<string, Quote>;
  klineData: Record<string, KlinePoint[]>;

  // Market Indices State (Task 7.2)
  marketIndicesData: Quote[];
  isLoadingMarketIndices: boolean;
  marketIndicesError: string | null;
  selectedIndices: SelectedIndexItem[]; // Default indices to show

  // Portfolio State
  portfolios: Portfolio[];
  selectedPortfolioId: string | null;
  selectedPortfolioDetail: PortfolioDetail | null;
  isLoadingPortfolios: boolean;
  isLoadingPortfolioDetail: boolean;
  portfolioError: string | null;
  currentPortfolioStats: PortfolioStats | null; // Added for stats endpoint data

  // Actions (Placeholders - implementation in store)
  fetchMarketIndices: () => Promise<void>; // Updated signature for Task 7.2
  fetchStockQuotes: (codes: string[]) => Promise<void>;
  fetchKlineData: (code: string, period?: string, fq?: string) => Promise<void>;

  // Portfolio Actions (Placeholders)
  fetchPortfolios: () => Promise<void>;
  createPortfolio: (data: PortfolioInput) => Promise<void>;
  selectPortfolio: (id: string | null) => void; // Can be synchronous
  fetchPortfolioDetail: (id: string) => Promise<void>;
  addTransaction: (portfolioId: string, data: TransactionInput) => Promise<void>;
  deleteTransaction: (portfolioId: string, transactionId: string) => Promise<void>;
  fetchCurrentPortfolioStats: (portfolioId: string, period?: string, startDate?: string, endDate?: string) => Promise<void>; // 更新函数签名，添加日期参数
  setSelectedIndices: (indices: SelectedIndexItem[]) => void; // Action to set selected indices
}
