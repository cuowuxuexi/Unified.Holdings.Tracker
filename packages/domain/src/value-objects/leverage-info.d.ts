export interface LeverageInfo {
  totalAmount: number;
  usedAmount: number;
  availableAmount: number;
  costRate: number;
}
export declare const zeroLeverage: LeverageInfo;
export declare function ensureLeverageInfo(
  input?: Partial<LeverageInfo> | null
): LeverageInfo;
//# sourceMappingURL=leverage-info.d.ts.map
