import { Asset } from './asset';

export interface Position {
  asset: Asset;
  quantity: number;
  costPrice: number;
  marketValue: number;
  /**
   * 摊薄成本 = 累计买入 - 累计卖出（可为负数）
   * 用于显示个股成本价
   */
  totalCost: number;
  /**
   * 累计买入成本（只增不减）
   * 用于计算收益率的分母，避免负成本导致的计算错误
   */
  totalBuyCost?: number;
  /**
   * 摊薄价 = (累计买入成本 - 累计股息) / 持仓数量
   * 与雪球的"摊薄"概念一致
   */
  dilutedPrice?: number;
  /**
   * 累计股息收入
   */
  totalDividend?: number;
  /**
   * 浮动盈亏 = (现价 - 成本价) × 数量
   * 与雪球的"浮动盈亏"计算方式一致
   */
  floatingPnl?: number;
  /**
   * 浮动盈亏百分比
   */
  floatingPnlPercent?: number;
  currentPrice?: number;
  dailyChange?: number;
  dailyChangePercent?: number;
  totalPnl?: number;
  totalPnlPercent?: number;
  yearlyChangePercent?: number | null;
}
