import { Transaction, TransactionType } from '../../types';
import {
  DividendEntitlement,
  DividendEvent,
  DividendTaxRates,
  DividendWarning,
} from './types';

export const DEFAULT_DIVIDEND_TAX_RATES: DividendTaxRates = {
  // A 股个人：派息时不扣税，持股不满一年的差别化红利税在卖出时由券商补扣（不在此建模）
  CN: 0,
  // 港股通个人投资者：H 股与非 H 股（红筹、开曼等）均按 20% 代扣
  HK: 0.2,
  // 美股：已提交 W-8BEN 的中国税收居民按中美税收协定 10% 预扣
  US: 0.1,
};

export function resolveDividendTaxRates(
  env: NodeJS.ProcessEnv = process.env
): DividendTaxRates {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value < 1 ? value : fallback;
  };
  return {
    CN: read('UHT_DIVIDEND_TAX_CN', DEFAULT_DIVIDEND_TAX_RATES.CN),
    HK: read('UHT_DIVIDEND_TAX_HK', DEFAULT_DIVIDEND_TAX_RATES.HK),
    US: read('UHT_DIVIDEND_TAX_US', DEFAULT_DIVIDEND_TAX_RATES.US),
  };
}

/** 交易时间按北京时间归日（交易记录以 UTC 落库） */
export function toBeijingDate(value: string | Date): string {
  const ms = new Date(value).getTime() + 8 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function buildDividendEventKey(event: DividendEvent): string {
  return [
    event.assetCode,
    event.exDate,
    Number(event.cashPerShare.toFixed(6)),
    event.currency,
  ].join(':');
}

/** 某日开盘前（即前一交易日收盘）的持股数：只计交易日早于该日的买卖 */
export function quantityHeldBefore(
  transactions: Transaction[],
  assetCode: string,
  date: string
): number {
  let quantity = 0;
  for (const tx of transactions) {
    if (tx.assetCode !== assetCode) continue;
    if (toBeijingDate(tx.date) >= date) continue;
    if (tx.type === TransactionType.BUY) quantity += Number(tx.quantity ?? 0);
    if (tx.type === TransactionType.SELL) quantity -= Number(tx.quantity ?? 0);
  }
  return quantity;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeDividendEntitlements(params: {
  transactions: Transaction[];
  events: DividendEvent[];
  today: string;
  taxRates: DividendTaxRates;
}): { entitlements: DividendEntitlement[]; warnings: DividendWarning[] } {
  const { transactions, events, today, taxRates } = params;
  const entitlements: DividendEntitlement[] = [];
  const warnings: DividendWarning[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const eventKey = buildDividendEventKey(event);
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);

    const exDatePassed = event.exDate <= today;
    // 未除权的按当前持仓估算（今天之后的交易不存在）
    const quantity = quantityHeldBefore(
      transactions,
      event.assetCode,
      exDatePassed ? event.exDate : '9999-12-31'
    );
    if (!(quantity > 0)) continue;

    if (event.bonusSharesPerShare && event.bonusSharesPerShare > 0) {
      warnings.push({
        code: 'dividend_bonus_shares',
        assetCode: event.assetCode,
        message: `${event.assetCode} ${event.exDate} 有送转股（每股 ${event.bonusSharesPerShare} 股，${event.description}），持仓数量需手动调整`,
      });
    }
    if (!(event.cashPerShare > 0)) continue;

    const taxRate = taxRates[event.market];
    const grossAmount = roundMoney(event.cashPerShare * quantity);
    const taxAmount = roundMoney(grossAmount * taxRate);
    entitlements.push({
      eventKey,
      event,
      quantity,
      grossAmount,
      taxRate,
      taxAmount,
      netAmount: roundMoney(grossAmount - taxAmount),
      status: !exDatePassed
        ? 'UPCOMING'
        : !event.payDate
          ? 'PAY_DATE_UNKNOWN'
          : event.payDate <= today
            ? 'PAYABLE'
            : 'AWAITING_PAYMENT',
    });
  }

  entitlements.sort(
    (left, right) =>
      left.event.exDate.localeCompare(right.event.exDate) ||
      left.event.assetCode.localeCompare(right.event.assetCode)
  );
  return { entitlements, warnings };
}
