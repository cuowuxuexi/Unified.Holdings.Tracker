/**
 * 零价快照修复（纯计算）
 *
 * 行情失败时快照会把持仓现价记 0、市值回退成成本，当天净资产与累计盈亏全错。
 * 修复口径：以「此前最近一天全部有价的快照」为锚点，锚点到目标日之间没有任何交易时，
 * 持仓数量、现金、融资余额都不变，只有价格（与汇率）变化，于是
 *   市值 = K 线收盘价 × 数量 × 汇率
 *   累计/浮动盈亏 = 锚点值 + (新市值 − 锚点市值)
 * 这是精确等式，不是插值。周/月收益依赖周期基准与 Modified Dietz，修复时置空而不是猜。
 */

export interface RepairPositionRow {
  assetCode: string;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  totalPnl: number | null;
  floatingPnl: number | null;
}

export interface RepairPortfolioRow {
  date: string;
  cash: number;
  totalMarketValue: number;
  netAssets: number;
  totalPnl: number | null;
  unrealizedPnl: number | null;
  leverageUsed: number | null;
  netDepositedCash: number | null;
}

export interface RepairSnapshot {
  portfolio: RepairPortfolioRow;
  positions: RepairPositionRow[];
}

export interface RepairInput {
  /** 目标日之前最近一份全部有价的快照（与目标日之间无交易） */
  anchor: RepairSnapshot;
  /** 目标日前一份快照（锚点或已修复的前一天），用于当日盈亏 */
  previous: RepairSnapshot;
  target: RepairSnapshot;
  /** 资产代码 → 目标日（或之前最近交易日）不复权收盘价，本币 */
  closes: Record<string, number>;
  /** 资产代码 → 目标日本币兑 CNY 汇率 */
  fxRates: Record<string, number>;
}

export interface RepairedPositionRow {
  assetCode: string;
  currentPrice: number;
  marketValue: number;
  totalPnl: number | null;
  dailyPnl: number | null;
  dailyPct: number | null;
  totalPnlPercent: number | null;
  floatingPnl: number | null;
  floatingPnlPercent: number | null;
}

export interface RepairedPortfolioRow {
  totalMarketValue: number;
  netAssets: number;
  totalPnl: number | null;
  dailyPnl: number;
  unrealizedPnl: number | null;
  totalPnlPercent: number | null;
  dailyPnlPercent: number | null;
  yearlyReturnValue: number | null;
  yearlyReturnPercent: number | null;
}

export interface RepairResult {
  portfolio: RepairedPortfolioRow;
  positions: RepairedPositionRow[];
}

export function isUnpricedSnapshot(positions: RepairPositionRow[]): boolean {
  return positions.some(
    (row) => row.quantity > 0 && !(Number(row.currentPrice) > 0)
  );
}

export function repairSnapshotFromAnchor(input: RepairInput): RepairResult {
  const { anchor, previous, target, closes, fxRates } = input;
  const anchorByCode = new Map(
    anchor.positions.map((row) => [row.assetCode, row])
  );
  const previousByCode = new Map(
    previous.positions.map((row) => [row.assetCode, row])
  );
  const heldTarget = target.positions.filter((row) => row.quantity > 0);
  const heldAnchor = anchor.positions.filter((row) => row.quantity > 0);

  if (heldTarget.length !== heldAnchor.length) {
    throw new Error(
      `${target.portfolio.date} 持仓只数 ${heldTarget.length} 与锚点 ${anchor.portfolio.date} 的 ${heldAnchor.length} 不一致`
    );
  }

  const positions = heldTarget.map((row): RepairedPositionRow => {
    const anchorRow = anchorByCode.get(row.assetCode);
    if (!anchorRow || anchorRow.quantity !== row.quantity) {
      throw new Error(
        `${target.portfolio.date} ${row.assetCode} 持仓数量与锚点 ${anchor.portfolio.date} 不一致`
      );
    }
    const close = closes[row.assetCode];
    const fx = fxRates[row.assetCode];
    if (!(close > 0) || !(fx > 0)) {
      throw new Error(
        `${target.portfolio.date} ${row.assetCode} 缺少收盘价或汇率（close=${close}, fx=${fx}）`
      );
    }

    const marketValue = close * row.quantity * fx;
    const delta = marketValue - anchorRow.marketValue;
    const totalPnl =
      anchorRow.totalPnl === null ? null : anchorRow.totalPnl + delta;
    const floatingPnl =
      anchorRow.floatingPnl === null ? null : anchorRow.floatingPnl + delta;

    const previousRow = previousByCode.get(row.assetCode);
    const previousClose =
      previousRow && previousRow.currentPrice > 0
        ? previousRow.currentPrice
        : null;

    return {
      assetCode: row.assetCode,
      currentPrice: close,
      marketValue,
      totalPnl,
      dailyPnl:
        previousClose === null
          ? null
          : (close - previousClose) * row.quantity * fx,
      dailyPct:
        previousClose === null
          ? null
          : ((close - previousClose) / previousClose) * 100,
      totalPnlPercent: percentOfCostBasis(
        totalPnl,
        anchorRow.marketValue,
        anchorRow.totalPnl
      ),
      floatingPnl,
      floatingPnlPercent: percentOfCostBasis(
        floatingPnl,
        anchorRow.marketValue,
        anchorRow.floatingPnl
      ),
    };
  });

  const totalMarketValue = positions.reduce(
    (sum, row) => sum + row.marketValue,
    0
  );
  const anchorLeverageUsed =
    anchor.portfolio.leverageUsed ??
    anchor.portfolio.totalMarketValue +
      anchor.portfolio.cash -
      anchor.portfolio.netAssets;
  const netAssets =
    totalMarketValue + anchor.portfolio.cash - anchorLeverageUsed;
  const delta = totalMarketValue - anchor.portfolio.totalMarketValue;
  const totalPnl =
    anchor.portfolio.totalPnl === null
      ? null
      : anchor.portfolio.totalPnl + delta;
  const dailyPnl = positions.reduce((sum, row) => sum + (row.dailyPnl ?? 0), 0);
  const netDepositedCash = target.portfolio.netDepositedCash;
  const prevNetAssets = netAssets - dailyPnl;

  return {
    positions,
    portfolio: {
      totalMarketValue,
      netAssets,
      totalPnl,
      dailyPnl,
      unrealizedPnl:
        anchor.portfolio.unrealizedPnl === null
          ? null
          : anchor.portfolio.unrealizedPnl + delta,
      totalPnlPercent:
        totalPnl !== null && netDepositedCash !== null && netDepositedCash > 0
          ? (totalPnl / netDepositedCash) * 100
          : null,
      dailyPnlPercent:
        prevNetAssets > 0 ? (dailyPnl / prevNetAssets) * 100 : null,
      yearlyReturnValue:
        netDepositedCash !== null && netDepositedCash > 0
          ? netAssets - netDepositedCash
          : null,
      yearlyReturnPercent:
        netDepositedCash !== null && netDepositedCash > 0
          ? ((netAssets - netDepositedCash) / netDepositedCash) * 100
          : null,
    },
  };
}

function percentOfCostBasis(
  pnl: number | null,
  anchorMarketValue: number,
  anchorPnl: number | null
): number | null {
  if (pnl === null || anchorPnl === null) return null;
  const costBasis = anchorMarketValue - anchorPnl;
  return costBasis > 0 ? (pnl / costBasis) * 100 : null;
}
