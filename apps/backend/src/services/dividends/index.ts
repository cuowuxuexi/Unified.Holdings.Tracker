export {
  AUTO_DIVIDEND_NOTE_PREFIX,
  AUTO_SETTLE_WINDOW_DAYS,
  dismissDividendSettlementByTransaction,
  startDividendScheduler,
  stopDividendScheduler,
  syncPortfolioDividends,
} from './dividendSettlementService';
export type {
  DividendItemState,
  DividendReport,
  DividendReportItem,
  DividendSyncOptions,
} from './dividendSettlementService';
export type {
  DividendEntitlement,
  DividendEvent,
  DividendTaxRates,
  DividendWarning,
} from './types';
