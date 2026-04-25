import { M2SnapshotStatus } from '@uht/domain/repositories';

export type MacroIndicatorId = 'DXY' | 'US_CPI' | 'US_PMI' | 'US_POLICY_RATE';

export interface MacroIndicatorDefinition {
  indicatorId: MacroIndicatorId;
  sourceSeriesId: string;
  unit: string;
  label: string;
}

export interface MacroIndicatorRequest {
  indicatorIds: MacroIndicatorId[];
  dateFrom?: string;
  dateTo?: string;
  asOfDate?: string;
  maxStaleDays?: number;
}

export interface MacroIndicatorSnapshot {
  date: string;
  indicatorId: MacroIndicatorId;
  value?: number;
  unit: string;
  sourceId: string;
  sourceTime?: Date;
  status: M2SnapshotStatus;
  errorSummary?: string;
}

export interface MacroIndicatorSeries {
  indicatorId: MacroIndicatorId;
  records: MacroIndicatorSnapshot[];
}

export type MacroHttpFetcher = (
  url: string,
  init: { signal: AbortSignal }
) => Promise<MacroHttpResponse>;

export interface MacroHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export interface FredObservation {
  date: string;
  value: string;
  realtime_start?: string;
  realtime_end?: string;
}

export interface FredObservationResponse {
  observations?: FredObservation[];
  error_code?: number | string;
  error_message?: string;
}
