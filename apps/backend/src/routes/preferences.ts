import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

const WATCHLIST_KEY = 'watchlist';
const DESKTOP_KEY = 'desktop';
const QUOTES_KEY = 'quotes';
const MAX_ORDER_LENGTH = 200;
const MAX_QUOTES = 500;
const MAX_QUOTE_LENGTH = 500;

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

// 桌面看板（/desktop.html）的显示偏好；顺序独立于 UHT 栏目，不影响主界面
export type DesktopPayload = {
  hideAmounts: boolean;
  holdingsOrder: string[];
  marketOrder: string[];
  background: string; // 背景主题 id，由 desktop.html 定义
};

const DEFAULT_DESKTOP_BACKGROUND = 'mountain';

// 桌面看板轮播的语录；内容是用户数据，只存库，不进仓库
export type QuoteItem = {
  text: string;
  section?: string;
};

export type QuotesPayload = {
  source?: string; // 出处，如书名
  items: QuoteItem[];
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

const isCodeList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_ORDER_LENGTH &&
  value.every((item) => typeof item === 'string' && item.trim() !== '');

export const parseDesktopPayload = (value: unknown): DesktopPayload | null => {
  if (!isRecord(value)) return null;
  const { hideAmounts, holdingsOrder, marketOrder, background } = value;
  if (
    typeof hideAmounts !== 'boolean' ||
    !isCodeList(holdingsOrder) ||
    !isCodeList(marketOrder) ||
    (background !== undefined &&
      (typeof background !== 'string' || !/^[a-z0-9-]{1,32}$/.test(background)))
  ) {
    return null;
  }
  return {
    hideAmounts,
    holdingsOrder,
    marketOrder,
    background: background ?? DEFAULT_DESKTOP_BACKGROUND,
  };
};

const isShortText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;

const isQuoteItem = (value: unknown): value is QuoteItem =>
  isRecord(value) &&
  isShortText(value.text, MAX_QUOTE_LENGTH) &&
  (value.section === undefined || isShortText(value.section, 64));

export const parseQuotesPayload = (value: unknown): QuotesPayload | null => {
  if (!isRecord(value)) return null;
  const { source, items } = value;
  if (
    !Array.isArray(items) ||
    items.length > MAX_QUOTES ||
    !items.every(isQuoteItem) ||
    (source !== undefined && !isShortText(source, 128))
  ) {
    return null;
  }
  return {
    ...(source !== undefined && { source }),
    items: items.map(({ text, section }) => ({
      text,
      ...(section !== undefined && { section }),
    })),
  };
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const readPreference = async <T>(
  key: string,
  parse: (value: unknown) => T | null
): Promise<{ payload: T; updatedAt: string } | null> => {
  const rows = await prisma.$queryRaw<AppPreferenceRow[]>`
    SELECT "key", "value", "updatedAt"
    FROM "AppPreference"
    WHERE "key" = ${key}
  `;
  const row = rows[0];
  if (!row) return null;

  try {
    const payload = parse(JSON.parse(row.value));
    if (!payload) return null;
    return { payload, updatedAt: toIso(row.updatedAt) };
  } catch {
    return null;
  }
};

const writePreference = async <T>(
  key: string,
  payload: T
): Promise<{ payload: T; updatedAt: string }> => {
  const now = new Date().toISOString();
  const value = JSON.stringify(payload);
  await prisma.$executeRaw`
    INSERT INTO "AppPreference" ("key", "value", "updatedAt")
    VALUES (${key}, ${value}, ${now})
    ON CONFLICT("key") DO UPDATE SET
      "value" = excluded."value",
      "updatedAt" = excluded."updatedAt"
  `;
  return { payload, updatedAt: now };
};

const readWatchlist = () =>
  readPreference(WATCHLIST_KEY, parseWatchlistPayload);
const writeWatchlist = (payload: WatchlistPayload) =>
  writePreference(WATCHLIST_KEY, payload);

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

router.get(
  '/desktop',
  asyncHandler(async (_req: Request, res: Response) => {
    const stored = await readPreference(DESKTOP_KEY, parseDesktopPayload);
    if (!stored) {
      res.json({ exists: false });
      return;
    }
    res.json({ exists: true, ...stored.payload, updatedAt: stored.updatedAt });
  })
);

router.put(
  '/desktop',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseDesktopPayload(req.body);
    if (!payload) {
      res.status(400).json({
        message:
          'desktop payload is invalid: hideAmounts (boolean), holdingsOrder and marketOrder (code arrays) are required',
      });
      return;
    }

    const stored = await writePreference(DESKTOP_KEY, payload);
    res.json({ exists: true, ...stored.payload, updatedAt: stored.updatedAt });
  })
);

router.get(
  '/quotes',
  asyncHandler(async (_req: Request, res: Response) => {
    const stored = await readPreference(QUOTES_KEY, parseQuotesPayload);
    if (!stored) {
      res.json({ exists: false });
      return;
    }
    res.json({ exists: true, ...stored.payload, updatedAt: stored.updatedAt });
  })
);

router.put(
  '/quotes',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseQuotesPayload(req.body);
    if (!payload) {
      res.status(400).json({
        message: `quotes payload is invalid: items must be an array of at most ${MAX_QUOTES} { text, section? }`,
      });
      return;
    }

    const stored = await writePreference(QUOTES_KEY, payload);
    res.json({ exists: true, ...stored.payload, updatedAt: stored.updatedAt });
  })
);

export default router;
