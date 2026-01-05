#!/usr/bin/env node
import { readPortfolios, getPortfolioById } from '@uht/infra';
import {
  calculateRealtimePnl,
  calculateTotalCommission,
  calculateTotalPnlV2,
} from '../apps/backend/src/services/calculationService';
import { fetchQuotes } from '../apps/backend/src/services/tencentApi';
import {
  Portfolio,
  Position,
  Transaction,
  Asset,
  Market,
  Quote,
} from '../apps/backend/src/types';
import { buildPositionsUsingLots } from '../apps/backend/src/services/portfolioReplay';

function getMarketFromCode(code: string): Market {
  const lower = code.toLowerCase();
  if (lower.startsWith('hk')) return Market.HK;
  if (lower.startsWith('us')) return Market.US;
  return Market.CN;
}

function buildPositions(transactions: Transaction[]): Position[] {
  const lotStates = buildPositionsUsingLots(transactions);
  const positions: Position[] = [];

  for (const state of lotStates.values()) {
    if (state.quantity <= 0) continue;
    const market = getMarketFromCode(state.assetCode);
    const asset: Asset = {
      code: state.assetCode,
      market,
      name: state.assetCode,
    };
    const costPrice =
      state.quantity > 0 ? state.totalCostCny / state.quantity : 0;
    const costPriceLocal =
      state.quantity > 0 ? state.totalCostLocal / state.quantity : 0;
    positions.push({
      asset,
      quantity: state.quantity,
      costPrice,
      costPriceLocal,
      totalCost: state.totalCostCny,
      totalCostLocal: state.totalCostLocal,
      currency: state.currency,
      marketValue: 0,
      marketValueLocal: 0,
      marketValueCNY: 0,
      currentPrice: 0,
      dailyChange: 0,
      dailyChangeLocal: 0,
      totalPnl: 0,
      totalPnlLocal: 0,
    });
  }

  return positions;
}

function createQuotesMap(quotes: Quote[]): Record<string, Quote> {
  return quotes.reduce((map, quote) => {
    map[quote.code] = quote;
    return map;
  }, {} as Record<string, Quote>);
}

async function loadPortfolio(targetId?: string): Promise<Portfolio> {
  const portfolios = await readPortfolios();
  if (portfolios.length === 0) {
    throw new Error('数据库中没有投资组合记录');
  }
  const target =
    targetId ?? (portfolios.length > 0 ? portfolios[0].id : undefined);
  if (!target) {
    throw new Error('缺少可用的投资组合 ID');
  }
  const portfolio = await getPortfolioById(target);
  if (!portfolio) {
    throw new Error(`未找到指定的投资组合: ${target}`);
  }
  return portfolio;
}

async function main() {
  const targetId = process.argv[2];
  const portfolio = await loadPortfolio(targetId);
  console.log(`\n组合: ${portfolio.name} (${portfolio.id})`);
  console.log(`交易数量: ${portfolio.transactions.length}`);

  const basePositions = buildPositions(portfolio.transactions);
  const assetCodes = basePositions.map((p) => p.asset.code);

  let quotes: Quote[] = [];
  if (assetCodes.length > 0) {
    try {
      quotes = await fetchQuotes(assetCodes);
    } catch (error) {
      console.warn('[audit:pnl] 获取实时行情失败，使用成本价作为参考。', error);
    }
  }

  const quotesMap = createQuotesMap(quotes);
  const realtimePositions = calculateRealtimePnl(basePositions, quotesMap);
  const totalCommission = await calculateTotalCommission(portfolio);
  const pnl = await calculateTotalPnlV2(portfolio, realtimePositions);

  const totalMarketValue = realtimePositions.reduce(
    (sum, pos) => sum + (pos.marketValue ?? 0),
    0
  );

  const summary = {
    cash: portfolio.cash.toFixed(2),
    marketValue: totalMarketValue.toFixed(2),
    realizedPnl: pnl.realizedPnl.toFixed(2),
    unrealizedPnl: pnl.unrealizedPnl.toFixed(2),
    totalPnl: pnl.totalPnl.toFixed(2),
    totalCommission: totalCommission.toFixed(2),
  };

  console.log('\n=== 盈亏总览 (单位：CNY) ===');
  console.table(summary);

  console.log('\n明细:');
  console.log(
    `  已实现盈亏: ${pnl.realizedPnl.toFixed(2)} | 未实现盈亏: ${pnl.unrealizedPnl.toFixed(
      2
    )}`
  );
  console.log(
    `  累计手续费: ${totalCommission.toFixed(2)} | 当前持仓市值: ${totalMarketValue.toFixed(
      2
    )}`
  );

  if (realtimePositions.length) {
    console.log('\n头部持仓（按市值排序前 5）:');
    const topPositions = [...realtimePositions]
      .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
      .slice(0, 5);
    topPositions.forEach((pos) => {
      console.log(
        `  ${pos.asset.code.padEnd(8)} 持仓 ${pos.quantity
          .toFixed(2)
          .padStart(8)} 股 | 市值 ${(
          pos.marketValue ?? 0
        ).toFixed(2)} | 浮盈亏 ${(pos.totalPnl ?? 0).toFixed(2)}`
      );
    });
  }

  console.log('\n完成审计。\n');
}

main().catch((error) => {
  console.error('[audit:pnl] 运行失败:', error);
  process.exit(1);
});
