import { M2SnapshotStatus } from '@uht/domain/repositories';
import { SourceGatewayErrorCode } from '../../types';

export type YieldCurveCountry = 'CN' | 'US';
export type YieldCurveTenor = '2Y' | '5Y' | '10Y' | '30Y';

export const YIELD_CURVE_COUNTRIES: readonly YieldCurveCountry[] = ['CN', 'US'];
export const YIELD_CURVE_TENORS: readonly YieldCurveTenor[] = [
  '2Y',
  '5Y',
  '10Y',
  '30Y',
];

export interface YieldCurveRequest {
  asOfDate: string;
  countries?: YieldCurveCountry[];
  tenors?: YieldCurveTenor[];
  staleAfterDays?: number;
}

export interface RawYieldCurvePoint {
  date: string;
  country: YieldCurveCountry;
  tenor: YieldCurveTenor;
  yieldPercent?: number | null;
  sourceTime?: string;
}

export interface RawYieldCurveResponse {
  points: RawYieldCurvePoint[];
  sourceTime?: string;
}

export interface YieldCurveRecord {
  date: string;
  country: YieldCurveCountry;
  tenor: YieldCurveTenor;
  yieldPercent?: number;
  sourceId: string;
  sourceTime?: string;
  status: M2SnapshotStatus;
  errorSummary?: string;
}

export interface YieldCurveFetcherResponse {
  ok: boolean;
  data?: RawYieldCurveResponse;
  statusCode?: number;
  error?: string;
  errorCode?: SourceGatewayErrorCode;
  retryable?: boolean;
}

export type YieldCurveFetcher = (
  request: YieldCurveRequest,
  init: { signal: AbortSignal }
) => Promise<YieldCurveFetcherResponse>;

export interface YieldCurveBridgeRequest {
  asOfDate: string;
  startDate: string;
  countries: YieldCurveCountry[];
  tenors: YieldCurveTenor[];
}

export type YieldCurveBridgeRunner = (
  request: YieldCurveBridgeRequest,
  init: { signal: AbortSignal; pythonCommand: string }
) => Promise<YieldCurveFetcherResponse>;

export interface YieldCurveSpreadInput {
  country: YieldCurveCountry;
  twoYearYieldPercent: number;
  tenYearYieldPercent: number;
}

export interface CnUsTenYearSpreadInput {
  cnTenYearYieldPercent: number;
  usTenYearYieldPercent: number;
}

export interface BasisPointChangeInput {
  currentYieldPercent: number;
  prior7dYieldPercent?: number;
  prior30dYieldPercent?: number;
}

export interface BasisPointChangeResult {
  change7dBp?: number;
  change30dBp?: number;
}
