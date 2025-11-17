export enum TransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  DEPOSIT = 'DEPOSIT',
  WITHDRAW = 'WITHDRAW',
  LEVERAGE_ADD = 'LEVERAGE_ADD',
  LEVERAGE_REMOVE = 'LEVERAGE_REMOVE',
  LEVERAGE_COST = 'LEVERAGE_COST',
  DIVIDEND = 'DIVIDEND',
}

export interface Transaction {
  id: string;
  portfolioId?: string;
  date: string;
  type: TransactionType;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
}
