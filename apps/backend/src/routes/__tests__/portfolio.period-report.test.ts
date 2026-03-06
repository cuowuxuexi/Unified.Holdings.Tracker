import express from 'express';
import request from 'supertest';
import portfolioRouter from '../portfolio';
import { container } from '../../container';
import { prisma } from '../../lib/prisma';
import { periodReportService } from '../../services/periodReportService';

jest.mock('../../container', () => ({
  container: {
    listPortfoliosUseCase: {
      execute: jest.fn(),
    },
  },
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    asset: {
      updateMany: jest.fn(),
    },
    portfolio: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    portfolioSnapshot: {
      findMany: jest.fn(),
    },
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

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/portfolio', portfolioRouter);
  return app;
}

describe('portfolio period-report compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-06T08:00:00.000Z'));

    (container.listPortfoliosUseCase.execute as jest.Mock).mockResolvedValue(
      []
    );
    (prisma.portfolioSnapshot.findMany as jest.Mock).mockResolvedValue([]);
    (periodReportService.getPeriodReport as jest.Mock).mockResolvedValue({
      portfolioId: 'p1',
    });
    (periodReportService.formatReportAsMarkdown as jest.Mock).mockReturnValue(
      '# report'
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('兼容旧版 /period-report 调用并自动定位唯一组合', async () => {
    (container.listPortfoliosUseCase.execute as jest.Mock).mockResolvedValue([
      { id: 'p1', name: '主组合' },
    ]);

    const response = await request(createTestApp()).get(
      '/api/portfolio/period-report?period=daily&format=markdown'
    );

    expect(response.status).toBe(200);
    expect(response.text).toBe('# report');
    expect(response.headers['x-uht-resolved-portfolio-id']).toBe('p1');
    expect(periodReportService.getPeriodReport).toHaveBeenCalledWith(
      'p1',
      '2026-03-05',
      '2026-03-06',
      'daily'
    );
  });

  it('多组合时可按快照范围唯一推断目标组合', async () => {
    (container.listPortfoliosUseCase.execute as jest.Mock).mockResolvedValue([
      { id: 'p1', name: '组合一' },
      { id: 'p2', name: '组合二' },
    ]);
    (prisma.portfolioSnapshot.findMany as jest.Mock).mockResolvedValue([
      { portfolioId: 'p2' },
    ]);
    (periodReportService.getPeriodReport as jest.Mock).mockResolvedValue({
      portfolioId: 'p2',
      ok: true,
    });

    const response = await request(createTestApp()).get(
      '/api/portfolio/period-report?from=2026-03-05&to=2026-03-05'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      portfolioId: 'p2',
      ok: true,
    });
    expect(response.headers['x-uht-resolved-portfolio-id']).toBe('p2');
    expect(periodReportService.getPeriodReport).toHaveBeenCalledWith(
      'p2',
      '2026-03-05',
      '2026-03-05',
      'custom'
    );
  });

  it('多组合且无法唯一推断时明确要求传 portfolioId', async () => {
    (container.listPortfoliosUseCase.execute as jest.Mock).mockResolvedValue([
      { id: 'p1', name: '组合一' },
      { id: 'p2', name: '组合二' },
    ]);
    (prisma.portfolioSnapshot.findMany as jest.Mock).mockResolvedValue([
      { portfolioId: 'p1' },
      { portfolioId: 'p2' },
    ]);

    const response = await request(createTestApp()).get(
      '/api/portfolio/period-report?from=2026-03-05&to=2026-03-05'
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('portfolioId');
    expect(periodReportService.getPeriodReport).not.toHaveBeenCalled();
  });
});
