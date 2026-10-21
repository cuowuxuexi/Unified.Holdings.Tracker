import {
  isUnpricedSnapshot,
  repairSnapshotFromAnchor,
  RepairSnapshot,
} from '../snapshotRepair';

// 取自生产 2026-08-31（锚点）与 2026-09-01（零价）快照的两只持仓，数值已简化
const anchor: RepairSnapshot = {
  portfolio: {
    date: '2026-08-31',
    cash: 0,
    totalMarketValue: 866190,
    netAssets: 366190,
    totalPnl: -243149,
    unrealizedPnl: -200000,
    leverageUsed: 500000,
    netDepositedCash: 1000000,
  },
  positions: [
    {
      assetCode: 'hk00700',
      quantity: 1400,
      currentPrice: 453,
      marketValue: 543700,
      totalPnl: -148649,
      floatingPnl: -148649,
    },
    {
      assetCode: 'sh600276',
      quantity: 7000,
      currentPrice: 46.07,
      marketValue: 322490,
      totalPnl: -94500,
      floatingPnl: -94500,
    },
  ],
};

const zeroPriced: RepairSnapshot = {
  portfolio: {
    date: '2026-09-01',
    cash: 0,
    totalMarketValue: 1109338,
    netAssets: 609338,
    totalPnl: -2698544,
    unrealizedPnl: -2634140,
    leverageUsed: 500000,
    netDepositedCash: 1000000,
  },
  positions: [
    {
      assetCode: 'hk00700',
      quantity: 1400,
      currentPrice: 0,
      marketValue: 692348,
      totalPnl: 0,
      floatingPnl: 0,
    },
    {
      assetCode: 'sh600276',
      quantity: 7000,
      currentPrice: 0,
      marketValue: 416990,
      totalPnl: 0,
      floatingPnl: 0,
    },
  ],
};

describe('snapshotRepair', () => {
  it('detects snapshots that fell back to cost because quotes were missing', () => {
    expect(isUnpricedSnapshot(anchor.positions)).toBe(false);
    expect(isUnpricedSnapshot(zeroPriced.positions)).toBe(true);
  });

  it('rebuilds market value and P&L from K-line closes and the anchor', () => {
    const result = repairSnapshotFromAnchor({
      anchor,
      previous: anchor,
      target: zeroPriced,
      closes: { hk00700: 450, sh600276: 46.5 },
      fxRates: { hk00700: 0.86, sh600276: 1 },
    });

    const tencent = result.positions.find((row) => row.assetCode === 'hk00700');
    expect(tencent?.currentPrice).toBe(450);
    expect(tencent?.marketValue).toBeCloseTo(541800, 6); // 450 × 1400 × 0.86
    expect(tencent?.totalPnl).toBeCloseTo(-148649 + (541800 - 543700), 6);
    expect(tencent?.dailyPnl).toBeCloseTo((450 - 453) * 1400 * 0.86, 6);
    expect(tencent?.dailyPct).toBeCloseTo(((450 - 453) / 453) * 100, 6);

    expect(result.portfolio.totalMarketValue).toBeCloseTo(541800 + 325500, 6);
    expect(result.portfolio.netAssets).toBeCloseTo(867300 - 500000, 6);
    expect(result.portfolio.totalPnl).toBeCloseTo(
      -243149 + (867300 - 866190),
      6
    );
    expect(result.portfolio.unrealizedPnl).toBeCloseTo(
      -200000 + (867300 - 866190),
      6
    );
    expect(result.portfolio.yearlyReturnValue).toBeCloseTo(367300 - 1000000, 6);
  });

  it('refuses when holdings changed between the anchor and the target', () => {
    expect(() =>
      repairSnapshotFromAnchor({
        anchor,
        previous: anchor,
        target: {
          ...zeroPriced,
          positions: [
            { ...zeroPriced.positions[0], quantity: 1600 },
            zeroPriced.positions[1],
          ],
        },
        closes: { hk00700: 450, sh600276: 46.5 },
        fxRates: { hk00700: 0.86, sh600276: 1 },
      })
    ).toThrow('hk00700 持仓数量与锚点');
  });

  it('refuses when a close price is missing instead of keeping the fake value', () => {
    expect(() =>
      repairSnapshotFromAnchor({
        anchor,
        previous: anchor,
        target: zeroPriced,
        closes: { hk00700: 450 },
        fxRates: { hk00700: 0.86, sh600276: 1 },
      })
    ).toThrow('sh600276 缺少收盘价');
  });
});
