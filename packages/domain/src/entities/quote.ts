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
  weekChangePercent?: number | null;
  monthChangePercent?: number | null;
  yearChangePercent?: number | null;
}

export interface KlinePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
