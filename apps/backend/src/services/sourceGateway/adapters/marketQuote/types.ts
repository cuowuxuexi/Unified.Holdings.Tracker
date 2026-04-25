import { KlinePoint, Quote } from '@uht/domain';

export type MarketQuoteOperation = 'quote' | 'kline';
export type KlinePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type FqType = 'qfq' | 'hfq' | 'none';

export interface InvalidCodeDiagnostic {
  code: string;
  reason: string;
}

export interface MarketCodeDiagnostics {
  requested: string[];
  valid: string[];
  invalid: InvalidCodeDiagnostic[];
}

export interface MarketQuoteDiagnosticSummary {
  requested: string[];
  found: string[];
  missing: string[];
  invalid: InvalidCodeDiagnostic[];
}

export interface MarketQuoteFreshness {
  latestTimestamp: number | null;
  latestIso: string | null;
}

export interface QuoteRequest {
  kind: 'quote';
  codes: string[];
}

export interface KlineRequest {
  kind: 'kline';
  code: string;
  period?: KlinePeriod;
  startDate?: string;
  endDate?: string;
  fq?: FqType;
  count?: number;
}

export type MarketQuoteRequest = QuoteRequest | KlineRequest;

export interface QuoteResponse extends MarketQuoteDiagnosticSummary {
  kind: 'quote';
  quotes: Quote[];
  freshness: MarketQuoteFreshness;
}

export interface KlineResponse extends MarketQuoteDiagnosticSummary {
  kind: 'kline';
  code: string | null;
  period: KlinePeriod;
  fq: FqType;
  count: number;
  points: KlinePoint[];
  freshness: MarketQuoteFreshness;
}

export type MarketQuoteResponse = QuoteResponse | KlineResponse;

export interface MarketQuoteFetcher {
  fetchQuotes(codes: string[]): Promise<Quote[]>;
  fetchKline(
    code: string,
    period: KlinePeriod,
    startDate: string | undefined,
    endDate: string | undefined,
    fq: FqType,
    count: number
  ): Promise<KlinePoint[]>;
}
