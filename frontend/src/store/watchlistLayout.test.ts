import { describe, expect, test } from 'vitest';
import type { SelectedIndexItem } from './types';
import {
  appendIndexToCategory,
  compactCategoryRows,
  groupItemsByRow,
  moveCard,
  normalizeSelectedIndexRows,
  packCategoryRows,
  removeIndexFromCategory,
  reorderKeepingShelves,
} from './watchlistLayout';

const item = (
  code: string,
  extras: Partial<SelectedIndexItem> = {}
): SelectedIndexItem => ({
  code,
  name: code,
  visible: true,
  categoryId: 'market',
  ...extras,
});

describe('watchlistLayout', () => {
  test('packs a flat list into shelves of 4', () => {
    const packed = packCategoryRows(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((code) => item(code))
    );

    expect(packed.map((entry) => [entry.code, entry.row, entry.col])).toEqual([
      ['a', 0, 0],
      ['b', 0, 1],
      ['c', 0, 2],
      ['d', 0, 3],
      ['e', 1, 0],
      ['f', 1, 1],
      ['g', 1, 2],
      ['h', 1, 3],
      ['i', 2, 0],
    ]);
  });

  test('normalize packs only when row/col are missing', () => {
    const packed = normalizeSelectedIndexRows([
      item('a'),
      item('b'),
      item('c'),
      item('d'),
      item('e'),
    ]);
    expect(packed[4]).toMatchObject({ code: 'e', row: 1, col: 0 });

    const kept = normalizeSelectedIndexRows([
      item('a', { row: 0, col: 0 }),
      item('b', { row: 0, col: 1 }),
      item('c', { row: 2, col: 0 }),
    ]);
    expect(kept.map((entry) => [entry.code, entry.row, entry.col])).toEqual([
      ['a', 0, 0],
      ['b', 0, 1],
      ['c', 1, 0],
    ]);
  });

  test('moving a card onto another shelf does not reflow earlier cards', () => {
    const start = packCategoryRows(
      [
        '上证',
        '深证',
        '创业',
        '恒生',
        '道指',
        '纳指',
        '标普',
        '长江',
        '茅台',
      ].map((code) => item(code))
    );

    const next = moveCard(start, '长江', { type: 'row', row: 2 });
    expect(next).not.toBeNull();
    expect(
      groupItemsByRow(next!).map((row) => row.map((entry) => entry.code))
    ).toEqual([
      ['上证', '深证', '创业', '恒生'],
      ['道指', '纳指', '标普'],
      ['茅台', '长江'],
    ]);
  });

  test('dropping onto blank space opens a new row', () => {
    const start = packCategoryRows(
      ['上证', '深证', '创业', '恒生', '茅台'].map((code) => item(code))
    );

    const next = moveCard(start, '茅台', { type: 'new-row' });
    expect(
      groupItemsByRow(next!).map((row) => row.map((entry) => entry.code))
    ).toEqual([['上证', '深证', '创业', '恒生'], ['茅台']]);
  });

  test('rejects a drop onto a full destination row', () => {
    const start = packCategoryRows(
      ['a', 'b', 'c', 'd', 'e'].map((code) => item(code))
    );
    expect(moveCard(start, 'e', { type: 'row', row: 0 })).toBeNull();
  });

  test('same-row reorder keeps the rest of the shelf', () => {
    const start = packCategoryRows(
      ['a', 'b', 'c', 'd'].map((code) => item(code))
    );
    const next = moveCard(start, 'd', { type: 'row', row: 0, col: 1 });
    expect(next?.map((entry) => entry.code)).toEqual(['a', 'd', 'b', 'c']);
  });

  test('card target inserts before or after by pointer half', () => {
    const start = packCategoryRows(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((code) => item(code))
    );
    const rows = (next: SelectedIndexItem[] | null) =>
      groupItemsByRow(next!).map((row) => row.map((entry) => entry.code));

    expect(
      rows(moveCard(start, 'f', { type: 'card', code: 'e', after: false }))
    ).toEqual([
      ['a', 'b', 'c', 'd'],
      ['f', 'e'],
    ]);
    expect(
      rows(moveCard(start, 'a', { type: 'card', code: 'c', after: true }))
    ).toEqual([
      ['b', 'c', 'a', 'd'],
      ['e', 'f'],
    ]);
    expect(
      rows(moveCard(start, 'a', { type: 'card', code: 'e', after: true }))
    ).toEqual([
      ['b', 'c', 'd'],
      ['e', 'a', 'f'],
    ]);
    expect(
      moveCard(start, 'e', { type: 'card', code: 'b', after: true })
    ).toBeNull();
  });

  test('preview move keeps the emptied source row number', () => {
    const start = [
      item('a', { row: 0, col: 0 }),
      item('b', { row: 1, col: 0 }),
      item('c', { row: 2, col: 0 }),
    ];
    const next = moveCard(
      start,
      'b',
      { type: 'card', code: 'c', after: true },
      { compact: false }
    );
    expect(next?.map((entry) => [entry.code, entry.row, entry.col])).toEqual([
      ['a', 0, 0],
      ['c', 2, 0],
      ['b', 2, 1],
    ]);
  });

  test('settings reorder keeps each shelf size', () => {
    const start = [
      item('a', { row: 0, col: 0 }),
      item('b', { row: 0, col: 1 }),
      item('c', { row: 0, col: 2 }),
      item('d', { row: 1, col: 0 }),
      item('e', { row: 1, col: 1 }),
    ];
    const next = reorderKeepingShelves(start, 'e', 'a');
    expect(next.map((entry) => [entry.code, entry.row, entry.col])).toEqual([
      ['e', 0, 0],
      ['a', 0, 1],
      ['b', 0, 2],
      ['c', 1, 0],
      ['d', 1, 1],
    ]);
  });

  test('append uses leftover space on the last shelf', () => {
    const start = packCategoryRows(
      ['a', 'b', 'c', 'd', 'e'].map((code) => item(code))
    );
    const next = appendIndexToCategory(start, item('f'));
    expect(next.at(-1)).toMatchObject({ code: 'f', row: 1, col: 1 });
  });

  test('remove collapses an emptied shelf', () => {
    const start = [
      item('a', { row: 0, col: 0 }),
      item('b', { row: 1, col: 0 }),
      item('c', { row: 2, col: 0 }),
    ];
    const next = removeIndexFromCategory(start, 'b', 'market');
    expect(next.map((entry) => [entry.code, entry.row])).toEqual([
      ['a', 0],
      ['c', 1],
    ]);
  });

  test('compact splits an oversized shelf instead of keeping 5 cards', () => {
    const next = compactCategoryRows([
      item('a', { row: 0, col: 0 }),
      item('b', { row: 0, col: 1 }),
      item('c', { row: 0, col: 2 }),
      item('d', { row: 0, col: 3 }),
      item('e', { row: 0, col: 4 }),
    ]);
    expect(next.map((entry) => [entry.code, entry.row, entry.col])).toEqual([
      ['a', 0, 0],
      ['b', 0, 1],
      ['c', 0, 2],
      ['d', 0, 3],
      ['e', 1, 0],
    ]);
  });
});
