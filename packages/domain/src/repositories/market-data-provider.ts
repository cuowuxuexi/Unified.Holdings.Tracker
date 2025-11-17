import { Quote, KlinePoint } from '../entities/quote';

export type KlinePeriod = 'daily' | 'weekly' | 'monthly';

export interface KlineRequestOptions {
  period?: KlinePeriod;
  startDate?: string;
  endDate?: string;
  fq?: 'qfq' | 'hfq' | 'none';
  count?: number;
}

export interface MarketDataProvider {
  fetchQuotes(codes: string[]): Promise<Quote[]>;
  fetchKlines(
    code: string,
    options?: KlineRequestOptions
  ): Promise<KlinePoint[]>;
}
