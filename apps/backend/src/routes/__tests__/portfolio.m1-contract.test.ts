import express from 'express';
import request from 'supertest';
import portfolioRouter from '../portfolio';
import { prisma } from '../../lib/prisma';
import { periodReportService } from '../../services/periodReportService';
import {
  getExchangeRate,
  getExchangeRateInfo,
} from '../../services/currencyService';
import { getPortfolioOverviewContext } from '../../services/overviewContextService';
import { getPortfolioHistoryContext } from '../../services/portfolioHistoryContextService';

jest.mock('../../container', () => ({
  container: {
    listPortfoliosUseCase: { execute: jest.fn() },
  },
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    asset: { updateMany: jest.fn() },
    portfolio: { findUnique: jest.fn(), update: jest.fn() },
    portfolioSnapshot: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

jest.mock('../../services/periodReportService', () => ({
  periodReportService: {
    getPeriodReport: jest.fn(),
    formatReportAsMarkdown: jest.fn(),
  },
}));

jest.mock('../../services/currencyService', () => ({
  getExchangeRate: jest.fn(),
  getExchangeRateInfo: jest.fn(),
}));

jest.mock('../../services/storage.prisma', () => ({
  correctHistoricalTransactionAmounts: jest.fn(),
}));

jest.mock('../../services/portfolioStatsService', () => ({
  portfolioStatsService: {
    clearCache: jest.fn(),
    getFullStats: jest.fn(),
  },
}));

jest.mock('../../services/tencentApi', () => ({
  fetchQuotes: jest.fn(),
}));

jest.mock('../../services/overviewContextService', () => ({
  getPortfolioOverviewContext: jest.fn(),
}));

jest.mock('../../services/portfolioHistoryContextService', () => {
  const actual = jest.requireActual(
    '../../services/portfolioHistoryContextService'
  );
  return {
    ...actual,
    getPortfolioHistoryContext: jest.fn(),
  };
});

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/portfolio', portfolioRouter);
  return app;
}

describe('portfolio M1 contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid period-report period and impossible dates', async () => {
    const invalidPeriod = await request(createTestApp()).get(
      '/api/portfolio/p1/period-report?period=quarterly&envelope=true'
    );
    expect(invalidPeriod.status).toBe(400);
    expect(invalidPeriod.body.errors[0].code).toBe('invalid_period');

    const invalidDate = await request(createTestApp()).get(
      '/api/portfolio/p1/period-report?from=2026-99-99&to=2026-03-05&envelope=true'
    );
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.errors[0].code).toBe('invalid_date');
    expect(periodReportService.getPeriodReport).not.toHaveBeenCalled();
  });

  it('returns period-report envelope without changing default report payload', async () => {
    (periodReportService.getPeriodReport as jest.Mock).mockResolvedValue({
      portfolioId: 'p1',
      ok: true,
    });

    const envelopeResponse = await request(createTestApp()).get(
      '/api/portfolio/p1/period-report?from=2026-03-01&to=2026-03-05&envelope=true'
    );
    expect(envelopeResponse.status).toBe(200);
    expect(envelopeResponse.body.data).toEqual({ portfolioId: 'p1', ok: true });
    expect(envelopeResponse.body.meta).toEqual(
      expect.objectContaining({
        portfolioId: 'p1',
        requested_from: '2026-03-01',
        requested_to: '2026-03-05',
        period: 'custom',
      })
    );

    const legacyResponse = await request(createTestApp()).get(
      '/api/portfolio/p1/period-report?from=2026-03-01&to=2026-03-05'
    );
    expect(legacyResponse.status).toBe(200);
    expect(legacyResponse.body).toEqual({ portfolioId: 'p1', ok: true });
  });

  it('validates snapshot-data date as a real calendar date', async () => {
    const response = await request(createTestApp()).get(
      '/api/portfolio/p1/snapshot-data?date=2026-99-99&envelope=true'
    );

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe('invalid_date');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns snapshot-data envelope while keeping legacy shape available', async () => {
    (prisma.$queryRawUnsafe as jest.Mock)
      .mockResolvedValueOnce([{ id: 1, totalMarketValue: 100 }])
      .mockResolvedValueOnce([{ assetCode: 'sh600519', marketValue: 100 }])
      .mockResolvedValueOnce([{ assetCode: 'sh600519', currentPrice: 100 }])
      .mockResolvedValueOnce([{ indexCode: 'sh000001' }])
      .mockResolvedValueOnce([{ pair: 'USD-CNY', rate: 7.2 }]);

    const response = await request(createTestApp()).get(
      '/api/portfolio/p1/snapshot-data?date=2026-04-24&envelope=true'
    );

    expect(response.status).toBe(200);
    expect(response.body.data.portfolioId).toBe('p1');
    expect(response.body.data.portfolio).toEqual({
      id: 1,
      totalMarketValue: 100,
    });
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        requested_date: '2026-04-24',
        resolved_date: '2026-04-24',
      })
    );
  });

  it('returns exchange-rates envelope on opt-in', async () => {
    (getExchangeRate as jest.Mock)
      .mockResolvedValueOnce(7.2)
      .mockResolvedValueOnce(0.92);
    (getExchangeRateInfo as jest.Mock).mockReturnValue({
      timestamp: '2026-04-24T00:00:00.000Z',
    });

    const response = await request(createTestApp()).get(
      '/api/portfolio/exchange-rates?envelope=true'
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      USD: 7.2,
      HKD: 0.92,
      CNY: 1,
      updatedAt: '2026-04-24T00:00:00.000Z',
    });
    expect(response.body.meta.source).toBe('uht.exchange-rates');
  });

  it('validates overview-context date as a real calendar date', async () => {
    const response = await request(createTestApp()).get(
      '/api/portfolio/p1/overview-context?date=2026-99-99'
    );

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe('invalid_date');
    expect(getPortfolioOverviewContext).not.toHaveBeenCalled();
  });

  it('returns overview-context standard envelope', async () => {
    (getPortfolioOverviewContext as jest.Mock).mockResolvedValue({
      statusCode: 200,
      body: {
        data: {
          portfolio: { portfolioId: 'p1', net_assets: 100 },
          fx: { pairs: [] },
          yield: null,
          market: { requested: [], found: [], missing: [] },
          macro: null,
          source_health: { sources: [] },
        },
        meta: {
          portfolioId: 'p1',
          requested_date: '2026-04-25',
          resolved_date: '2026-04-24',
          latest_available_date: '2026-04-24',
          source: 'uht.overview-context',
          generated_at: '2026-04-25T10:00:00.000Z',
        },
        warnings: [
          {
            code: 'date_resolved_to_latest_available',
            message: 'resolved',
          },
        ],
        errors: [],
      },
    });

    const response = await request(createTestApp()).get(
      '/api/portfolio/p1/overview-context?date=2026-04-25'
    );

    expect(response.status).toBe(200);
    expect(response.body.data.portfolio.net_assets).toBe(100);
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        requested_date: '2026-04-25',
        resolved_date: '2026-04-24',
        latest_available_date: '2026-04-24',
        source: 'uht.overview-context',
      })
    );
    expect(response.body.warnings[0].code).toBe(
      'date_resolved_to_latest_available'
    );
    expect(getPortfolioOverviewContext).toHaveBeenCalledWith({
      portfolioId: 'p1',
      requestedDate: '2026-04-25',
    });
  });

  it('validates history-context year and date before calling service', async () => {
    const invalidYear = await request(createTestApp()).get(
      '/api/portfolio/p1/history-context?year=26'
    );
    expect(invalidYear.status).toBe(400);
    expect(invalidYear.body.errors[0].code).toBe('invalid_year');

    const invalidDate = await request(createTestApp()).get(
      '/api/portfolio/p1/history-context?year=2026&date=2026-99-99'
    );
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.errors[0].code).toBe('invalid_date');
    expect(getPortfolioHistoryContext).not.toHaveBeenCalled();
  });

  it('returns history-context standard M7 envelope', async () => {
    (getPortfolioHistoryContext as jest.Mock).mockResolvedValue({
      statusCode: 200,
      body: {
        data: {
          portfolio_year_window: {
            year: 2026,
            planned_start: '2026-01-01',
            effective_start: '2026-04-24',
            requested_end: '2026-04-25',
            resolved_end: '2026-04-24',
            latest_available_date: '2026-04-24',
            snapshot_days: 1,
            missing_days: [],
          },
          external_data_window: {
            start: '2026-01-01',
            end: '2026-04-24',
            first_phase_min_start: '2024-01-01',
          },
          portfolio: { series: [], cashflows: [], positions_by_date: [] },
          fx: { pairs: [] },
          market: { requested_assets: [] },
          yield: { records: [], spreads: {} },
          macro: { records: [] },
          source_health: { current: [], runs: [] },
        },
        meta: {
          portfolioId: 'p1',
          year: 2026,
          requested_date: '2026-04-25',
          resolved_date: '2026-04-24',
          latest_available_date: '2026-04-24',
          source: 'uht.history-context',
          contract_version: 'm7.v0.1',
          generated_at: '2026-04-25T10:00:00.000Z',
        },
        warnings: [
          {
            code: 'date_resolved_to_latest_available',
            message: 'resolved',
          },
        ],
        errors: [],
      },
    });

    const response = await request(createTestApp()).get(
      '/api/portfolio/p1/history-context?year=2026&date=2026-04-25&include=portfolio,fx'
    );

    expect(response.status).toBe(200);
    expect(response.body.data.portfolio_year_window).toBeDefined();
    expect(response.body.data.external_data_window).toBeDefined();
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        source: 'uht.history-context',
        contract_version: 'm7.v0.1',
        resolved_date: '2026-04-24',
      })
    );
    expect(getPortfolioHistoryContext).toHaveBeenCalledWith({
      portfolioId: 'p1',
      year: 2026,
      requestedDate: '2026-04-25',
      include: 'portfolio,fx',
    });
  });
});
