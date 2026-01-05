import {
  Market,
  Asset,
  TransactionType,
  Transaction,
  LeverageInfo,
  Portfolio as DomainPortfolio,
  Position as DomainPosition,
  Quote,
  KlinePoint,
} from '@uht/domain';

export {
  Market,
  Asset,
  TransactionType,
  Transaction,
  LeverageInfo,
  Quote,
  KlinePoint,
};

type PeriodPriceSource = 'realtime' | 'kline' | 'cost';

export interface PeriodStat {
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
  baseDateSource?: PeriodPriceSource;
  endDate?: string | null;
  endDateSource?: PeriodPriceSource;
  fallbackDays?: number;
}

/**
 * 持仓信息（通常由后端根据交易记录计算得出）
 *
 * **重要说明**：后端返回的持仓数据中，所有金额字段（costPrice, marketValue, totalCost等）
 * 默认均为**人民币(CNY)**计价，已经经过汇率转换。前端不应再次应用汇率转换。
 *
 * 对于港股和美股，后端会额外提供原币种字段（如 costPriceLocal, marketValueLocal），
 * 但主字段（costPrice, marketValue等）始终为人民币。
 */
export interface Position extends DomainPosition {
  /**
   * 记录交易货币类型（CNY/USD/HKD），仅用于标识原币种
   * 注意：此字段不影响数据转换，主字段已为人民币
   */
  currency?: string;

  /**
   * 原币种维度的成本价（单位：原币种）
   * - 港股：HKD
   * - 美股：USD
   * - A股：CNY（与 costPrice 相同）
   */
  costPriceLocal?: number;

  /**
   * 原币种维度的总成本（单位：原币种）
   */
  totalCostLocal?: number;

  /**
   * 累计买入成本（CNY，只增不减）
   * 用于计算收益率的分母，避免负成本导致的计算错误
   */
  totalBuyCost?: number;

  /**
   * 原币种维度的累计买入成本（只增不减）
   */
  totalBuyCostLocal?: number;

  /**
   * 原币种维度的市值（单位：原币种）
   */
  marketValueLocal?: number;

  /**
   * 人民币市值（单位：CNY/人民币）
   * - 与 marketValue 含义相同
   * - 保留此字段以兼容旧代码
   * @deprecated 使用 marketValue 字段即可
   */
  marketValueCNY?: number;

  /**
   * 原币种维度的当日盈亏额（单位：原币种）
   */
  dailyChangeLocal?: number;

  /**
   * 原币种维度的累计盈亏额（单位：原币种）
   */
  totalPnlLocal?: number;

  /**
   * 摊薄价（人民币）= (累计买入成本 - 累计股息) / 持仓数量
   * 与雪球的"摊薄"概念一致
   */
  dilutedPrice?: number;

  /**
   * 摊薄价（原币种）
   */
  dilutedPriceLocal?: number;

  /**
   * 累计股息收入（人民币）
   */
  totalDividend?: number;

  /**
   * 累计股息收入（原币种）
   */
  totalDividendLocal?: number;

  /**
   * 浮动盈亏（人民币）= (现价 - 成本价) × 数量
   * 与雪球的"浮动盈亏"计算方式一致
   */
  floatingPnl?: number;

  /**
   * 浮动盈亏（原币种）
   */
  floatingPnlLocal?: number;

  /**
   * 浮动盈亏百分比
   */
  floatingPnlPercent?: number;

  /**
   * 周涨跌幅（百分比数值形式）
   * - 例如：18.18 表示 18.18%，-5.5 表示 -5.5%
   * - 前端显示时无需乘以 100
   */
  weeklyChangePercent?: number | null | undefined;

  /**
   * 月涨跌幅（百分比数值形式）
   * - 例如：25.0 表示 25%，-10.0 表示 -10%
   * - 前端显示时无需乘以 100
   */
  monthlyChangePercent?: number | null | undefined;
}

// 投资组合
// 直接使用 Domain 的定义，因为 Transaction 也是兼容的
export type Portfolio = DomainPortfolio;

// 投资组合详情 (API 返回，包含计算结果)
export interface PortfolioDetail extends Portfolio {
  positions: Position[]; // 计算后的当前持仓 (使用扩展后的 Position)
  totalAssets: number; // 总资产 (市值 + 现金)
  netAssets: number; // 净资产 (总资产 - 已用杠杆)
  totalMarketValue: number; // 总市值
  dailyPnl?: number; // 组合当日盈亏
  dailyPnlPercent?: number; // 组合当日盈亏率
  totalPnl?: number; // 组合累计盈亏
  totalPnlPercent?: number; // 组合累计盈亏率 (相对初始投入或考虑现金流入流出)
  realizedPnl?: number; // 已实现盈亏
  unrealizedPnl?: number; // 未实现盈亏（浮动盈亏）
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
  /**
   * 周期统计数据（用于报表、概览等，可选）
   */
  weeklyStats?: PeriodStat;
  monthlyStats?: PeriodStat;
  yearlyStats?: PeriodStat;
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
  realizedPnl?: number; // 已实现盈亏
  unrealizedPnl?: number; // 未实现盈亏（浮动盈亏）
  periodReturnPercent?: number | null;
  weeklyStats?: PeriodStat;
  monthlyStats?: PeriodStat;
  yearlyStats?: PeriodStat;
  positions: Position[]; // Assuming Position type includes necessary fields
  timestamp: number;
}
