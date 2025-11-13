export interface ExchangeRateInfo {
  pair: string;
  rate: number;
  timestamp: string;
}
export interface FxRateProvider {
  init?(): Promise<void>;
  getPairRate(pair: string): Promise<number | null>;
  getRate(from: string, to: string): Promise<number | null>;
  getRateForAsset(assetCode: string): Promise<number | null>;
  getRateInfo(pair: string): Promise<ExchangeRateInfo | null>;
}
//# sourceMappingURL=fx-rate-provider.d.ts.map
