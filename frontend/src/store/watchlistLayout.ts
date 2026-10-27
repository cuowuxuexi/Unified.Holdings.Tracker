import type { SelectedIndexItem } from './types';

// 只用于没有行号的旧名单首次落位；每行张数不设上限，放不下时由行内折行显示
export const CARDS_PER_ROW = 4;
export const NEW_ROW_DROPPABLE = 'shelf:new';

export const cardSortableId = (code: string): string => `card:${code}`;

export const shelfDroppableId = (row: number): string => `shelf:${row}`;

export const parseCardId = (id: string): string | null =>
  id.startsWith('card:') ? id.slice(5) : null;

export const parseShelfId = (id: string): number | 'new' | null => {
  if (id === NEW_ROW_DROPPABLE) return 'new';
  if (!id.startsWith('shelf:')) return null;
  const row = Number(id.slice(6));
  return Number.isInteger(row) && row >= 0 ? row : null;
};

const hasValidCoords = (item: SelectedIndexItem): boolean =>
  Number.isInteger(item.row) &&
  (item.row as number) >= 0 &&
  Number.isInteger(item.col) &&
  (item.col as number) >= 0;

const sortByShelf = (a: SelectedIndexItem, b: SelectedIndexItem): number =>
  (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0);

export const packCategoryRows = (
  items: SelectedIndexItem[]
): SelectedIndexItem[] =>
  items.map((item, index) => ({
    ...item,
    row: Math.floor(index / CARDS_PER_ROW),
    col: index % CARDS_PER_ROW,
  }));

export const compactCategoryRows = (
  items: SelectedIndexItem[]
): SelectedIndexItem[] => {
  const buckets = new Map<number, SelectedIndexItem[]>();
  for (const item of [...items].sort(sortByShelf)) {
    const row = item.row ?? 0;
    const list = buckets.get(row) ?? [];
    list.push(item);
    buckets.set(row, list);
  }

  const result: SelectedIndexItem[] = [];
  let nextRow = 0;
  for (const oldRow of [...buckets.keys()].sort((a, b) => a - b)) {
    const list = buckets.get(oldRow) ?? [];
    list.forEach((item, col) => {
      result.push({ ...item, row: nextRow, col });
    });
    nextRow += 1;
  }
  return result;
};

export const normalizeSelectedIndexRows = (
  items: SelectedIndexItem[]
): SelectedIndexItem[] => {
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, SelectedIndexItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.categoryId)) {
      categoryOrder.push(item.categoryId);
      byCategory.set(item.categoryId, []);
    }
    byCategory.get(item.categoryId)?.push(item);
  }

  return categoryOrder.flatMap((categoryId) => {
    const list = byCategory.get(categoryId) ?? [];
    return list.every(hasValidCoords)
      ? compactCategoryRows(list)
      : packCategoryRows(list);
  });
};

export const groupItemsByRow = (
  items: SelectedIndexItem[]
): SelectedIndexItem[][] => {
  const normalized = compactCategoryRows(items);
  const byRow = new Map<number, SelectedIndexItem[]>();
  for (const item of normalized) {
    const row = item.row ?? 0;
    const list = byRow.get(row) ?? [];
    list.push(item);
    byRow.set(row, list);
  }
  return [...byRow.keys()]
    .sort((a, b) => a - b)
    .map((row) => byRow.get(row) ?? []);
};

export type MoveCardTarget =
  | { type: 'row'; row: number; col?: number }
  | { type: 'card'; code: string; after: boolean }
  | { type: 'new-row' };

// compact=false 用于拖动中的预览：保留被拖空的行号，避免行塌缩导致指针下的行跳动
export const moveCard = (
  items: SelectedIndexItem[],
  code: string,
  target: MoveCardTarget,
  { compact = true }: { compact?: boolean } = {}
): SelectedIndexItem[] | null => {
  const item = items.find((entry) => entry.code === code);
  if (!item) return null;

  const rest = items.filter((entry) => entry.code !== code);
  const finish = (next: SelectedIndexItem[]) =>
    compact ? compactCategoryRows(next) : next;

  if (target.type === 'new-row') {
    const maxRow = rest.reduce(
      (max, entry) => Math.max(max, entry.row ?? 0),
      -1
    );
    return finish([...rest, { ...item, row: maxRow + 1, col: 0 }]);
  }

  let row: number;
  let destItems: SelectedIndexItem[];
  let insertAt: number;
  if (target.type === 'card') {
    const overItem = rest.find((entry) => entry.code === target.code);
    if (!overItem) return null;
    row = overItem.row ?? 0;
    destItems = rest.filter((entry) => entry.row === row).sort(sortByShelf);
    insertAt = destItems.indexOf(overItem) + (target.after ? 1 : 0);
  } else {
    row = target.row;
    destItems = rest.filter((entry) => entry.row === row).sort(sortByShelf);
    insertAt =
      target.col === undefined
        ? destItems.length
        : Math.min(Math.max(target.col, 0), destItems.length);
  }

  const merged = [
    ...destItems.slice(0, insertAt),
    { ...item, row, col: insertAt },
    ...destItems.slice(insertAt),
  ].map((entry, col) => ({ ...entry, row, col }));

  const outside = rest.filter((entry) => entry.row !== row);
  return finish([...outside, ...merged]);
};

// 设置弹窗里按扁平顺序拖动标签：保持每行张数不变，只按新顺序重新填入各行
export const reorderKeepingShelves = (
  items: SelectedIndexItem[],
  fromCode: string,
  toCode: string
): SelectedIndexItem[] => {
  const ordered = compactCategoryRows(items);
  const from = ordered.findIndex((entry) => entry.code === fromCode);
  const to = ordered.findIndex((entry) => entry.code === toCode);
  if (from === -1 || to === -1) return ordered;

  const codes = ordered.map((entry) => entry.code);
  codes.splice(to, 0, ...codes.splice(from, 1));
  const byCode = new Map(ordered.map((entry) => [entry.code, entry]));
  return ordered.map((slot, index) => ({
    ...byCode.get(codes[index])!,
    row: slot.row,
    col: slot.col,
  }));
};

export const appendIndexToCategory = (
  items: SelectedIndexItem[],
  item: SelectedIndexItem
): SelectedIndexItem[] => {
  const categoryItems = items.filter(
    (entry) => entry.categoryId === item.categoryId
  );
  const others = items.filter((entry) => entry.categoryId !== item.categoryId);
  const packed = categoryItems.every(hasValidCoords)
    ? compactCategoryRows(categoryItems)
    : packCategoryRows(categoryItems);
  const maxRow = packed.reduce(
    (max, entry) => Math.max(max, entry.row ?? 0),
    -1
  );
  const row = Math.max(maxRow, 0);
  const col = packed.filter((entry) => entry.row === row).length;
  return [...others, ...packed, { ...item, row, col }];
};

export const removeIndexFromCategory = (
  items: SelectedIndexItem[],
  code: string,
  categoryId: string
): SelectedIndexItem[] => {
  const remaining = items.filter(
    (entry) => !(entry.code === code && entry.categoryId === categoryId)
  );
  const categoryItems = remaining.filter(
    (entry) => entry.categoryId === categoryId
  );
  const others = remaining.filter((entry) => entry.categoryId !== categoryId);
  return [...others, ...compactCategoryRows(categoryItems)];
};
