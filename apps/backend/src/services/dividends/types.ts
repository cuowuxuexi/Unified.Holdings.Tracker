export type DividendMarket = 'CN' | 'HK' | 'US';
export type DividendCurrency = 'CNY' | 'HKD' | 'USD';

/** 一次现金分红（含税）事件，金额为本币每股 */
export interface DividendEvent {
  assetCode: string;
  market: DividendMarket;
  /** 除权（息）日 YYYY-MM-DD；此日之前持有的股份才享有 */
  exDate: string;
  recordDate: string | null;
  /** 派息日 YYYY-MM-DD；源未公布时为 null */
  payDate: string | null;
  cashPerShare: number;
  currency: DividendCurrency;
  /** 源方案原文，如「10派25.796852元(含税…)」「每股派港币5.3元」 */
  description: string;
  /** 每股送转股数（送股/转增/以股代息），只提示、不自动调整持仓 */
  bonusSharesPerShare: number | null;
  sourceId: string;
}

export interface DividendTaxRates {
  CN: number;
  HK: number;
  US: number;
}

export type DividendEntitlementStatus =
  /** 已过派息日，可入账 */
  | 'PAYABLE'
  /** 已除权，等派息日 */
  | 'AWAITING_PAYMENT'
  /** 已除权，源未给派息日 */
  | 'PAY_DATE_UNKNOWN'
  /** 尚未除权，数量按当前持仓估算 */
  | 'UPCOMING';

export interface DividendEntitlement {
  eventKey: string;
  event: DividendEvent;
  quantity: number;
  grossAmount: number;
  taxRate: number;
  taxAmount: number;
  netAmount: number;
  status: DividendEntitlementStatus;
}

export type DividendSettlementStatus =
  | 'SETTLED'
  | 'MATCHED_MANUAL'
  | 'DISMISSED';

export interface DividendWarning {
  code:
    | 'dividend_source_failed'
    | 'dividend_plan_unparsed'
    | 'dividend_bonus_shares'
    | 'dividend_fx_fallback';
  message: string;
  assetCode?: string;
}
