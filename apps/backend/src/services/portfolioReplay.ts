import { Transaction, TransactionType, Market } from '../types';
import { getExchangeRateForAssetToCNY } from './currencyService';

const EPSILON = 1e-8;

export type CurrencyCode = 'CNY' | 'HKD' | 'USD' | string;

export interface Lot {
  quantity: number;
  costPerShareCny: number;
  costPerShareLocal: number;
}

export interface LotPositionState {
  assetCode: string;
  currency: CurrencyCode;
  lots: Lot[];
  quantity: number;
  totalCostCny: number;
  totalCostLocal: number;
}

export interface SellMatchResult {
  matchedQuantity: number;
  costRemovedCny: number;
  costRemovedLocal: number;
}

export interface BuildPositionsOptions {
  untilDate?: Date;
}

function normalizeCurrency(value?: string): CurrencyCode {
  return value ? value.toUpperCase() : 'CNY';
}

export function getCurrencyForAsset(assetCode?: string): CurrencyCode {
  if (!assetCode) return 'CNY';
  const prefix = assetCode.slice(0, 2).toLowerCase();
  if (prefix === 'hk') return 'HKD';
  if (prefix === 'us') return 'USD';
  return 'CNY';
}

export function getCurrencyForMarket(market: Market | null): CurrencyCode {
  if (market === Market.HK) return 'HKD';
  if (market === Market.US) return 'USD';
  return 'CNY';
}

export function resolveTransactionCurrency(tx: Transaction): CurrencyCode {
  if (tx.currency) {
    return normalizeCurrency(tx.currency);
  }
  return getCurrencyForAsset(tx.assetCode);
}

export function resolveTransactionExchangeRate(tx: Transaction): number {
  if (typeof tx.exchangeRate === 'number' && tx.exchangeRate > 0) {
    return tx.exchangeRate;
  }
  const currency = resolveTransactionCurrency(tx);
  if (currency === 'CNY') {
    return 1;
  }
  if (tx.assetCode) {
    const fallback = getExchangeRateForAssetToCNY(tx.assetCode);
    console.warn(
      `[LotTracker] Transaction ${tx.id ?? tx.assetCode} 缺少 exchangeRate，回退汇率 ${fallback}`
    );
    return fallback;
  }
  return 1;
}

export function getCommissionInCny(tx: Transaction): number {
  const commission = Number(tx.commission ?? 0);
  if (!commission) {
    return 0;
  }
  const rate = resolveTransactionExchangeRate(tx);
  return commission * rate;
}

function createEmptyState(
  assetCode: string,
  currency: CurrencyCode
): LotPositionState {
  return {
    assetCode,
    currency,
    lots: [],
    quantity: 0,
    totalCostCny: 0,
    totalCostLocal: 0,
  };
}

export class LotTracker {
  private readonly positions = new Map<string, LotPositionState>();

  private getState(
    assetCode: string,
    currency: CurrencyCode
  ): LotPositionState {
    const existing = this.positions.get(assetCode);
    if (existing) {
      if (currency && existing.currency !== currency) {
        console.warn(
          `[LotTracker] 资产 ${assetCode} 出现货币不一致：${existing.currency} -> ${currency}`
        );
      }
      return existing;
    }
    const state = createEmptyState(assetCode, currency);
    this.positions.set(assetCode, state);
    return state;
  }

  applyBuy(tx: Transaction): void {
    if (!tx.assetCode) return;
    const quantity = Number(tx.quantity ?? 0);
    const price = Number(tx.price ?? 0);
    if (quantity <= 0 || price <= 0) {
      console.warn(
        `[LotTracker] 忽略无效买入交易 ${tx.id ?? tx.assetCode}：quantity=${tx.quantity}, price=${tx.price}`
      );
      return;
    }
    const commissionLocal = Number(tx.commission ?? 0);
    const rate = resolveTransactionExchangeRate(tx);
    const currency = resolveTransactionCurrency(tx);

    const totalLocal = quantity * price + commissionLocal;
    const totalCny = totalLocal * rate;
    const costPerShareLocal = totalLocal / quantity;
    const costPerShareCny = totalCny / quantity;

    const state = this.getState(tx.assetCode, currency);
    state.lots.push({
      quantity,
      costPerShareCny,
      costPerShareLocal,
    });
    state.quantity += quantity;
    state.totalCostCny += totalCny;
    state.totalCostLocal += totalLocal;
  }

  applySell(tx: Transaction): SellMatchResult {
    if (!tx.assetCode) {
      return { matchedQuantity: 0, costRemovedCny: 0, costRemovedLocal: 0 };
    }
    const quantity = Number(tx.quantity ?? 0);
    if (quantity <= 0) {
      console.warn(
        `[LotTracker] 忽略无效卖出交易 ${tx.id ?? tx.assetCode}：quantity=${tx.quantity}`
      );
      return { matchedQuantity: 0, costRemovedCny: 0, costRemovedLocal: 0 };
    }
    const state = this.positions.get(tx.assetCode);
    if (!state || state.quantity <= EPSILON) {
      console.warn(
        `[LotTracker] 卖出 ${tx.assetCode} 时没有可用持仓，交易ID: ${tx.id}`
      );
      return { matchedQuantity: 0, costRemovedCny: 0, costRemovedLocal: 0 };
    }
    let remaining = quantity;
    let matched = 0;
    let costRemovedCny = 0;
    let costRemovedLocal = 0;

    while (remaining > EPSILON && state.lots.length > 0) {
      const lot = state.lots[0];
      const consume = Math.min(lot.quantity, remaining);
      costRemovedCny += consume * lot.costPerShareCny;
      costRemovedLocal += consume * lot.costPerShareLocal;
      lot.quantity -= consume;
      remaining -= consume;
      matched += consume;
      if (lot.quantity <= EPSILON) {
        state.lots.shift();
      }
    }

    if (remaining > EPSILON) {
      console.warn(
        `[LotTracker] 卖出 ${tx.assetCode} 超过持仓，超出数量 ${remaining.toFixed(4)}`
      );
    }

    state.quantity = Math.max(0, state.quantity - matched);
    state.totalCostCny = Math.max(0, state.totalCostCny - costRemovedCny);
    state.totalCostLocal = Math.max(0, state.totalCostLocal - costRemovedLocal);

    return { matchedQuantity: matched, costRemovedCny, costRemovedLocal };
  }

  getPositionsSnapshot(): Map<string, LotPositionState> {
    return new Map(
      Array.from(this.positions.entries()).map(([code, state]) => [
        code,
        {
          ...state,
          lots: state.lots.map((lot) => ({ ...lot })),
        },
      ])
    );
  }
}

export function buildPositionsUsingLots(
  transactions: Transaction[],
  options?: BuildPositionsOptions
): Map<string, LotPositionState> {
  const tracker = new LotTracker();
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const untilTimestamp = options?.untilDate
    ? options.untilDate.getTime()
    : Number.POSITIVE_INFINITY;

  for (const tx of sorted) {
    const txTimestamp = new Date(tx.date).getTime();
    if (txTimestamp > untilTimestamp) {
      break;
    }
    if (tx.type === TransactionType.BUY) {
      tracker.applyBuy(tx);
    } else if (tx.type === TransactionType.SELL) {
      tracker.applySell(tx);
    }
  }

  return tracker.getPositionsSnapshot();
}

export function getBuyCashRequirementInCny(tx: Transaction): number {
  if (tx.type !== TransactionType.BUY) return 0;
  if (!tx.quantity || !tx.price) return 0;
  const quantity = Number(tx.quantity);
  const price = Number(tx.price);
  const rate = resolveTransactionExchangeRate(tx);
  const gross = quantity * price * rate;
  const commission = getCommissionInCny(tx);
  return gross + commission;
}

export function getSellCashProceedsInCny(tx: Transaction): number {
  if (tx.type !== TransactionType.SELL) return 0;
  if (!tx.quantity || !tx.price) return 0;
  const quantity = Number(tx.quantity);
  const price = Number(tx.price);
  const rate = resolveTransactionExchangeRate(tx);
  const gross = quantity * price * rate;
  const commission = getCommissionInCny(tx);
  return gross - commission;
}
