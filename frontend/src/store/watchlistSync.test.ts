import { afterEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_INDICES,
  decideWatchlistHydrate,
  defaultWatchlist,
  isCustomWatchlist,
  MARKET_INDICES_ORDER_STORAGE_KEY,
  readLocalWatchlist,
} from './watchlistSync';

const customWatchlist = {
  ...defaultWatchlist(),
  selectedIndices: [
    ...DEFAULT_INDICES,
    {
      code: 'sz399006',
      name: '创业板指',
      visible: true,
      categoryId: 'market',
    },
    {
      code: 'sz600839',
      name: '长虹电力',
      visible: true,
      categoryId: 'stock',
    },
  ],
};

describe('watchlistSync', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('defaults are not treated as custom', () => {
    expect(isCustomWatchlist(defaultWatchlist())).toBe(false);
  });

  test('added codes count as a custom watchlist', () => {
    expect(isCustomWatchlist(customWatchlist)).toBe(true);
  });

  test('uses server copy when it already exists', () => {
    const decision = decideWatchlistHydrate(
      {
        exists: true,
        updatedAt: '2026-10-26T00:00:00.000Z',
        ...customWatchlist,
      },
      defaultWatchlist()
    );

    expect(decision.shouldUpload).toBe(false);
    expect(decision.payload.selectedIndices.map((item) => item.code)).toContain(
      'sz399006'
    );
  });

  test('uploads browser copy when server is empty and local is custom', () => {
    const decision = decideWatchlistHydrate({ exists: false }, customWatchlist);

    expect(decision.shouldUpload).toBe(true);
    expect(decision.payload.selectedIndices).toHaveLength(
      customWatchlist.selectedIndices.length
    );
  });

  test('does not upload default list when both sides are empty', () => {
    const decision = decideWatchlistHydrate(
      { exists: false },
      defaultWatchlist()
    );

    expect(decision.shouldUpload).toBe(false);
    expect(decision.payload.selectedIndices).toEqual(DEFAULT_INDICES);
  });

  test('old flat lists are not treated as custom just because they lack row coords', () => {
    const legacyDefaults = {
      ...defaultWatchlist(),
      selectedIndices: DEFAULT_INDICES.map(
        ({ row: _row, col: _col, ...item }) => item
      ),
    };
    expect(isCustomWatchlist(legacyDefaults)).toBe(false);
  });

  test('reads custom indices from localStorage', () => {
    localStorage.setItem(
      MARKET_INDICES_ORDER_STORAGE_KEY,
      JSON.stringify(customWatchlist.selectedIndices)
    );

    expect(
      readLocalWatchlist().selectedIndices.map((item) => item.name)
    ).toEqual(customWatchlist.selectedIndices.map((item) => item.name));
  });
});
