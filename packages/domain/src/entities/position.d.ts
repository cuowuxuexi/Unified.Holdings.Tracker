import { Asset } from './asset';
export interface Position {
  asset: Asset;
  quantity: number;
  costPrice: number;
  marketValue: number;
  totalCost: number;
  currentPrice?: number;
  dailyChange?: number;
  dailyChangePercent?: number;
  totalPnl?: number;
  totalPnlPercent?: number;
  yearlyChangePercent?: number | null;
}
//# sourceMappingURL=position.d.ts.map
