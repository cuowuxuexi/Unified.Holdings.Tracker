import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

const WATCHLIST_KEY = 'watchlist';

export type WatchlistIndexItem = {
  code: string;
  name: string;
  visible: boolean;
  categoryId: string;
  row?: number;
  col?: number;
};

export type WatchlistCategory = {
  id: string;
  label: string;
  order: number;
  visible: boolean;
  rows?: number;
};

export type WatchlistMarketConfig = {
  key: string;
  label: string;
  currency: string;
  symbol: string;
  codePrefix: string[];
  visible: boolean;
};

export type WatchlistPayload = {
  selectedIndices: WatchlistIndexItem[];
  indexCategories: WatchlistCategory[];
  marketConfigs: WatchlistMarketConfig[];
};

type AppPreferenceRow = {
  key: string;
  value: string;
  updatedAt: Date | string;
};

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOptionalShelfCoord = (
  value: unknown,
  max?: number
): value is number | undefined =>
  value === undefined ||
  (typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    (max === undefined || value <= max));

const isIndexItem = (value: unknown): value is WatchlistIndexItem => {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === 'string' &&
    value.code.trim() !== '' &&
    typeof value.name === 'string' &&
    typeof value.visible === 'boolean' &&
    typeof value.categoryId === 'string' &&
    isOptionalShelfCoord(value.row) &&
    isOptionalShelfCoord(value.col)
  );
};

const isCategory = (value: unknown): value is WatchlistCategory => {
  if (!isRecord(value)) return false;
  const rowsOk =
    value.rows === undefined ||
    (typeof value.rows === 'number' && value.rows >= 2 && value.rows <= 4);
  return (
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    typeof value.label === 'string' &&
    typeof value.order === 'number' &&
    typeof value.visible === 'boolean' &&
    rowsOk
  );
};

const isMarketConfig = (value: unknown): value is WatchlistMarketConfig => {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    value.key.trim() !== '' &&
    typeof value.label === 'string' &&
    typeof value.currency === 'string' &&
    typeof value.symbol === 'string' &&
    Array.isArray(value.codePrefix) &&
    value.codePrefix.every((item) => typeof item === 'string') &&
    typeof value.visible === 'boolean'
  );
};

export const parseWatchlistPayload = (
  value: unknown
): WatchlistPayload | null => {
  if (!isRecord(value)) return null;
  const { selectedIndices, indexCategories, marketConfigs } = value;
  if (
    !Array.isArray(selectedIndices) ||
    !selectedIndices.every(isIndexItem) ||
    selectedIndices.length === 0
  ) {
    return null;
  }
  if (
    !Array.isArray(indexCategories) ||
    !indexCategories.every(isCategory) ||
    indexCategories.length === 0
  ) {
    return null;
  }
  if (
    !Array.isArray(marketConfigs) ||
    !marketConfigs.every(isMarketConfig) ||
    marketConfigs.length === 0
  ) {
    return null;
  }
  return {
    selectedIndices,
    indexCategories,
    marketConfigs,
  };
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const readWatchlist = async (): Promise<{
  payload: WatchlistPayload;
  updatedAt: string;
} | null> => {
  const rows = await prisma.$queryRaw<AppPreferenceRow[]>`
    SELECT "key", "value", "updatedAt"
    FROM "AppPreference"
    WHERE "key" = ${WATCHLIST_KEY}
  `;
  const row = rows[0];
  if (!row) return null;

  try {
    const payload = parseWatchlistPayload(JSON.parse(row.value));
    if (!payload) return null;
    return { payload, updatedAt: toIso(row.updatedAt) };
  } catch {
    return null;
  }
};

const writeWatchlist = async (
  payload: WatchlistPayload
): Promise<{ payload: WatchlistPayload; updatedAt: string }> => {
  const now = new Date().toISOString();
  const value = JSON.stringify(payload);
  await prisma.$executeRaw`
    INSERT INTO "AppPreference" ("key", "value", "updatedAt")
    VALUES (${WATCHLIST_KEY}, ${value}, ${now})
    ON CONFLICT("key") DO UPDATE SET
      "value" = excluded."value",
      "updatedAt" = excluded."updatedAt"
  `;
  return { payload, updatedAt: now };
};

const router = Router();

router.get(
  '/watchlist',
  asyncHandler(async (_req: Request, res: Response) => {
    const stored = await readWatchlist();
    if (!stored) {
      res.json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      ...stored.payload,
      updatedAt: stored.updatedAt,
    });
  })
);

router.put(
  '/watchlist',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseWatchlistPayload(req.body);
    if (!payload) {
      res.status(400).json({
        message:
          'watchlist payload is invalid: selectedIndices, indexCategories and marketConfigs are required',
      });
      return;
    }

    const stored = await writeWatchlist(payload);
    res.json({
      exists: true,
      ...stored.payload,
      updatedAt: stored.updatedAt,
    });
  })
);

export default router;
