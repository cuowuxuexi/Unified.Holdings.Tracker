import { Transaction } from './transaction';
import { Position } from './position';
import { LeverageInfo } from '../value-objects/leverage-info';

export interface Portfolio {
  id: string;
  name: string;
  cash: number;
  initialCash: number;
  leverage: LeverageInfo;
  attentionInfo?: string;
  transactions: Transaction[];
}

export interface PortfolioDetail extends Portfolio {
  positions: Position[];
  totalAssets: number;
  netAssets: number;
  totalMarketValue: number;
  dailyPnl?: number;
  dailyPnlPercent?: number;
  totalPnl?: number;
  totalPnlPercent?: number;
  netDepositedCash: number;
  totalCommission: number;
  leverageCost: number;
}

export interface PortfolioStats {
  portfolioId: string;
  name: string;
  cash: number;
  leverage: LeverageInfo;
  totalMarketValue: number;
  totalAssets: number;
  netAssets: number;
  netDepositedCash: number;
  totalCommission: number;
  leverageCost: number;
  totalDividendIncome?: number;
  dailyPnl: number;
  totalPnl: number;
  periodReturnPercent?: number | null;
  weeklyStats?: {
    periodReturnPercent: number | null;
    periodPnl: number | null;
  };
  monthlyStats?: {
    periodReturnPercent: number | null;
    periodPnl: number | null;
  };
  yearlyStats?: {
    periodReturnPercent: number | null;
    periodPnl: number | null;
  };
  positions: Position[];
  timestamp: number;
}
