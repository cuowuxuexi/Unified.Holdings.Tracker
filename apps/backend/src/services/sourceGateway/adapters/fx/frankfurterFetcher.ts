import axios from 'axios';
import {
  fetchExchangeRatesHistory,
  FetchExchangeRatesHistoryRequest,
  HistoricalRateRecord,
} from '@uht/infra';
import { createFxAdapter } from './adapter';
import { FX_PAIRS, FxFetchResponse, FxFetcher, FxRawPayload } from './types';

export const FRANKFURTER_FX_SOURCE_ID = 'frankfurter.fx.v1';

type FetchRatesFn = (
  request: FetchExchangeRatesHistoryRequest
) => Promise<HistoricalRateRecord[]>;

export function createFrankfurterFxFetcher(
  options: {
    fetchRates?: FetchRatesFn;
  } = {}
): FxFetcher {
  const fetchRates = options.fetchRates ?? fetchExchangeRatesHistory;

  return async (request, init): Promise<FxFetchResponse> => {
    try {
      const records = await fetchRates({
        pairs: request.pairs ?? [...FX_PAIRS],
        date: request.date,
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
        signal: init.signal,
        timeoutMs: init.timeoutMs,
      });

      return {
        ok: true,
        statusCode: 200,
        json: async (): Promise<FxRawPayload> => ({
          records: records.map((record) => ({
            date: record.date,
            pair: record.pair,
            rate: record.rate,
            sourceTime: record.timestamp,
          })),
        }),
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: getStatusCode(error),
        errorText: getErrorText(error),
      };
    }
  };
}

export function createFrankfurterFxAdapter(
  options: {
    fetchRates?: FetchRatesFn;
    sourceId?: string;
  } = {}
) {
  return createFxAdapter({
    sourceId: options.sourceId ?? FRANKFURTER_FX_SOURCE_ID,
    fetcher: createFrankfurterFxFetcher({
      fetchRates: options.fetchRates,
    }),
  });
}

function getStatusCode(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }

  const candidate = error as { statusCode?: unknown };
  return typeof candidate?.statusCode === 'number'
    ? candidate.statusCode
    : undefined;
}

function getErrorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
