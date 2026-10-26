import express from 'express';
import request from 'supertest';
import preferencesRouter, { parseWatchlistPayload } from '../preferences';
import { prisma } from '../../lib/prisma';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

const validPayload = {
  selectedIndices: [
    {
      code: 'sh000001',
      name: '上证指数',
      visible: true,
      categoryId: 'market',
    },
    {
      code: 'sz399006',
      name: '创业板指',
      visible: true,
      categoryId: 'market',
    },
  ],
  indexCategories: [
    { id: 'market', label: '大盘', order: 0, visible: true },
    { id: 'stock', label: '个股', order: 1, visible: true },
  ],
  marketConfigs: [
    {
      key: 'A股',
      label: 'A股',
      currency: 'CNY',
      symbol: '¥',
      codePrefix: ['sh', 'sz'],
      visible: true,
    },
  ],
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/preferences', preferencesRouter);
  return app;
}

describe('watchlist preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts optional shelf coordinates on index items', () => {
    expect(
      parseWatchlistPayload({
        ...validPayload,
        selectedIndices: [
          {
            code: 'sh000001',
            name: '上证指数',
            visible: true,
            categoryId: 'market',
            row: 0,
            col: 0,
          },
          {
            code: 'sz399006',
            name: '创业板指',
            visible: true,
            categoryId: 'market',
            row: 0,
            col: 1,
          },
        ],
      })?.selectedIndices[1]
    ).toMatchObject({ code: 'sz399006', row: 0, col: 1 });
  });

  it('rejects incomplete payloads', () => {
    expect(parseWatchlistPayload({})).toBeNull();
    expect(
      parseWatchlistPayload({
        ...validPayload,
        selectedIndices: [{ code: '' }],
      })
    ).toBeNull();
  });

  it('returns exists=false when nothing is stored', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const response = await request(createTestApp()).get(
      '/api/preferences/watchlist'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: false });
  });

  it('returns stored watchlist', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      {
        key: 'watchlist',
        value: JSON.stringify(validPayload),
        updatedAt: '2026-10-26T06:00:00.000Z',
      },
    ]);

    const response = await request(createTestApp()).get(
      '/api/preferences/watchlist'
    );

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(true);
    expect(response.body.selectedIndices).toHaveLength(2);
    expect(response.body.selectedIndices[1].code).toBe('sz399006');
  });

  it('persists a valid watchlist', async () => {
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    const response = await request(createTestApp())
      .put('/api/preferences/watchlist')
      .send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body.exists).toBe(true);
    expect(response.body.selectedIndices[1].name).toBe('创业板指');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('rejects invalid put body', async () => {
    const response = await request(createTestApp())
      .put('/api/preferences/watchlist')
      .send({ selectedIndices: [] });

    expect(response.status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
