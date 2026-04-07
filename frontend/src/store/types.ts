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
  yearlyChangePercent?: number | null;
  weeklyChangePercent?: number | null;
  monthlyChangePercent?: number | null;
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
  assetCode: string; // 添加 assetCode 字段
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
  notes?: string; // 统一使用 notes 字段
  quantity?: number; // 添加可选的数量字段，用于买入/卖出交易
  commission?: number; // 添加可选的手续费字段
}

// Type for creating new transactions (omits id, portfolioId)
export type TransactionInput = Omit<Transaction, 'id' | 'portfolioId'>;

/**
 * 持仓信息
 *
 * **重要说明**：后端返回的持仓数据中，所有金额字段（costPrice, marketValue等）
 * 默认均为**人民币(CNY)**计价，已经经过汇率转换。前端不应再次应用汇率转换。
 */
export interface Position {
  asset: {
    code: string;
    name: string;
    market?: string;
  };
  /** 持仓数量（股数/份数） */
  quantity: number;

  /** 货币类型（CNY/HKD/USD） */
  currency?: string;

  /**
   * 持仓成本价（单位：CNY/人民币）
   * - 后端已完成汇率转换，前端无需再次转换
   * - FIFO 批次成本价，仅计算当前持仓的买入成本
   */
  costPrice: number;

  /**
   * 持仓成本价（单位：原币种）
   * - 港股：HKD，美股：USD，A股：CNY
   */
  costPriceLocal?: number;

  /**
   * 摊薄价（单位：CNY/人民币）
   * - (累计买入 - 累计卖出 - 累计股息) / 持仓数量
   * - 雪球的"摊薄"价格
   */
  dilutedPrice?: number;

  /**
   * 摊薄价（单位：原币种）
   * - 港股：HKD，美股：USD，A股：CNY
   */
  dilutedPriceLocal?: number;

  /**
   * 当前价格（单位：原币种）
   * - 来自行情API的原始价格
   * - 港股：HKD，美股：USD，A股：CNY
   */
  currentPrice?: number;

  /**
   * 当前市值（单位：CNY/人民币）
   * - 后端已完成汇率转换，前端无需再次转换
   */
  marketValue?: number;

  /**
   * 累计盈亏额（单位：CNY/人民币）
   */
  profitLoss?: number;

  /**
   * 累计盈亏百分比（小数形式，0-1 范围）
   * - 例如：1.5 表示 150%，-0.2 表示 -20%
   * - 前端显示时需要乘以 100
   */
  profitLossPercent?: number;
}

export interface LeverageInfo {
  totalCredit: number; // 总额度
  usedCredit: number; // 已用额度
  availableCredit: number; // 可用额度
  interestRate: number; // 年利率 (%)
}

// 单条注意信息
export interface AttentionItem {
  id: string; // 唯一标识
  icon: string; // emoji 图标
  title: string; // 标题
  content: string; // 内容描述
  createdAt: string; // 创建时间
  updatedAt: string; // 更新时间
}

// 注意信息列表
export interface AttentionInfo {
  items: AttentionItem[];
}

// Basic portfolio info (for lists)
export interface Portfolio {
  id: string;
  name: string;
  cash: number;
  leverageInfo?: LeverageInfo;
  attentionInfo?: string;
}

/**
 * 持仓信息（含统计数据）
 *
 * **重要说明**：后端返回的所有金额字段（marketValue, dailyChange, totalPnl等）
 * 均为**人民币(CNY)**计价，已完成汇率转换。前端组件**不应再次**应用汇率转换。
 *
 * @see Position 基础持仓接口
 */
export interface PositionWithStats extends Position {
  /**
   * 当前价格（单位：原币种）
   * - 来自行情API的原始价格
   * - 港股：HKD，美股：USD，A股：CNY
   */
  currentPrice: number;

  /**
   * 当前市值（单位：CNY/人民币）
   * - 后端已完成汇率转换，前端无需再次转换
   */
  marketValue: number;

  /**
   * 当前市值（单位：原币种）
   * - 港股：HKD，美股：USD，A股：CNY
   */
  marketValueLocal?: number;

  /**
   * 当日盈亏额（单位：CNY/人民币）
   * - 后端已完成汇率转换
   */
  dailyChange?: number;

  /**
   * 当日盈亏额（单位：原币种）
   */
  dailyChangeLocal?: number;

  /**
   * 当日盈亏百分比（百分比数值形式）
   * - 例如：5.0 表示 5%，-3.0 表示 -3%
   * - 前端显示时无需乘以 100
   */
  dailyChangePercent?: number;

  /**
   * 累计盈亏额（单位：CNY/人民币）
   * - 后端已完成汇率转换
   */
  totalPnl?: number;

  /**
   * 累计盈亏额（单位：原币种）
   */
  totalPnlLocal?: number;

  /**
   * 累计盈亏百分比（百分比数值形式）
   * - 例如：9.67 表示 9.67%，-20.0 表示 -20%
   * - 前端显示时无需乘以 100
   */
  totalPnlPercent?: number;

  /**
   * 浮动盈亏（单位：CNY/人民币）
   * - (现价 - 成本价) × 数量
   */
  floatingPnl?: number;

  /**
   * 浮动盈亏（单位：原币种）
   */
  floatingPnlLocal?: number;

  /**
   * 浮动盈亏百分比（百分比数值形式）
   * - 例如：8.02 表示 8.02%，-5.0 表示 -5%
   * - 前端显示时无需乘以 100
   */
  floatingPnlPercent?: number;

  /**
   * 周涨跌幅（百分比数值形式）
   * - 例如：18.18 表示 18.18%，-5.5 表示 -5.5%
   * - 前端显示时无需乘以 100
   */
  weeklyChangePercent?: number;

  /**
   * 月涨跌幅（百分比数值形式）
   * - 例如：25.0 表示 25%，-10.0 表示 -10%
   * - 前端显示时无需乘以 100
   */
  monthlyChangePercent?: number;

  /**
   * 年涨跌幅（百分比数值形式）
   * - 例如：120.0 表示 120%，-35.0 表示 -35%
   * - 前端显示时无需乘以 100
   */
  yearlyChangePercent?: number;
}

// Interface for the data returned by the /portfolio/:id/stats endpoint
export interface PortfolioStats {
  portfolioId?: string;
  name?: string;
  leverage?: LeverageInfo;
  totalMarketValue: number; // 总市值 (股票+基金等)
  cash: number; // 现金
  totalAssets: number; // 总资产 (市值 + 现金)
  netAssets: number; // 净资产 (总资产 - 负债/已用杠杆) - Assuming leverage is handled
  netDepositedCash?: number;
  dailyPnl: number; // 当日盈亏金额
  totalPnl: number; // 累计盈亏金额
  realizedPnl?: number; // 已实现盈亏
  unrealizedPnl?: number; // 未实现盈亏（浮动盈亏）
  periodReturnPercent?: number; // 期间收益率 (%) - Optional as it depends on 'period' param
  positions: PositionWithStats[]; // Updated positions list with stats
  // Add other potential fields from backend if necessary
  timestamp: number; // Timestamp of when the stats were calculated
  weeklyStats?: PeriodReturnStat;
  monthlyStats?: PeriodReturnStat;
  yearlyStats?: PeriodReturnStat;
  totalCommission?: number; // 添加手续费总额字段
  leverageCost?: number; // 添加融资成本字段
  totalDividendIncome?: number; // 新增：总股息收入
  periodStats?: Partial<
    Record<
      'total' | 'daily' | 'weekly' | 'monthly' | 'yearly',
      PeriodReturnStat
    >
  >;
  cached?: boolean;
}

export interface PeriodReturnStat {
  periodReturnPercent: number | null;
  periodPnl: number | null;
  /**
   * 净值变化金额（净值=总资产-已用杠杆）
   */
  totalValueChange?: number | null;
  /**
   * 净值变化率（小数形式）
   */
  totalValueChangePercent?: number | null;
  baseDate?: string | null;
  baseDateSource?: 'realtime' | 'kline' | 'cost';
  endDate?: string | null;
  endDateSource?: 'realtime' | 'kline' | 'cost';
  fallbackDays?: number;
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

// 指数分类栏目类型
export interface IndexCategory {
  id: string; // 唯一标识
  label: string; // 可自定义的显示名称（如"A股指数"）
  order: number; // 排序
  visible: boolean; // 是否显示
}

// 新增已选指数对象类型
export interface SelectedIndexItem {
  code: string;
  name: string;
  visible: boolean;
  categoryId: string; // 所属栏目ID（替代原来的 type）
}

// 新增市场配置类型
export interface MarketConfig {
  key: string; // 唯一标识
  label: string; // 显示名称
  currency: string; // 货币类型
  symbol: string; // 货币符号
  codePrefix: string[]; // 代码前缀数组，用于匹配持仓
  visible: boolean; // 是否显示
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

  // Index Categories State
  indexCategories: IndexCategory[]; // 指数分类栏目列表
  setIndexCategories: (categories: IndexCategory[]) => void; // 设置分类栏目
  addIndexCategory: (category: Omit<IndexCategory, 'id' | 'order'>) => void; // 添加分类
  updateIndexCategory: (id: string, updates: Partial<IndexCategory>) => void; // 更新分类
  deleteIndexCategory: (id: string) => void; // 删除分类
  reorderIndexCategories: (categories: IndexCategory[]) => void; // 重新排序

  // Market Configuration State
  marketConfigs: MarketConfig[]; // 市场配置列表
  setMarketConfigs: (configs: MarketConfig[]) => void; // 设置市场配置

  // Portfolio State
  portfolios: Portfolio[];
  selectedPortfolioId: string | null;
  selectedPortfolioDetail: PortfolioDetail | null;
  isLoadingPortfolios: boolean;
  isLoadingPortfolioDetail: boolean;
  portfolioError: string | null;

  // Actions (Placeholders - implementation in store)
  fetchMarketIndices: () => Promise<void>; // Updated signature for Task 7.2
  fetchStockQuotes: (codes: string[]) => Promise<void>;
  fetchKlineData: (code: string, period?: string, fq?: string) => Promise<void>;

  // Portfolio Actions (Placeholders)
  fetchPortfolios: () => Promise<void>;
  createPortfolio: (data: PortfolioInput) => Promise<void>;
  selectPortfolio: (id: string | null) => void; // Can be synchronous
  fetchPortfolioDetail: (id: string) => Promise<void>;
  addTransaction: (
    portfolioId: string,
    data: TransactionInput
  ) => Promise<void>;
  deleteTransaction: (
    portfolioId: string,
    transactionId: string
  ) => Promise<void>;
  setSelectedIndices: (indices: SelectedIndexItem[]) => void; // Action to set selected indices
  updateTransactionNotes: (
    portfolioId: string,
    transactionId: string,
    notes: string
  ) => Promise<void>;
  updateAttentionInfo: (
    portfolioId: string,
    attentionInfo: string
  ) => Promise<void>;
}
