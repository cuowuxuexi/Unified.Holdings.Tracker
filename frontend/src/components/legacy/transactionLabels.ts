import { TransactionType } from '../../store/types';

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  [TransactionType.BUY]: '买入',
  [TransactionType.SELL]: '卖出',
  [TransactionType.DEPOSIT]: '入金',
  [TransactionType.WITHDRAW]: '出金',
  [TransactionType.DIVIDEND]: '股息',
};
