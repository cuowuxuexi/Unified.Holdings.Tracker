import express from 'express';
import request from 'supertest';
import marketDataRouter from '../marketData';
import { fetchQuotes, fetchKline } from '../../services/tencentApi';

jest.mock('../../services/tencentApi', () => ({
  fetchQuotes: jest.fn(),
  fetchKline: jest.fn(),
}));

function createTestApp() {
  const app = express();
  app.use('/api/market', marketDataRouter);
  return app;
}

describe('market data M1 contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps legacy quote array response while adding diagnostic headers', async () => {
    (fetchQuotes as jest.Mock).mockResolvedValue([
      {
        code: 'sh600519',
        name: '贵州茅台',
        currentPrice: 100,
        changePercent: 1,
        changeAmount: 1,
      },
    ]);

    const response = await request(createTestApp()).get(
      '/api/market/quote?codes=sh600519'
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0].code).toBe('sh600519');
    expect(response.headers['x-uht-requested-codes']).toBe('sh600519');
    expect(response.headers['x-uht-found-codes']).toBe('sh600519');
  });

  it('returns quote envelope diagnostics for requested/found/missing/invalid', async () => {
    (fetchQuotes as jest.Mock).mockResolvedValue([
      {
        code: 'sh600519',
        name: '贵州茅台',
        currentPrice: 100,
        changePercent: 1,
        changeAmount: 1,
      },
    ]);

    const response = await request(createTestApp()).get(
      '/api/market/quote?codes=sh600519,bad,hk00700&envelope=true'
    );

    expect(response.status).toBe(200);
    expect(fetchQuotes).toHaveBeenCalledWith(['sh600519', 'hk00700']);
    expect(response.body.data.requested).toEqual([
      'sh600519',
      'bad',
      'hk00700',
    ]);
    expect(response.body.data.found).toEqual(['sh600519']);
    expect(response.body.data.missing).toEqual(['hk00700']);
    expect(response.body.data.invalid).toEqual([
      expect.objectContaining({ code: 'bad' }),
    ]);
    expect(
      response.body.warnings.map((item: { code: string }) => item.code)
    ).toEqual(['market_data_missing', 'invalid_codes_ignored']);
  });

  it('rejects quote requests with no valid codes', async () => {
    const response = await request(createTestApp()).get(
      '/api/market/quote?codes=bad&envelope=true'
    );

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe('invalid_codes');
    expect(fetchQuotes).not.toHaveBeenCalled();
  });

  it('returns kline envelope diagnostics and passes validated count', async () => {
    (fetchKline as jest.Mock).mockResolvedValue([
      { date: '2026-04-24', open: 1, close: 2, high: 3, low: 1, volume: 100 },
    ]);

    const response = await request(createTestApp()).get(
      '/api/market/kline?code=sh600519&period=daily&count=2&envelope=true'
    );

    expect(response.status).toBe(200);
    expect(fetchKline).toHaveBeenCalledWith(
      'sh600519',
      'daily',
      undefined,
      undefined,
      'qfq',
      2
    );
    expect(response.body.data.found).toEqual(['sh600519']);
    expect(response.body.data.missing).toEqual([]);
    expect(response.body.data.points).toHaveLength(1);
  });

  it('rejects invalid kline period/date/count before hitting upstream', async () => {
    const invalidPeriod = await request(createTestApp()).get(
      '/api/market/kline?code=sh600519&period=hourly&envelope=true'
    );
    expect(invalidPeriod.status).toBe(400);
    expect(invalidPeriod.body.errors[0].code).toBe('invalid_period');

    const invalidDate = await request(createTestApp()).get(
      '/api/market/kline?code=sh600519&startDate=2026-02-30&envelope=true'
    );
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.errors[0].code).toBe('invalid_date');

    const invalidCount = await request(createTestApp()).get(
      '/api/market/kline?code=sh600519&count=0&envelope=true'
    );
    expect(invalidCount.status).toBe(400);
    expect(invalidCount.body.errors[0].code).toBe('invalid_count');
    expect(fetchKline).not.toHaveBeenCalled();
  });
});
