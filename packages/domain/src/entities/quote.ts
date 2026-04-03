export interface Quote {
  code: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  changeAmount: number;
  volume?: number;
  turnover?: number;
  timestamp: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  prevClosePrice?: number;
  marketCap?: number;
  peRatio?: number;
  weeklyChangePercent?: number | null;
  monthlyChangePercent?: number | null;
  yearlyChangePercent?: number | null;
  // 新增高价值字段
  pbRatio?: number; // 市净率
  dividendYield?: number; // 股息率(%)
  high52w?: number; // 52周最高价
  low52w?: number; // 52周最低价
  turnoverRate?: number; // 换手率(%)
  totalShares?: number; // 总股本
  floatShares?: number; // 流通股本
  currency?: string; // 币种标识 (CNY/HKD/USD)
}

export interface KlinePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
