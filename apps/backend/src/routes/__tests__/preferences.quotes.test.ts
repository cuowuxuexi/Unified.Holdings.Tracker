import express from 'express';
import request from 'supertest';
import preferencesRouter, { parseQuotesPayload } from '../preferences';
import { prisma } from '../../lib/prisma';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

const validPayload = {
  source: '示例书',
  items: [{ text: '第一条', section: '甲' }, { text: '第二条' }],
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/preferences', preferencesRouter);
  return app;
}

describe('quotes preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps known fields and rejects malformed payloads', () => {
    expect(
      parseQuotesPayload({
        items: [{ text: '一条', extra: 1 }],
      })
    ).toEqual({ items: [{ text: '一条' }] });
    expect(parseQuotesPayload({ items: [] })).toEqual({ items: [] });
    expect(parseQuotesPayload({ items: [{ text: '' }] })).toBeNull();
    expect(
      parseQuotesPayload({ items: [{ text: 'x'.repeat(501) }] })
    ).toBeNull();
    expect(
      parseQuotesPayload({ items: [{ text: 'a', section: 3 }] })
    ).toBeNull();
    expect(
      parseQuotesPayload({
        items: Array.from({ length: 501 }, () => ({ text: 'a' })),
      })
    ).toBeNull();
    expect(parseQuotesPayload({ source: '书' })).toBeNull();
  });

  it('returns exists=false when nothing is stored', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const response = await request(createTestApp()).get(
      '/api/preferences/quotes'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: false });
  });

  it('persists a valid payload and rejects an invalid one', async () => {
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    const ok = await request(createTestApp())
      .put('/api/preferences/quotes')
      .send(validPayload);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ exists: true, ...validPayload });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    const bad = await request(createTestApp())
      .put('/api/preferences/quotes')
      .send({ items: 'x' });
    expect(bad.status).toBe(400);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
