import NodeCache from 'node-cache';
import {
  Portfolio,
  Position,
  Transaction,
  Asset,
  Market,
  Quote,
} from '../types';
import {
  calculateRealtimePnl,
  calculatePeriodStats,
  calculateNetDepositedCash,
  calculateTotalCommission,
  calculateLeverageCostByDay,
  calculateTotalDividendIncome,
  calculateTotalPnlV2,
} from './calculation';
import { fetchQuotes } from './tencentApi';
import {
  buildPositionsUsingLots,
  buildPositionsUsingDilutedCost,
  DilutedCostTracker,
} from './portfolioReplay';
import {
  periodCacheService,
  PERIOD_CACHE_TTL,
  PeriodCacheBucket,
} from '@uht/infra/cache/period-cache-service';
import { cacheService } from '@uht/infra/cache/cache-service';

const DEFAULT_CACHE_TTL_SECONDS = Number(
  process.env.PORTFOLIO_STATS_CACHE_TTL ?? 60
);
const DEFAULT_CACHE_MAX_KEYS = Number(
  process.env.PORTFOLIO_STATS_CACHE_MAX_KEYS ?? 500
);
const CACHE_CHECK_PERIOD_SECONDS = Math.max(
  30,
  Math.min(DEFAULT_CACHE_TTL_SECONDS * 2, 300)
);

export interface PortfolioStatsOptions {
  includePeriods?: PeriodCacheBucket[];
  includeQuotes?: boolean;
}

export interface PortfolioFullStats {
  // 基础信息
  portfolioId: string;
  name: string;
  cash: number;
  initialCash: number;
  leverage: Portfolio['leverage'];

  // 持仓信息
  positions: Position[];
  totalMarketValue: number;
  totalAssets: number;
  netAssets: number;

  // 财务指标
  netDepositedCash: number;
  totalCommission: number;
  leverageCost: number;
  totalDividendIncome: number;

  // 盈亏数据
  dailyPnl: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;

  // 周期统计
  weeklyStats?: Awaited<ReturnType<typeof calculatePeriodStats>>;
  monthlyStats?: Awaited<ReturnType<typeof calculatePeriodStats>>;
  yearlyStats?: Awaited<ReturnType<typeof calculatePeriodStats>>;
  periodStats?: Partial<
    Record<PeriodCacheBucket, Awaited<ReturnType<typeof calculatePeriodStats>>>
  >;

  // 元数据
  timestamp: number;
  cached: boolean;
}

/**
 * 投资组合统计服务
 * 统一管理所有接口的计算逻辑，避免重复计算
 */
export class PortfolioStatsService {
  private cache: NodeCache;
  private pendingComputations = new Map<string, Promise<PortfolioFullStats>>();

  constructor() {
    this.cache = new NodeCache({
      stdTTL: DEFAULT_CACHE_TTL_SECONDS,
      checkperiod: CACHE_CHECK_PERIOD_SECONDS,
      useClones: false,
      maxKeys: DEFAULT_CACHE_MAX_KEYS,
    });
  }

  /**
   * 获取完整的投资组合统计数据
   * 所有计算只执行一次，结果缓存默认 60 秒
   */
  async getFullStats(
    portfolio: Portfolio,
    options: PortfolioStatsOptions = {}
  ): Promise<PortfolioFullStats> {
    const includePeriods = this.normalizePeriods(options.includePeriods);
    const includeQuotes = options.includeQuotes !== false;
    const cacheKey = this.buildCacheKey(
      portfolio.id,
      includePeriods,
      includeQuotes
    );

    const cached = this.cache.get<PortfolioFullStats>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const ongoing = this.pendingComputations.get(cacheKey);
    if (ongoing) {
      const result = await ongoing;
      return { ...result, cached: true };
    }

    const computation = this.computeStats(
      portfolio,
      includePeriods,
      includeQuotes
    );
    this.pendingComputations.set(cacheKey, computation);

    try {
      const result = await computation;
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      this.pendingComputations.delete(cacheKey);
    }
  }

  /**
   * 清除指定投资组合的缓存（包含周期统计缓存）
   */
  clearCache(portfolioId: string): void {
    const cacheKeys = this.cache
      .keys()
      .filter((key) => key.includes(`portfolio:${portfolioId}:`));
    cacheKeys.forEach((key) => this.cache.del(key));

    for (const key of this.pendingComputations.keys()) {
      if (key.includes(`portfolio:${portfolioId}:`)) {
        this.pendingComputations.delete(key);
      }
    }

    cacheService.deleteByPrefix(`stats:${portfolioId}:`);
    console.log(
      `[PortfolioStatsService] Cleared ${cacheKeys.length} cache entries for ${portfolioId}`
    );
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cache.flushAll();
    this.pendingComputations.clear();
    cacheService.clear();
    console.log('[PortfolioStatsService] Cleared all cache');
  }

  private buildCacheKey(
    portfolioId: string,
    includePeriods: PeriodCacheBucket[],
    includeQuotes: boolean
  ) {
    const periodKey = includePeriods.join(',');
    return `portfolio:${portfolioId}:periods:${periodKey}:quotes:${includeQuotes}`;
  }

  private normalizePeriods(periods?: PeriodCacheBucket[]): PeriodCacheBucket[] {
    const defaults: PeriodCacheBucket[] = ['weekly', 'monthly', 'yearly'];
    const merged = periods ? [...defaults, ...periods] : defaults;
    return Array.from(new Set(merged)).sort();
  }

  private getMarketFromCode(code: string): Market | null {
    const lowerCode = code.toLowerCase();
    if (lowerCode.startsWith('sh') || lowerCode.startsWith('sz'))
      return Market.CN;
    if (lowerCode.startsWith('hk')) return Market.HK;
    if (lowerCode.startsWith('us')) return Market.US;
    console.warn(
      `[PortfolioStatsService] Could not determine market for code: ${code}.`
    );
    return null;
  }

  private buildBasePositions(transactions: Transaction[]): Position[] {
    // 使用 FIFO 批次追踪计算成本价（用于浮动盈亏）
    const lotPositions = buildPositionsUsingLots(transactions);
    // 使用摊薄成本法计算摊薄成本和股息信息（用于总盈亏）
    const dilutedPositions = buildPositionsUsingDilutedCost(transactions);
    const positions: Position[] = [];

    for (const [assetCode, dilutedState] of dilutedPositions.entries()) {
      if (dilutedState.quantity <= 0) continue;

      const market = this.getMarketFromCode(assetCode);
      if (!market) continue;

      const asset: Asset = {
        code: assetCode,
        market,
        name: assetCode,
      };

      // 从 FIFO 批次获取成本价（雪球的「成本」定义）
      const lotState = lotPositions.get(assetCode);
      let fifoCostPriceCny = 0;
      let fifoCostPriceLocal = 0;
      if (lotState && lotState.quantity > 0) {
        fifoCostPriceCny = lotState.totalCostCny / lotState.quantity;
        fifoCostPriceLocal = lotState.totalCostLocal / lotState.quantity;
      }

      // 计算摊薄成本（用于 totalPnl）
      const { dilutedCostCny, dilutedCostLocal } =
        DilutedCostTracker.getDilutedCost(dilutedState);
      // 计算摊薄价（雪球方式，累计买入 - 股息 / 数量）
      const { dilutedPriceCny, dilutedPriceLocal } =
        DilutedCostTracker.getDilutedPrice(dilutedState);

      positions.push({
        asset,
        quantity: dilutedState.quantity,
        // 成本价使用 FIFO 批次成本（当前持仓的加权平均买入成本），用于浮动盈亏计算
        costPrice: fifoCostPriceCny,
        costPriceLocal: fifoCostPriceLocal,
        // 摊薄成本（累计买入 - 累计卖出），用于总盈亏计算
        totalCost: dilutedCostCny,
        totalCostLocal: dilutedCostLocal,
        // 累计买入成本（用于收益率计算，永远为正）
        totalBuyCost: dilutedState.totalBuyCostCny,
        totalBuyCostLocal: dilutedState.totalBuyCostLocal,
        // 摊薄价和股息相关字段
        dilutedPrice: dilutedPriceCny,
        dilutedPriceLocal: dilutedPriceLocal,
        totalDividend: dilutedState.totalDividendCny,
        totalDividendLocal: dilutedState.totalDividendLocal,
        currency: dilutedState.currency,
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

  private applyCostAsMarketValue(positions: Position[]): Position[] {
    return positions.map((pos) => ({
      ...pos,
      marketValue: pos.totalCost ?? 0,
      marketValueCNY: pos.totalCost ?? 0,
      marketValueLocal: pos.totalCostLocal ?? pos.totalCost ?? 0,
      dailyChange: 0,
      dailyChangeLocal: 0,
      totalPnl: 0,
      totalPnlLocal: 0,
    }));
  }

  private async loadQuotes(
    positions: Position[],
    includeQuotes: boolean
  ): Promise<Record<string, Quote>> {
    if (!includeQuotes || positions.length === 0) {
      return {};
    }
    const assetCodes = Array.from(
      new Set(positions.map((p) => p.asset.code).filter(Boolean))
    );
    if (assetCodes.length === 0) {
      return {};
    }
    try {
      const quotesArray = await fetchQuotes(assetCodes);
      return quotesArray.reduce(
        (map, quote) => {
          map[quote.code] = quote;
          return map;
        },
        {} as Record<string, Quote>
      );
    } catch (error) {
      console.error(
        '[PortfolioStatsService] Failed to fetch quotes, fallback to cost prices.',
        error
      );
      return {};
    }
  }

  private async loadPeriodStats(
    portfolio: Portfolio,
    includePeriods: PeriodCacheBucket[],
    quotesMap: Record<string, Quote>
  ) {
    const bucket = periodCacheService.getPeriodStatsTimeBucket();

    const periodPromises = includePeriods.map(async (period) => {
      const cacheKey = periodCacheService.getPeriodStatsCacheKey(
        portfolio.id,
        period,
        bucket
      );

      const stats = await periodCacheService.rememberPeriodStats(
        cacheKey,
        PERIOD_CACHE_TTL.periodStats.ttl,
        () => calculatePeriodStats(portfolio, period, { quotes: quotesMap })
      );

      return [period, stats] as const;
    });

    const periodStats = await Promise.all(periodPromises);
    return Object.fromEntries(periodStats) as Partial<
      Record<
        PeriodCacheBucket,
        Awaited<ReturnType<typeof calculatePeriodStats>>
      >
    >;
  }

  private async computeStats(
    portfolio: Portfolio,
    includePeriods: PeriodCacheBucket[],
    includeQuotes: boolean
  ): Promise<PortfolioFullStats> {
    const basePositions = this.buildBasePositions(portfolio.transactions || []);
    const quotesMap = await this.loadQuotes(basePositions, includeQuotes);
    const positions =
      includeQuotes && Object.keys(quotesMap).length > 0
        ? calculateRealtimePnl(basePositions, quotesMap)
        : this.applyCostAsMarketValue(basePositions);

    const totalCommission = await calculateTotalCommission(portfolio);
    const netDepositedCash = calculateNetDepositedCash(portfolio);
    const totalDividendIncome = calculateTotalDividendIncome(portfolio);

    let leverageCost = 0;
    if (portfolio.transactions && portfolio.transactions.length > 0) {
      // 计算本年融资成本：从今年1月1日开始
      const today = new Date();
      const yearStart = new Date(today.getFullYear(), 0, 1); // 本年1月1日

      // 如果第一笔交易在今年之后,则使用第一笔交易日期作为起始日期
      const firstTxDate = portfolio.transactions.reduce((earliest, current) => {
        const currentTs = new Date(current.date);
        return currentTs < earliest ? currentTs : earliest;
      }, new Date(portfolio.transactions[0].date));

      const startDate = firstTxDate > yearStart ? firstTxDate : yearStart;

      console.log(
        `[PortfolioStatsService] 计算本年融资成本，起始日期: ${startDate.toISOString().slice(0, 10)}`
      );

      leverageCost = calculateLeverageCostByDay(portfolio, startDate, today);
    }

    let totalMarketValue = 0;
    let dailyPnl = 0;
    for (const pos of positions) {
      totalMarketValue += pos.marketValue ?? pos.marketValueCNY ?? 0;
      dailyPnl += pos.dailyChange ?? 0;
    }

    const totalAssets = Number(portfolio.cash) + totalMarketValue;
    const netAssets = totalAssets - Number(portfolio.leverage?.usedAmount ?? 0);

    const pnlV2 = await calculateTotalPnlV2(portfolio, positions);

    const periodStats = await this.loadPeriodStats(
      portfolio,
      includePeriods,
      quotesMap
    );

    const result: PortfolioFullStats = {
      portfolioId: portfolio.id,
      name: portfolio.name,
      cash: Number(portfolio.cash),
      initialCash: Number(portfolio.initialCash ?? 0),
      leverage: portfolio.leverage,
      positions,
      totalMarketValue,
      totalAssets,
      netAssets,
      netDepositedCash,
      totalCommission,
      leverageCost,
      totalDividendIncome,
      dailyPnl,
      totalPnl: pnlV2.totalPnl,
      realizedPnl: pnlV2.realizedPnl,
      unrealizedPnl: pnlV2.unrealizedPnl,
      weeklyStats: periodStats['weekly'],
      monthlyStats: periodStats['monthly'],
      yearlyStats: periodStats['yearly'],
      periodStats,
      timestamp: Date.now(),
      cached: false,
    };

    return result;
  }
}

// 导出单例
export const portfolioStatsService = new PortfolioStatsService();
