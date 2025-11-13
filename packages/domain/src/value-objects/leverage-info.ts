export interface LeverageInfo {
  totalAmount: number;
  usedAmount: number;
  availableAmount: number;
  costRate: number;
}

export const zeroLeverage: LeverageInfo = {
  totalAmount: 0,
  usedAmount: 0,
  availableAmount: 0,
  costRate: 0,
};

export function ensureLeverageInfo(
  input?: Partial<LeverageInfo> | null
): LeverageInfo {
  return {
    totalAmount: input?.totalAmount ?? 0,
    usedAmount: input?.usedAmount ?? 0,
    availableAmount: input?.availableAmount ?? 0,
    costRate: input?.costRate ?? 0,
  };
}
