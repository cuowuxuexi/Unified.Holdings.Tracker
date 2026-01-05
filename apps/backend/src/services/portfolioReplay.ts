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
  private readonly lotOffsets = new Map<string, number>();

  private getState(
    assetCode: string,
    currency: CurrencyCode
  ): LotPositionState {
    const existing = this.positions.get(assetCode);
    if (existing) {
      if (!this.lotOffsets.has(assetCode)) {
        this.lotOffsets.set(assetCode, 0);
      }
      if (currency && existing.currency !== currency) {
        console.warn(
          `[LotTracker] 资产 ${assetCode} 出现货币不一致：${existing.currency} -> ${currency}`
        );
      }
      return existing;
    }
    const state = createEmptyState(assetCode, currency);
    this.positions.set(assetCode, state);
    this.lotOffsets.set(assetCode, 0);
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
    let lotIndex = this.lotOffsets.get(tx.assetCode) ?? 0;

    while (remaining > EPSILON && lotIndex < state.lots.length) {
      const lot = state.lots[lotIndex];
      const consume = Math.min(lot.quantity, remaining);
      costRemovedCny += consume * lot.costPerShareCny;
      costRemovedLocal += consume * lot.costPerShareLocal;
      lot.quantity -= consume;
      remaining -= consume;
      matched += consume;
      if (lot.quantity <= EPSILON) {
        lotIndex += 1;
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

    if (lotIndex > 0) {
      if (lotIndex >= state.lots.length) {
        state.lots = [];
        this.lotOffsets.set(tx.assetCode, 0);
      } else if (lotIndex >= 100 && lotIndex >= state.lots.length / 2) {
        state.lots = state.lots.slice(lotIndex);
        this.lotOffsets.set(tx.assetCode, 0);
      } else {
        this.lotOffsets.set(tx.assetCode, lotIndex);
      }
    }

    return { matchedQuantity: matched, costRemovedCny, costRemovedLocal };
  }

  getPositionsSnapshot(): Map<string, LotPositionState> {
    return new Map(
      Array.from(this.positions.entries()).map(([code, state]) => [
        code,
        {
          ...state,
          lots: state.lots
            .slice(this.lotOffsets.get(code) ?? 0)
            .map((lot) => ({ ...lot })),
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

// ============================================================================
// 摊薄成本法（Diluted Cost Method）
// ============================================================================

/**
 * 摊薄成本持仓状态
 * 使用累计买入/卖出金额计算成本，而非 FIFO 批次追踪
 */
export interface DilutedCostState {
  assetCode: string;
  currency: CurrencyCode;
  quantity: number;
  /** 累计买入成本（CNY，只增不减） */
  totalBuyCostCny: number;
  /** 累计买入成本（原币种，只增不减） */
  totalBuyCostLocal: number;
  /** 累计卖出收入（CNY） */
  totalSellProceedsCny: number;
  /** 累计卖出收入（原币种） */
  totalSellProceedsLocal: number;
  /** 累计股息收入（CNY） */
  totalDividendCny: number;
  /** 累计股息收入（原币种） */
  totalDividendLocal: number;
}

/**
 * 摊薄成本追踪器
 *
 * 算法说明：
 * - 摊薄成本 = 累计买入成本 - 累计卖出收入（可为负数）
 * - 成本价 = 摊薄成本 / 持仓数量（可为负数）
 * - 清仓后重新买入：重置累计值，重新开始计算
 * - 收益率分母使用 totalBuyCost（永远为正），避免负成本导致计算错误
 */
export class DilutedCostTracker {
  private readonly positions = new Map<string, DilutedCostState>();

  private getState(assetCode: string, currency: CurrencyCode): DilutedCostState {
    const existing = this.positions.get(assetCode);
    if (existing) {
      if (currency && existing.currency !== currency) {
        console.warn(
          `[DilutedCostTracker] 资产 ${assetCode} 出现货币不一致：${existing.currency} -> ${currency}`
        );
      }
      return existing;
    }
    const state: DilutedCostState = {
      assetCode,
      currency,
      quantity: 0,
      totalBuyCostCny: 0,
      totalBuyCostLocal: 0,
      totalSellProceedsCny: 0,
      totalSellProceedsLocal: 0,
      totalDividendCny: 0,
      totalDividendLocal: 0,
    };
    this.positions.set(assetCode, state);
    return state;
  }

  /**
   * 处理买入交易
   */
  applyBuy(tx: Transaction): void {
    if (!tx.assetCode) return;
    const quantity = Number(tx.quantity ?? 0);
    const price = Number(tx.price ?? 0);
    if (quantity <= 0 || price <= 0) {
      console.warn(
        `[DilutedCostTracker] 忽略无效买入交易 ${tx.id ?? tx.assetCode}：quantity=${tx.quantity}, price=${tx.price}`
      );
      return;
    }

    const commissionLocal = Number(tx.commission ?? 0);
    const rate = resolveTransactionExchangeRate(tx);
    const currency = resolveTransactionCurrency(tx);

    const costLocal = quantity * price + commissionLocal;
    const costCny = costLocal * rate;

    const state = this.getState(tx.assetCode, currency);

    // 如果之前已清仓，重置累计值
    if (state.quantity <= EPSILON) {
      state.totalBuyCostCny = 0;
      state.totalBuyCostLocal = 0;
      state.totalSellProceedsCny = 0;
      state.totalSellProceedsLocal = 0;
      state.totalDividendCny = 0;
      state.totalDividendLocal = 0;
    }

    state.quantity += quantity;
    state.totalBuyCostCny += costCny;
    state.totalBuyCostLocal += costLocal;
  }

  /**
   * 处理卖出交易
   */
  applySell(tx: Transaction): void {
    if (!tx.assetCode) return;
    const quantity = Number(tx.quantity ?? 0);
    const price = Number(tx.price ?? 0);
    if (quantity <= 0) {
      console.warn(
        `[DilutedCostTracker] 忽略无效卖出交易 ${tx.id ?? tx.assetCode}：quantity=${tx.quantity}`
      );
      return;
    }

    const state = this.positions.get(tx.assetCode);
    if (!state || state.quantity <= EPSILON) {
      console.warn(
        `[DilutedCostTracker] 卖出 ${tx.assetCode} 时没有可用持仓，交易ID: ${tx.id}`
      );
      return;
    }

    const commissionLocal = Number(tx.commission ?? 0);
    const rate = resolveTransactionExchangeRate(tx);

    // 卖出收入 = 卖出金额 - 手续费
    const proceedsLocal = quantity * price - commissionLocal;
    const proceedsCny = proceedsLocal * rate;

    const actualSellQty = Math.min(quantity, state.quantity);
    if (quantity > state.quantity + EPSILON) {
      console.warn(
        `[DilutedCostTracker] 卖出 ${tx.assetCode} 超过持仓，卖出=${quantity}, 持仓=${state.quantity}`
      );
    }

    state.quantity = Math.max(0, state.quantity - actualSellQty);
    state.totalSellProceedsCny += proceedsCny;
    state.totalSellProceedsLocal += proceedsLocal;
  }

  /**
   * 处理股息收入
   * 股息收入会降低摊薄价（雪球逻辑）
   */
  applyDividend(tx: Transaction): void {
    if (!tx.assetCode) return;
    const dividendCny = Number(tx.amount ?? 0);
    if (dividendCny <= 0) {
      console.warn(
        `[DilutedCostTracker] 忽略无效股息交易 ${tx.id ?? tx.assetCode}：amount=${tx.amount}`
      );
      return;
    }

    const state = this.positions.get(tx.assetCode);
    if (!state) {
      console.warn(
        `[DilutedCostTracker] 股息 ${tx.assetCode} 时没有持仓，交易ID: ${tx.id}`
      );
      return;
    }

    const rate = resolveTransactionExchangeRate(tx);
    const dividendLocal = dividendCny / rate;

    state.totalDividendCny += dividendCny;
    state.totalDividendLocal += dividendLocal;

    console.log(
      `[DilutedCostTracker] ${tx.assetCode} 股息: ${dividendCny.toFixed(2)} CNY, 累计: ${state.totalDividendCny.toFixed(2)} CNY`
    );
  }

  /**
   * 获取持仓快照
   */
  getPositionsSnapshot(): Map<string, DilutedCostState> {
    return new Map(
      Array.from(this.positions.entries()).map(([code, state]) => [
        code,
        { ...state },
      ])
    );
  }

  /**
   * 计算摊薄成本（可为负数）
   */
  static getDilutedCost(state: DilutedCostState): {
    dilutedCostCny: number;
    dilutedCostLocal: number;
  } {
    return {
      dilutedCostCny: state.totalBuyCostCny - state.totalSellProceedsCny,
      dilutedCostLocal: state.totalBuyCostLocal - state.totalSellProceedsLocal,
    };
  }

  /**
   * 计算摊薄成本价（可为负数）
   * 摊薄成本价 = (累计买入 - 累计卖出) / 持仓数量
   * 用于 totalPnl 计算
   */
  static getCostPrice(state: DilutedCostState): {
    costPriceCny: number;
    costPriceLocal: number;
  } {
    const { dilutedCostCny, dilutedCostLocal } = this.getDilutedCost(state);
    return {
      costPriceCny: state.quantity > 0 ? dilutedCostCny / state.quantity : 0,
      costPriceLocal: state.quantity > 0 ? dilutedCostLocal / state.quantity : 0,
    };
  }

  /**
   * 计算原始成本价（雪球方式，不含卖出收入扣减）
   * 原始成本价 = 累计买入成本 / 持仓数量
   * 用于浮动盈亏（floatingPnl）计算
   */
  static getOriginalCostPrice(state: DilutedCostState): {
    originalCostPriceCny: number;
    originalCostPriceLocal: number;
  } {
    return {
      originalCostPriceCny:
        state.quantity > 0 ? state.totalBuyCostCny / state.quantity : 0,
      originalCostPriceLocal:
        state.quantity > 0 ? state.totalBuyCostLocal / state.quantity : 0,
    };
  }

  /**
   * 计算摊薄价（雪球方式）
   * 摊薄价 = (累计买入成本 - 累计卖出收入 - 累计股息) / 持仓数量
   *        = (摊薄成本 - 股息) / 持仓数量
   */
  static getDilutedPrice(state: DilutedCostState): {
    dilutedPriceCny: number;
    dilutedPriceLocal: number;
  } {
    // 摊薄成本 = 累计买入 - 累计卖出
    const { dilutedCostCny, dilutedCostLocal } = this.getDilutedCost(state);
    // 摊薄价 = (摊薄成本 - 股息) / 数量
    const dilutedPriceCostCny = dilutedCostCny - state.totalDividendCny;
    const dilutedPriceCostLocal = dilutedCostLocal - state.totalDividendLocal;
    return {
      dilutedPriceCny: state.quantity > 0 ? dilutedPriceCostCny / state.quantity : 0,
      dilutedPriceLocal: state.quantity > 0 ? dilutedPriceCostLocal / state.quantity : 0,
    };
  }
}

/**
 * 使用摊薄成本法构建持仓
 *
 * @param transactions 交易记录列表
 * @param options 可选参数
 * @returns 持仓状态映射表
 */
export function buildPositionsUsingDilutedCost(
  transactions: Transaction[],
  options?: BuildPositionsOptions
): Map<string, DilutedCostState> {
  const tracker = new DilutedCostTracker();
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
    } else if (tx.type === TransactionType.DIVIDEND) {
      tracker.applyDividend(tx);
    }
  }

  return tracker.getPositionsSnapshot();
}
