export const FX_PAIRS = ['USD-CNY', 'HKD-CNY'] as const;

export type FxPair = (typeof FX_PAIRS)[number];

export type FxRateStatus = 'success' | 'missing_value' | 'source_failed';

export interface FxRateRecord {
  date: string;
  pair: FxPair;
  rate: number | null;
  sourceId: string;
  sourceTime: string;
  status: FxRateStatus;
  errorSummary?: string;
}

export interface FxRateRequest {
  date?: string;
  pairs?: FxPair[];
}

export interface FxChangeWindowRequest {
  pair: FxPair;
  asOfDate: string;
  comparisonDates: {
    sevenDay?: string;
    thirtyDay?: string;
    ytd?: string;
  };
}

export interface FxChangeWindowPoint {
  date: string;
  pair: FxPair;
  rate: number;
}

export interface FxChangeWindowResult {
  pair: FxPair;
  asOfDate: string;
  currentRate?: number;
  sevenDayChangePercent?: number;
  thirtyDayChangePercent?: number;
  ytdChangePercent?: number;
}

export interface FxRawPayload {
  date?: string;
  sourceTime?: string;
  rates?: Partial<Record<'USD' | 'HKD' | FxPair, number | string | null>>;
  records?: FxRawRecord[];
}

export interface FxRawRecord {
  date?: string;
  pair?: string;
  currency?: string;
  rate?: number | string | null;
  sourceTime?: string;
}

export type FxFetcher = (
  request: FxRateRequest,
  init: { signal: AbortSignal; timeoutMs: number }
) => Promise<FxFetchResponse>;

export interface FxFetchResponse {
  ok: boolean;
  statusCode?: number;
  json?: () => Promise<FxRawPayload>;
  errorText?: string;
}
