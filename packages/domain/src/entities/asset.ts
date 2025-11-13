export enum Market {
  CN = 'CN',
  HK = 'HK',
  US = 'US',
}

export interface Asset {
  code: string;
  name: string;
  market: Market;
  currency?: string;
}
