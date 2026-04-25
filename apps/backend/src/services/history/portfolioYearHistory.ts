type DecimalLike = {
  toNumber(): number;
};

export type NumericLike =
  | number
  | string
  | bigint
  | DecimalLike
  | null
  | undefined;

export type PortfolioYearHistoryPortfolioRow = {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
};

export type PortfolioYearHistoryTransactionRow = {
  id?: string;
  date: Date | string;
  type: string;
  amount?: NumericLike;
  quantity?: NumericLike;
  price?: NumericLike;
  commission?: NumericLike;
  leverageUsed?: NumericLike;
  currency?: string | null;
  exchangeRate?: NumericLike;
  assetCode?: string | null;
  notes?: string | null;
};

export type PortfolioYearHistorySnapshotRow = {
  date: string;
  totalMarketValue: NumericLike;
  netAssets: NumericLike;
  totalPnl: NumericLike;
  dailyPnl: NumericLike;
  cash: NumericLike;
  leverageUsed?: NumericLike;
  leverageTotal?: NumericLike;
  leverageCostRate?: NumericLike;
  leverageCumulativeCost?: NumericLike;
  realizedPnl?: NumericLike;
  unrealizedPnl?: NumericLike;
  totalCommission?: NumericLike;
  netDepositedCash?: NumericLike;
  totalDividendIncome?: NumericLike;
  totalPnlPercent?: NumericLike;
  dailyPnlPercent?: NumericLike;
  weeklyReturnPercent?: NumericLike;
  weeklyReturnValue?: NumericLike;
  weeklyBaseDate?: string | null;
  monthlyReturnPercent?: NumericLike;
  monthlyReturnValue?: NumericLike;
  monthlyBaseDate?: string | null;
  yearlyReturnPercent?: NumericLike;
  yearlyReturnValue?: NumericLike;
  yearlyBaseDate?: string | null;
  usdCny?: NumericLike;
  hkdCny?: NumericLike;
  createdAt?: Date | string | null;
};

export type PortfolioYearHistoryPositionRow = {
  date: string;
  assetCode: string;
  quantity: NumericLike;
  currentPrice: NumericLike;
  marketValue: NumericLike;
  costPrice?: NumericLike;
  totalPnl?: NumericLike;
  dailyPnl?: NumericLike;
  dailyPct?: NumericLike;
  totalPnlPercent?: NumericLike;
  floatingPnl?: NumericLike;
  floatingPnlPercent?: NumericLike;
  asset?: {
    name?: string | null;
    market?: string | null;
  } | null;
};

export type PortfolioYearHistoryInput = {
  portfolio: PortfolioYearHistoryPortfolioRow;
  year: number;
  requestedDate?: string;
  transactions: PortfolioYearHistoryTransactionRow[];
  portfolioSnapshots: PortfolioYearHistorySnapshotRow[];
  positionSnapshots: PortfolioYearHistoryPositionRow[];
};

export type PortfolioYearHistoryWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type PortfolioYearHistoryWindow = {
  year: number;
  planned_start: string;
  business_start: string | null;
  effective_start: string;
  requested_end: string;
  resolved_end: string | null;
  latest_available_date: string | null;
  snapshot_days: number;
  missing_days: string[];
};

export type PortfolioYearHistorySeriesPoint = {
  date: string;
  net_assets: number;
  cash: number;
  total_market_value: number;
  daily_pnl: number;
  total_pnl: number;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  net_deposited_cash: number | null;
  total_commission: number | null;
  total_dividend_income: number | null;
  leverage_used: number | null;
  leverage_total: number | null;
  leverage_cost_rate: number | null;
  leverage_cumulative_cost: number | null;
  daily_pnl_percent: number | null;
  total_pnl_percent: number | null;
  weekly_return_percent: number | null;
  weekly_return_value: number | null;
  weekly_base_date: string | null;
  monthly_return_percent: number | null;
  monthly_return_value: number | null;
  monthly_base_date: string | null;
  ytd_return_percent: number | null;
  ytd_return_value: number | null;
  ytd_base_date: string | null;
  usd_cny: number | null;
  hkd_cny: number | null;
};

export type PortfolioYearHistoryCashflow = {
  date: string;
  type: string;
  amount_cny: number | null;
  amount: number | null;
  currency: string;
  exchange_rate: number | null;
  transaction_id?: string;
  asset_code?: string;
  notes?: string;
};

export type PortfolioYearHistoryPosition = {
  asset_code: string;
  asset_name: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  current_price: number;
  market_value_cny: number;
  cost_price: number | null;
  daily_pnl: number | null;
  total_pnl: number | null;
  daily_pct: number | null;
  total_pnl_percent: number | null;
  floating_pnl: number | null;
  floating_pnl_percent: number | null;
};

export type PortfolioYearHistoryPositionsByDate = {
  date: string;
  positions: PortfolioYearHistoryPosition[];
};

export type PortfolioYearHistoryResult = {
  portfolio_year_window: PortfolioYearHistoryWindow;
  portfolio: {
    series: PortfolioYearHistorySeriesPoint[];
    cashflows: PortfolioYearHistoryCashflow[];
    positions_by_date: PortfolioYearHistoryPositionsByDate[];
  };
  warnings: PortfolioYearHistoryWarning[];
};

const CASHFLOW_TYPES = new Set([
  'DEPOSIT',
  'WITHDRAW',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'CASH_IN',
  'CASH_OUT',
  'LEVERAGE_ADD',
  'LEVERAGE_REMOVE',
  'LEVERAGE_COST',
  'DIVIDEND',
]);

export function buildPortfolioYearHistory(
  input: PortfolioYearHistoryInput
): PortfolioYearHistoryResult {
  const plannedStart = `${input.year}-01-01`;
  const yearEnd = `${input.year}-12-31`;
  const requestedEnd = input.requestedDate
    ? minDate(input.requestedDate, yearEnd)
    : yearEnd;

  const snapshotsInYear = sortByDate(
    input.portfolioSnapshots.filter((snapshot) =>
      isWithinClosedWindow(snapshot.date, plannedStart, yearEnd)
    )
  );
  const transactionsInRequestedWindow = sortTransactionsByDate(
    input.transactions.filter((transaction) => {
      const transactionDate = toDateOnly(transaction.date);
      return isWithinClosedWindow(transactionDate, plannedStart, requestedEnd);
    })
  );
  const transactionDatesInYear = input.transactions
    .map((transaction) => toDateOnly(transaction.date))
    .filter((date) => isWithinClosedWindow(date, plannedStart, yearEnd));
  const accountFactDates = [
    ...snapshotsInYear.map((snapshot) => snapshot.date),
    ...transactionDatesInYear,
  ];
  const earliestAccountFactDate = minDateOrNull(accountFactDates);
  const createdAtDate = toOptionalDateOnly(input.portfolio.createdAt);
  const businessStart = earliestAccountFactDate ?? createdAtDate;
  const effectiveStart = maxDate(plannedStart, businessStart ?? plannedStart);
  const latestAvailableDate = maxDateOrNull(
    snapshotsInYear.map((snapshot) => snapshot.date)
  );
  const effectiveRequestedEnd = input.requestedDate
    ? requestedEnd
    : (latestAvailableDate ?? requestedEnd);
  const resolvedEnd = maxDateOrNull(
    snapshotsInYear
      .map((snapshot) => snapshot.date)
      .filter((date) => date <= effectiveRequestedEnd)
  );
  const seriesEnd = resolvedEnd ?? effectiveRequestedEnd;
  const seriesSnapshots = snapshotsInYear.filter((snapshot) =>
    isWithinClosedWindow(snapshot.date, effectiveStart, seriesEnd)
  );
  const positionsInRange = sortPositionsByDate(
    input.positionSnapshots.filter((position) =>
      isWithinClosedWindow(position.date, effectiveStart, seriesEnd)
    )
  );
  const warnings = buildWarnings({
    plannedStart,
    requestedEnd: effectiveRequestedEnd,
    businessStart,
    createdAtDate,
    earliestAccountFactDate,
    snapshotsInYear,
    seriesSnapshots,
    transactionsInRequestedWindow,
    positionsInRange,
    resolvedEnd,
  });

  return {
    portfolio_year_window: {
      year: input.year,
      planned_start: plannedStart,
      business_start: businessStart,
      effective_start: effectiveStart,
      requested_end: effectiveRequestedEnd,
      resolved_end: resolvedEnd,
      latest_available_date: latestAvailableDate,
      snapshot_days: seriesSnapshots.length,
      missing_days: buildMissingDayRanges(
        seriesSnapshots,
        plannedStart,
        seriesEnd
      ),
    },
    portfolio: {
      series: seriesSnapshots.map(toSeriesPoint),
      cashflows: transactionsInRequestedWindow
        .filter((transaction) => CASHFLOW_TYPES.has(transaction.type))
        .map(toCashflow),
      positions_by_date: buildPositionsByDate(positionsInRange),
    },
    warnings,
  };
}

function buildWarnings(params: {
  plannedStart: string;
  requestedEnd: string;
  businessStart: string | null;
  createdAtDate: string | null;
  earliestAccountFactDate: string | null;
  snapshotsInYear: PortfolioYearHistorySnapshotRow[];
  seriesSnapshots: PortfolioYearHistorySnapshotRow[];
  transactionsInRequestedWindow: PortfolioYearHistoryTransactionRow[];
  positionsInRange: PortfolioYearHistoryPositionRow[];
  resolvedEnd: string | null;
}): PortfolioYearHistoryWarning[] {
  const warnings: PortfolioYearHistoryWarning[] = [];
  const snapshotDates = new Set(
    params.seriesSnapshots.map((snapshot) => snapshot.date)
  );
  const positionDates = new Set(
    params.positionsInRange.map((position) => position.date)
  );
  const missingPositionDates = [...snapshotDates].filter(
    (date) => !positionDates.has(date)
  );

  if (params.snapshotsInYear.length === 0) {
    warnings.push({
      code: 'portfolio_snapshot_missing',
      message:
        'No portfolio snapshots were found inside this portfolio/year window; annual portfolio series cannot be reconstructed.',
      details: {
        requested_end: params.requestedEnd,
      },
    });
  }

  if (
    params.transactionsInRequestedWindow.length > 0 &&
    params.snapshotsInYear.length === 0
  ) {
    warnings.push({
      code: 'transactions_without_snapshots',
      message:
        'Transactions exist in this year window, but no same-year portfolio snapshots exist; do not backfill the annual series from other years.',
      details: {
        transaction_count: params.transactionsInRequestedWindow.length,
        transaction_dates: uniqueSorted(
          params.transactionsInRequestedWindow.map((transaction) =>
            toDateOnly(transaction.date)
          )
        ),
      },
    });
  }

  if (
    params.createdAtDate !== null &&
    params.earliestAccountFactDate !== null &&
    params.createdAtDate > params.earliestAccountFactDate
  ) {
    warnings.push({
      code: 'created_at_not_business_start',
      message:
        'Portfolio.createdAt is later than the first account fact in this year window; createdAt is treated as import/bookkeeping time, not the business start.',
      details: {
        created_at: params.createdAtDate,
        business_start: params.earliestAccountFactDate,
      },
    });
  }

  if (
    params.businessStart !== null &&
    params.businessStart > params.plannedStart &&
    params.createdAtDate !== null &&
    params.createdAtDate >= params.businessStart
  ) {
    warnings.push({
      code: 'portfolio_started_after_year_start',
      message:
        'The earliest account fact is later than the natural year start; the annual portfolio curve starts at the first available business fact and does not synthesize earlier days.',
      details: {
        planned_start: params.plannedStart,
        business_start: params.businessStart,
      },
    });
  }

  if (params.resolvedEnd !== null && params.resolvedEnd < params.requestedEnd) {
    warnings.push({
      code: 'resolved_end_before_requested_end',
      message:
        'Requested end date has no portfolio snapshot; annual history resolved to the latest same-year snapshot before it.',
      details: {
        requested_end: params.requestedEnd,
        resolved_end: params.resolvedEnd,
      },
    });
  }

  if (missingPositionDates.length > 0) {
    warnings.push({
      code: 'position_snapshot_missing',
      message:
        'Some portfolio snapshot dates have no matching position snapshots; positions_by_date only contains observed position facts.',
      details: {
        dates: missingPositionDates,
      },
    });
  }

  return warnings;
}

function toSeriesPoint(
  snapshot: PortfolioYearHistorySnapshotRow
): PortfolioYearHistorySeriesPoint {
  return {
    date: snapshot.date,
    net_assets: toNumber(snapshot.netAssets),
    cash: toNumber(snapshot.cash),
    total_market_value: toNumber(snapshot.totalMarketValue),
    daily_pnl: toNumber(snapshot.dailyPnl),
    total_pnl: toNumber(snapshot.totalPnl),
    realized_pnl: toNullableNumber(snapshot.realizedPnl),
    unrealized_pnl: toNullableNumber(snapshot.unrealizedPnl),
    net_deposited_cash: toNullableNumber(snapshot.netDepositedCash),
    total_commission: toNullableNumber(snapshot.totalCommission),
    total_dividend_income: toNullableNumber(snapshot.totalDividendIncome),
    leverage_used: toNullableNumber(snapshot.leverageUsed),
    leverage_total: toNullableNumber(snapshot.leverageTotal),
    leverage_cost_rate: toNullableNumber(snapshot.leverageCostRate),
    leverage_cumulative_cost: toNullableNumber(snapshot.leverageCumulativeCost),
    daily_pnl_percent: toNullableNumber(snapshot.dailyPnlPercent),
    total_pnl_percent: toNullableNumber(snapshot.totalPnlPercent),
    weekly_return_percent: toNullableNumber(snapshot.weeklyReturnPercent),
    weekly_return_value: toNullableNumber(snapshot.weeklyReturnValue),
    weekly_base_date: snapshot.weeklyBaseDate ?? null,
    monthly_return_percent: toNullableNumber(snapshot.monthlyReturnPercent),
    monthly_return_value: toNullableNumber(snapshot.monthlyReturnValue),
    monthly_base_date: snapshot.monthlyBaseDate ?? null,
    ytd_return_percent: toNullableNumber(snapshot.yearlyReturnPercent),
    ytd_return_value: toNullableNumber(snapshot.yearlyReturnValue),
    ytd_base_date: snapshot.yearlyBaseDate ?? null,
    usd_cny: toNullableNumber(snapshot.usdCny),
    hkd_cny: toNullableNumber(snapshot.hkdCny),
  };
}

function toCashflow(
  transaction: PortfolioYearHistoryTransactionRow
): PortfolioYearHistoryCashflow {
  const amount = getTransactionAmount(transaction);
  const exchangeRate = toNullableNumber(transaction.exchangeRate) ?? 1;
  const currency = transaction.currency ?? 'CNY';
  const cashflow: PortfolioYearHistoryCashflow = {
    date: toDateOnly(transaction.date),
    type: transaction.type,
    amount_cny: amount === null ? null : amount * exchangeRate,
    amount,
    currency,
    exchange_rate: exchangeRate,
  };

  if (transaction.id) {
    cashflow.transaction_id = transaction.id;
  }
  if (transaction.assetCode) {
    cashflow.asset_code = transaction.assetCode;
  }
  if (transaction.notes) {
    cashflow.notes = transaction.notes;
  }

  return cashflow;
}

function buildPositionsByDate(
  positions: PortfolioYearHistoryPositionRow[]
): PortfolioYearHistoryPositionsByDate[] {
  const grouped = new Map<string, PortfolioYearHistoryPosition[]>();

  for (const position of positions) {
    const rows = grouped.get(position.date) ?? [];
    rows.push(toPosition(position));
    grouped.set(position.date, rows);
  }

  return [...grouped.entries()].map(([date, rows]) => ({
    date,
    positions: rows.sort(
      (left, right) => right.market_value_cny - left.market_value_cny
    ),
  }));
}

function toPosition(
  position: PortfolioYearHistoryPositionRow
): PortfolioYearHistoryPosition {
  const market = position.asset?.market ?? null;
  return {
    asset_code: position.assetCode,
    asset_name: position.asset?.name ?? null,
    market,
    currency: getCurrencyFromMarket(market),
    quantity: toNumber(position.quantity),
    current_price: toNumber(position.currentPrice),
    market_value_cny: toNumber(position.marketValue),
    cost_price: toNullableNumber(position.costPrice),
    daily_pnl: toNullableNumber(position.dailyPnl),
    total_pnl: toNullableNumber(position.totalPnl),
    daily_pct: toNullableNumber(position.dailyPct),
    total_pnl_percent: toNullableNumber(position.totalPnlPercent),
    floating_pnl: toNullableNumber(position.floatingPnl),
    floating_pnl_percent: toNullableNumber(position.floatingPnlPercent),
  };
}

function getTransactionAmount(
  transaction: PortfolioYearHistoryTransactionRow
): number | null {
  const explicitAmount = toNullableNumber(transaction.amount);
  if (explicitAmount !== null) {
    return explicitAmount;
  }

  const quantity = toNullableNumber(transaction.quantity);
  const price = toNullableNumber(transaction.price);
  if (quantity === null || price === null) {
    return null;
  }

  return quantity * price;
}

function buildMissingDayRanges(
  snapshots: PortfolioYearHistorySnapshotRow[],
  start: string,
  end: string
): string[] {
  if (snapshots.length === 0 || start > end) {
    return start <= end ? [formatDateRange(start, end)] : [];
  }

  const ranges: string[] = [];
  let cursor = start;

  for (const snapshot of snapshots) {
    if (snapshot.date > cursor) {
      ranges.push(formatDateRange(cursor, addDays(snapshot.date, -1)));
    }
    cursor = addDays(snapshot.date, 1);
  }

  if (cursor <= end) {
    ranges.push(formatDateRange(cursor, end));
  }

  return ranges;
}

function formatDateRange(start: string, end: string): string {
  return start === end ? start : `${start}..${end}`;
}

function toNumber(value: NumericLike, fallback = 0): number {
  const next = normalizeNumeric(value);
  return next === null ? fallback : next;
}

function toNullableNumber(value: NumericLike): number | null {
  return normalizeNumeric(value);
}

function normalizeNumeric(value: NumericLike): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const rawValue = typeof value === 'object' ? value.toNumber() : value;
  const next = Number(rawValue);
  return Number.isFinite(next) ? next : null;
}

function toOptionalDateOnly(
  value: Date | string | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toDateOnly(value);
}

function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateOnly) {
      return dateOnly;
    }
    return new Date(value).toISOString().slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function isWithinClosedWindow(
  date: string,
  start: string,
  end: string
): boolean {
  return date >= start && date <= end;
}

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.date.localeCompare(right.date));
}

function sortPositionsByDate(
  rows: PortfolioYearHistoryPositionRow[]
): PortfolioYearHistoryPositionRow[] {
  return [...rows].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      toNumber(right.marketValue) - toNumber(left.marketValue)
  );
}

function sortTransactionsByDate(
  rows: PortfolioYearHistoryTransactionRow[]
): PortfolioYearHistoryTransactionRow[] {
  return [...rows].sort((left, right) =>
    toDateOnly(left.date).localeCompare(toDateOnly(right.date))
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function maxDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minDateOrNull(dates: string[]): string | null {
  return dates.length === 0 ? null : dates.reduce(minDate);
}

function maxDateOrNull(dates: string[]): string | null {
  return dates.length === 0 ? null : dates.reduce(maxDate);
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function getCurrencyFromMarket(market: string | null): string {
  if (market === 'HK') {
    return 'HKD';
  }
  if (market === 'US') {
    return 'USD';
  }
  return 'CNY';
}
