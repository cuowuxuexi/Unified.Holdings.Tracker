// 市场枚举
export enum Market { CN = 'CN', HK = 'HK', US = 'US' }

// 资产基础信息
export interface Asset {
  code: string; // 包含市场前缀，如 sh600519, hk00700, usAAPL
  name: string;
  market: Market;
}

// 交易类型
export enum TransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  DEPOSIT = 'DEPOSIT', // 存入现金
  WITHDRAW = 'WITHDRAW', // 取出现金
  LEVERAGE_ADD = 'LEVERAGE_ADD', // 增加杠杆额度
  LEVERAGE_REMOVE = 'LEVERAGE_REMOVE', // 减少杠杆额度
  LEVERAGE_COST = 'LEVERAGE_COST', // 记录杠杆利息支出
  DIVIDEND = 'DIVIDEND' // 新增：收到股息
}

// 交易记录
export interface Transaction {
  id: string; // 唯一 ID (e.g., UUID)
  date: string; // ISO 8601 格式日期时间字符串
  type: TransactionType;
  assetCode?: string; // 关联的资产代码 (买卖时)
  quantity?: number; // 交易数量 (买卖时)
  price?: number; // 交易价格 (买卖时)
  amount?: number; // 交易总额 (买卖时) 或 存取金额 或 杠杆调整金额/成本
  commission?: number; // 佣金 (可选)
  leverageUsed?: number; // 用于记录交易中使用的杠杆额度 (可选, 主要用于买入交易)
  notes?: string; // 备注 (可选)
}

// 持仓信息 (通常由后端根据交易记录计算得出)
export interface Position {
  asset: Asset;
  quantity: number;
  costPrice: number; // 持仓成本价
  marketValue: number; // 当前市值 (需要实时价格)
  totalCost: number; // 总成本
  currentPrice?: number; // 当前价格 (来自实时行情)
  dailyChange?: number; // 当日盈亏额 (需要实时价格和昨日收盘价)
  dailyChangePercent?: number; // 当日盈亏百分比
  totalPnl?: number; // 累计盈亏额
  totalPnlPercent?: number; // 累计盈亏百分比
  yearlyChangePercent?: number | null | undefined;
}

// 杠杆信息
export interface LeverageInfo {
  totalAmount: number; // 总授信额度
  usedAmount: number; // 已用额度 (需要计算)
  availableAmount: number; // 可用额度
  costRate: number; // 年化利率 (例如 0.05 表示 5%)
}

// 投资组合
export interface Portfolio {
  id: string; // 唯一 ID
  name: string; // 组合名称
  cash: number; // 现金余额
  /**
   * 初始现金余额：创建投资组合时设定，不随后续交易变动。
   */
  initialCash: number;
  leverage: LeverageInfo; // 杠杆信息
  // positions: Position[]; // 持仓列表通常在请求时由后端计算返回
  transactions: Transaction[]; // 所有交易记录 (持久化存储的核心)
}

// 投资组合详情 (API 返回，包含计算结果)
export interface PortfolioDetail extends Portfolio {
  positions: Position[]; // 计算后的当前持仓
  totalAssets: number; // 总资产 (市值 + 现金)
  netAssets: number; // 净资产 (总资产 - 已用杠杆)
  totalMarketValue: number; // 总市值
  dailyPnl?: number; // 组合当日盈亏
  dailyPnlPercent?: number; // 组合当日盈亏率
  totalPnl?: number; // 组合累计盈亏
  totalPnlPercent?: number; // 组合累计盈亏率 (相对初始投入或考虑现金流入流出)
  /**
   * 净入金：仅由初始现金、所有入金（DEPOSIT）、所有出金（WITHDRAW）决定，反映账户历史实际净投入现金总额。买卖股票、分红、费用等不影响此数值。
   */
  netDepositedCash: number;
  /**
   * 所有买卖交易手续费（折算为CNY）总和
   */
  totalCommission: number;
  /**
   * 融资成本：根据已用融资额度和杠杆年利率计算
   */
  leverageCost: number;
  // ... 其他统计数据
}

// Interface for the data returned by the /portfolio/:id/stats endpoint
// Corresponds to the 'response' object in the route handler
export interface PortfolioStats {
  portfolioId: string;
  name: string;
  cash: number;
  leverage: LeverageInfo;
  totalMarketValue: number; // CNY value
  totalAssets: number; // CNY value
  netAssets: number; // CNY value
  netDepositedCash: number;
  totalCommission: number;
  leverageCost: number;
  totalDividendIncome?: number; // 新增：总股息收入
  dailyPnl: number; // CNY value
  totalPnl: number; // CNY value
  periodReturnPercent?: number | null;
  weeklyStats?: { periodReturnPercent: number | null; periodPnl: number | null };
  monthlyStats?: { periodReturnPercent: number | null; periodPnl: number | null };
  yearlyStats?: { periodReturnPercent: number | null; periodPnl: number | null };
  positions: Position[]; // Assuming Position type includes necessary fields
  timestamp: number;
}

// 实时报价 (从 tencentApi.ts 移入)
export interface Quote {
  code: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  changeAmount: number;
  volume?: number;
  turnover?: number;
  timestamp: number; // 数据时间戳
  openPrice?: number; 
  highPrice?: number; 
  lowPrice?: number; 
  prevClosePrice?: number; 
  marketCap?: number; 
  peRatio?: number; 
  weekChangePercent?: number | null | undefined; 
  monthChangePercent?: number | null | undefined; 
  yearChangePercent?: number | null | undefined;
}

// K 线数据点 (从 tencentApi.ts 移入)
export interface KlinePoint {
  date: string; // 日期 (YYYY-MM-DD)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
