import express from 'express';
import request from 'supertest';
import preferencesRouter, { parseDesktopPayload } from '../preferences';
import { prisma } from '../../lib/prisma';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

const validPayload = {
  hideAmounts: true,
  holdingsOrder: ['hk00700', 'sh600276'],
  marketOrder: ['sz399001', 'sh000001'],
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/preferences', preferencesRouter);
  return app;
}

describe('desktop preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts empty orders and rejects malformed payloads', () => {
    expect(
      parseDesktopPayload({
        hideAmounts: false,
        holdingsOrder: [],
        marketOrder: [],
      })
    ).toEqual({
      hideAmounts: false,
      holdingsOrder: [],
      marketOrder: [],
      background: 'mountain',
    });
    expect(
      parseDesktopPayload({ ...validPayload, background: 'aurora' })?.background
    ).toBe('aurora');
    expect(
      parseDesktopPayload({ ...validPayload, background: '../x' })
    ).toBeNull();
    expect(
      parseDesktopPayload({ ...validPayload, hideAmounts: 'yes' })
    ).toBeNull();
    expect(
      parseDesktopPayload({ ...validPayload, marketOrder: [''] })
    ).toBeNull();
    expect(parseDesktopPayload({ hideAmounts: true })).toBeNull();
  });

  it('returns exists=false when nothing is stored', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const response = await request(createTestApp()).get(
      '/api/preferences/desktop'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: false });
  });

  it('returns stored desktop preferences', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      {
        key: 'desktop',
        value: JSON.stringify(validPayload),
        updatedAt: '2026-10-28T06:00:00.000Z',
      },
    ]);

    const response = await request(createTestApp()).get(
      '/api/preferences/desktop'
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ exists: true, ...validPayload });
  });

  it('persists a valid payload and rejects an invalid one', async () => {
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    const ok = await request(createTestApp())
      .put('/api/preferences/desktop')
      .send(validPayload);
    expect(ok.status).toBe(200);
    expect(ok.body.holdingsOrder).toEqual(['hk00700', 'sh600276']);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    const bad = await request(createTestApp())
      .put('/api/preferences/desktop')
      .send({ hideAmounts: true });
    expect(bad.status).toBe(400);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
