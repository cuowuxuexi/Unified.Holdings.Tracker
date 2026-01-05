import { Portfolio } from '../entities/portfolio';
import { Transaction } from '../entities/transaction';
import { LeverageInfo } from '../value-objects/leverage-info';

export interface CreatePortfolioInput {
  name: string;
  initialCash: number;
  leverage?: Partial<LeverageInfo>;
}

export type NewTransactionInput = Omit<Transaction, 'id'> & {
  id?: string;
};

export interface PortfolioRepository {
  findAll(): Promise<Portfolio[]>;
  findById(id: string): Promise<Portfolio | null>;
  create(input: CreatePortfolioInput): Promise<Portfolio>;
  save(portfolio: Portfolio): Promise<void>;
  delete(id: string): Promise<void>;
  addTransaction(
    portfolioId: string,
    transaction: NewTransactionInput
  ): Promise<Portfolio>;
  removeTransaction(
    portfolioId: string,
    transactionId: string
  ): Promise<Portfolio>;
  recalculateCash(portfolioId: string): Promise<Portfolio>;
  correctHistoricalTransactions?(): Promise<void>;
  updateTransactionNotes?(
    portfolioId: string,
    transactionId: string,
    notes: string
  ): Promise<Transaction | null>;
  updatePortfolioAttention?(
    portfolioId: string,
    attentionInfo: string
  ): Promise<Portfolio | null>;
}
