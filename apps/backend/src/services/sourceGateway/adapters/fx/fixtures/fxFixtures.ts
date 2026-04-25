import { FxFetchResponse, FxRawPayload } from '../types';

export const successfulFxPayload: FxRawPayload = {
  date: '2026-04-24',
  sourceTime: '2026-04-24T16:30:00.000Z',
  rates: {
    USD: 7.2468,
    HKD: 0.9234,
  },
};

export const missingValueFxPayload: FxRawPayload = {
  date: '2026-04-24',
  sourceTime: '2026-04-24T16:30:00.000Z',
  rates: {
    USD: 7.2468,
    HKD: null,
  },
};

export const duplicateDateFxPayload: FxRawPayload = {
  records: [
    {
      date: '2026-04-24',
      pair: 'USD-CNY',
      rate: 7.2,
      sourceTime: '2026-04-24T09:00:00.000Z',
    },
    {
      date: '2026-04-24',
      pair: 'USD-CNY',
      rate: 7.25,
      sourceTime: '2026-04-24T16:00:00.000Z',
    },
    {
      date: '2026-04-24',
      pair: 'HKD-CNY',
      rate: 0.92,
      sourceTime: '2026-04-24T16:00:00.000Z',
    },
  ],
};

export const sourceFailureFxResponse: FxFetchResponse = {
  ok: false,
  statusCode: 503,
  errorText: 'upstream unavailable',
};

export function jsonResponse(payload: FxRawPayload): FxFetchResponse {
  return {
    ok: true,
    statusCode: 200,
    json: async () => payload,
  };
}
