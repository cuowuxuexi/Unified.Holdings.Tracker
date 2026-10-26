import {
  IndexCategory,
  MarketConfig,
  SelectedIndexItem,
  WatchlistPayload,
  WatchlistPreferenceResponse,
} from './types';
import { normalizeSelectedIndexRows } from './watchlistLayout';

export const MARKET_INDICES_ORDER_STORAGE_KEY = 'marketIndicesOrderV2';
export const MARKET_CONFIGS_STORAGE_KEY = 'marketConfigsV1';
export const INDEX_CATEGORIES_STORAGE_KEY = 'indexCategoriesV1';

export const DEFAULT_INDEX_CATEGORIES: IndexCategory[] = [
  { id: 'market', label: '大盘', order: 0, visible: true },
  { id: 'stock', label: '个股', order: 1, visible: true },
];

export const DEFAULT_INDICES: SelectedIndexItem[] = [
  {
    code: 'sh000001',
    name: '上证指数',
    visible: true,
    categoryId: 'market',
    row: 0,
    col: 0,
  },
  {
    code: 'sz399001',
    name: '深证成指',
    visible: true,
    categoryId: 'market',
    row: 0,
    col: 1,
  },
  {
    code: 'hkHSI',
    name: '恒生指数',
    visible: true,
    categoryId: 'market',
    row: 0,
    col: 2,
  },
  {
    code: 'usDJI',
    name: '道琼斯',
    visible: true,
    categoryId: 'market',
    row: 0,
    col: 3,
  },
  {
    code: 'usIXIC',
    name: '纳斯达克',
    visible: true,
    categoryId: 'market',
    row: 1,
    col: 0,
  },
  {
    code: 'usINX',
    name: '标普500',
    visible: true,
    categoryId: 'market',
    row: 1,
    col: 1,
  },
];

export const DEFAULT_MARKET_CONFIGS: MarketConfig[] = [
  {
    key: 'A股',
    label: 'A股',
    currency: 'CNY',
    symbol: '¥',
    codePrefix: ['sh', 'sz'],
    visible: true,
  },
  {
    key: '港股',
    label: '港股',
    currency: 'HKD',
    symbol: 'HK$',
    codePrefix: ['hk'],
    visible: true,
  },
  {
    key: '美股',
    label: '美股',
    currency: 'USD',
    symbol: '$',
    codePrefix: ['us'],
    visible: true,
  },
];

type StoredSelectedIndexItem = SelectedIndexItem & {
  type?: string;
};

const isStoredSelectedIndexItem = (
  item: unknown
): item is StoredSelectedIndexItem => {
  return (
    typeof item === 'object' &&
    item !== null &&
    'code' in item &&
    typeof item.code === 'string'
  );
};

const migrateTypeToCategory = (
  items: StoredSelectedIndexItem[]
): SelectedIndexItem[] => {
  return items.map((item) => {
    if (item.type && !item.categoryId) {
      return { ...item, categoryId: item.type };
    }
    return item;
  });
};

const migrateStringArrayToSelectedIndexItem = (
  arr: string[]
): SelectedIndexItem[] => {
  return arr.map((code) => ({
    code,
    name: code,
    visible: true,
    categoryId: 'stock',
  }));
};

export const defaultWatchlist = (): WatchlistPayload => ({
  selectedIndices: DEFAULT_INDICES,
  indexCategories: DEFAULT_INDEX_CATEGORIES,
  marketConfigs: DEFAULT_MARKET_CONFIGS,
});

export const getSavedIndicesOrder = (): SelectedIndexItem[] => {
  try {
    const savedOrder = localStorage.getItem(MARKET_INDICES_ORDER_STORAGE_KEY);
    if (savedOrder) {
      const parsed = JSON.parse(savedOrder);
      if (Array.isArray(parsed) && parsed.every(isStoredSelectedIndexItem)) {
        if (parsed.length === 0) {
          return DEFAULT_INDICES;
        }
        return normalizeSelectedIndexRows(migrateTypeToCategory(parsed));
      }
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return normalizeSelectedIndexRows(
          migrateStringArrayToSelectedIndexItem(parsed)
        );
      }
    }
  } catch (error) {
    console.error(
      'Error loading saved indices order from localStorage:',
      error
    );
  }
  return DEFAULT_INDICES;
};

export const saveIndicesOrder = (indices: SelectedIndexItem[]): void => {
  try {
    if (
      Array.isArray(indices) &&
      indices.every((item) => typeof item === 'object' && item.code)
    ) {
      localStorage.setItem(
        MARKET_INDICES_ORDER_STORAGE_KEY,
        JSON.stringify(indices)
      );
    }
  } catch (error) {
    console.error('Error saving indices order to localStorage:', error);
  }
};

export const getSavedMarketConfigs = (): MarketConfig[] => {
  try {
    const savedConfigs = localStorage.getItem(MARKET_CONFIGS_STORAGE_KEY);
    if (savedConfigs) {
      const parsed = JSON.parse(savedConfigs);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'object' && item.key)
      ) {
        return parsed;
      }
    }
  } catch (error) {
    console.error(
      'Error loading saved market configs from localStorage:',
      error
    );
  }
  return DEFAULT_MARKET_CONFIGS;
};

export const saveMarketConfigs = (configs: MarketConfig[]): void => {
  try {
    if (
      Array.isArray(configs) &&
      configs.every((item) => typeof item === 'object' && item.key)
    ) {
      localStorage.setItem(MARKET_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    }
  } catch (error) {
    console.error('Error saving market configs to localStorage:', error);
  }
};

export const getSavedIndexCategories = (): IndexCategory[] => {
  try {
    const savedCategories = localStorage.getItem(INDEX_CATEGORIES_STORAGE_KEY);
    if (savedCategories) {
      const parsed = JSON.parse(savedCategories);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'object' && item.id)
      ) {
        return parsed;
      }
    }
  } catch (error) {
    console.error(
      'Error loading saved index categories from localStorage:',
      error
    );
  }
  return DEFAULT_INDEX_CATEGORIES;
};

export const saveIndexCategories = (categories: IndexCategory[]): void => {
  try {
    if (
      Array.isArray(categories) &&
      categories.every((item) => typeof item === 'object' && item.id)
    ) {
      localStorage.setItem(
        INDEX_CATEGORIES_STORAGE_KEY,
        JSON.stringify(categories)
      );
    }
  } catch (error) {
    console.error('Error saving index categories to localStorage:', error);
  }
};

export const readLocalWatchlist = (): WatchlistPayload => ({
  selectedIndices: getSavedIndicesOrder(),
  indexCategories: getSavedIndexCategories(),
  marketConfigs: getSavedMarketConfigs(),
});

export const writeLocalWatchlist = (payload: WatchlistPayload): void => {
  saveIndicesOrder(payload.selectedIndices);
  saveIndexCategories(payload.indexCategories);
  saveMarketConfigs(payload.marketConfigs);
};

const fingerprint = (payload: WatchlistPayload): string =>
  JSON.stringify({
    indices: payload.selectedIndices.map((item) => [
      item.code,
      item.name,
      item.visible,
      item.categoryId,
      item.row,
      item.col,
    ]),
    categories: payload.indexCategories.map((item) => [
      item.id,
      item.label,
      item.order,
      item.visible,
    ]),
    configs: payload.marketConfigs.map((item) => [
      item.key,
      item.label,
      item.currency,
      item.symbol,
      item.codePrefix,
      item.visible,
    ]),
  });

export const isValidWatchlistPayload = (
  value: unknown
): value is WatchlistPayload => {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as WatchlistPayload;
  return (
    Array.isArray(payload.selectedIndices) &&
    payload.selectedIndices.length > 0 &&
    payload.selectedIndices.every(
      (item) => item && typeof item.code === 'string'
    ) &&
    Array.isArray(payload.indexCategories) &&
    payload.indexCategories.length > 0 &&
    payload.indexCategories.every(
      (item) => item && typeof item.id === 'string'
    ) &&
    Array.isArray(payload.marketConfigs) &&
    payload.marketConfigs.length > 0 &&
    payload.marketConfigs.every((item) => item && typeof item.key === 'string')
  );
};

const normalizeWatchlist = (payload: WatchlistPayload): WatchlistPayload => ({
  ...payload,
  selectedIndices: normalizeSelectedIndexRows(payload.selectedIndices),
});

export const isCustomWatchlist = (payload: WatchlistPayload): boolean =>
  fingerprint(normalizeWatchlist(payload)) !== fingerprint(defaultWatchlist());

export const decideWatchlistHydrate = (
  remote: WatchlistPreferenceResponse | null,
  local: WatchlistPayload
): { payload: WatchlistPayload; shouldUpload: boolean } => {
  if (remote?.exists && isValidWatchlistPayload(remote)) {
    return {
      payload: normalizeWatchlist({
        selectedIndices: remote.selectedIndices,
        indexCategories: remote.indexCategories,
        marketConfigs: remote.marketConfigs,
      }),
      shouldUpload: false,
    };
  }
  const localNorm = normalizeWatchlist(local);
  if (isCustomWatchlist(localNorm)) {
    return { payload: localNorm, shouldUpload: true };
  }
  return { payload: defaultWatchlist(), shouldUpload: false };
};
