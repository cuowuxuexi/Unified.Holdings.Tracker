import { Router, Request, Response, NextFunction } from 'express';
import { container } from '../container';
import { fetchQuotes } from '../services/tencentApi';
import {
  calculateRealtimePnl,
  calculatePeriodStats,
  calculateNetDepositedCash,
  calculateTotalCommission,
  calculateLeverageCostByDay,
  calculateTotalDividendIncome,
  calculateTotalPnlV2,
  getWeekBasePrice,
  getMonthBasePrice,
  getYearBasePrice,
} from '../services/calculationService';
import { getExchangeRate } from '../services/currencyService';
import {
  Portfolio,
  Transaction,
  PortfolioDetail,
  Position,
  TransactionType,
  Asset,
  Market,
  LeverageInfo,
  Quote,
} from '../types';
import { parseISO, startOfYear } from 'date-fns';
import { correctHistoricalTransactionAmounts } from '../services/storage.prisma';
import { buildPositionsUsingLots } from '../services/portfolioReplay';
import {
  periodCacheService,
  PERIOD_CACHE_TTL,
  PeriodCacheBucket,
} from '@uht/infra/cache/period-cache-service';

const router = Router();

// Helper function to wrap async route handlers and catch errors
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Helper function to parse market from asset code
const getMarketFromCode = (code: string): Market | null => {
  const lowerCode = code.toLowerCase();
  if (lowerCode.startsWith('sh') || lowerCode.startsWith('sz'))
    return Market.CN;
  if (lowerCode.startsWith('hk')) return Market.HK;
  if (lowerCode.startsWith('us')) return Market.US;
  console.warn(
    `[getMarketFromCode] Could not determine market for code: ${code}. Returning null.`
  );
  return null;
};

// Helper Function: Calculate Base Positions
const calculateBasePositions = (transactions: Transaction[]): Position[] => {
  console.log('[calculateBasePositions] ========== 函数被调用 ==========');
  console.log(`[calculateBasePositions] 交易记录数量: ${transactions.length}`);

  const lotPositions = buildPositionsUsingLots(transactions);
  const positions: Position[] = [];

  for (const state of lotPositions.values()) {
    if (state.quantity <= 0) continue;

    const market = getMarketFromCode(state.assetCode);
    if (!market) {
      console.error(
        `[calculateBasePositions] Market became null unexpectedly for code: ${state.assetCode}`
      );
      continue;
    }

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
};

const extractAssetCodes = (transactions: Transaction[]): string[] => {
  const codes = new Set<string>();
  for (const tx of transactions) {
    if (
      (tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) &&
      tx.assetCode
    ) {
      codes.add(tx.assetCode);
    }
  }
  return Array.from(codes);
};

function preloadBasePrices(assetCodes: string[]) {
  const uniqueCodes = Array.from(new Set(assetCodes.filter(Boolean)));
  if (uniqueCodes.length === 0) {
    return;
  }
  const tasks = uniqueCodes.flatMap((code) => [
    getWeekBasePrice(code),
    getMonthBasePrice(code),
    getYearBasePrice(code),
  ]);

  Promise.all(tasks)
    .then(() =>
      console.log(
        `[preloadBasePrices] 已预加载 ${uniqueCodes.length} 个资产的基准价格`
      )
    )
    .catch((err) =>
      console.warn('[preloadBasePrices] 预加载基准价格失败:', err)
    );
}

// ========== 使用 Use Cases 的路由 ==========

// 注意：特定路径的路由必须在参数路由 (/:id) 之前定义

// GET /api/portfolio/correct-history - 触发历史交易金额修正和现金重算
router.get(
  '/correct-history',
  asyncHandler(async (req: Request, res: Response) => {
    console.log('[Route /correct-history] Received request.');
    await correctHistoricalTransactionAmounts();
    res.json({
      message:
        'Historical transaction amount correction initiated. Check backend logs for details.',
    });
  })
);

// GET /api/portfolio/exchange-rates - 获取主要货币对人民币的实时汇率
router.get(
  '/exchange-rates',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('[Route /exchange-rates] Received request.');
      const [usdRate, hkdRate] = await Promise.all([
        getExchangeRate('USD', 'CNY'),
        getExchangeRate('HKD', 'CNY'),
      ]);
      res.json({
        USD: usdRate,
        HKD: hkdRate,
        CNY: 1.0,
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Error fetching exchange rates:', error);
      if (
        error instanceof Error &&
        error.message &&
        (error.message.includes('10012') ||
          error.message.includes('超过每日可允许请求次数'))
      ) {
        console.warn('[Route /exchange-rates] Juhe API rate limit exceeded.');
        return res.status(503).json({
          message:
            'Exchange rate service unavailable (Rate limit exceeded). Please try again later.',
          error: true,
          USD: null,
          HKD: null,
          CNY: 1.0,
          updatedAt: new Date().toISOString(),
        });
      }
      next(error);
    }
  })
);

// GET /api/portfolio - 获取投资组合列表
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolios = await container.listPortfoliosUseCase.execute();
    const basicPortfolios = portfolios.map(({ id, name, cash }) => ({
      id,
      name,
      cash,
    }));
    res.json(basicPortfolios);
  })
);

// POST /api/portfolio - 创建新投资组合
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, cash, leverageInfo } = req.body as {
      name: string;
      cash: number;
      leverageInfo?: { totalCredit: number; interestRate: number };
    };

    // 验证输入
    if (
      !name ||
      typeof name !== 'string' ||
      cash === undefined ||
      typeof cash !== 'number' ||
      cash < 0
    ) {
      return res.status(400).json({
        message:
          'Invalid input data: name (string) and non-negative cash (number) are required.',
      });
    }

    if (
      leverageInfo &&
      (typeof leverageInfo.totalCredit !== 'number' ||
        typeof leverageInfo.interestRate !== 'number')
    ) {
      return res.status(400).json({
        message:
          'Invalid leverage format (requires totalCredit and interestRate as numbers).',
      });
    }

    // 调用 Use Case
    const newPortfolio = await container.createPortfolioUseCase.execute({
      name: name,
      initialCash: cash,
      leverage: leverageInfo
        ? {
            totalAmount: leverageInfo.totalCredit,
            costRate: leverageInfo.interestRate,
            usedAmount: 0,
            availableAmount: leverageInfo.totalCredit,
          }
        : undefined,
    });

    res.status(201).json(newPortfolio);
  })
);

// GET /api/portfolio/:id - 获取投资组合详情
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });

    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    const positions = calculateBasePositions(portfolio.transactions);
    const totalMarketValue = positions.reduce(
      (sum, pos) => sum + pos.quantity * pos.costPrice,
      0
    );
    const totalAssets = portfolio.cash + totalMarketValue;
    const netAssets = totalAssets - (portfolio.leverage?.usedAmount ?? 0);

    const totalCommission = await calculateTotalCommission(portfolio);
    console.log(
      `[Portfolio Stats Route] 计算得到手续费总和: ${totalCommission}`
    );

    let leverageCostLifetime = 0;
    if (portfolio.transactions && portfolio.transactions.length > 0) {
      const firstTxDate = portfolio.transactions.reduce((earliest, current) => {
        const currentTs = new Date(current.date);
        return currentTs < earliest ? currentTs : earliest;
      }, new Date(portfolio.transactions[0].date));
      leverageCostLifetime = calculateLeverageCostByDay(
        portfolio,
        firstTxDate,
        new Date()
      );
      console.log(
        `[Portfolio Detail Route] 计算得到整个生命周期融资成本: ${leverageCostLifetime}`
      );
    }

    const totalDividendIncome = calculateTotalDividendIncome(portfolio);
    console.log(
      `[Portfolio Stats Route] 计算得到总股息收入: ${totalDividendIncome}`
    );

    // 使用新的盈亏计算方法（已实现 + 未实现）
    const pnlV2 = await calculateTotalPnlV2(portfolio, positions);

    const portfolioDetail: PortfolioDetail = {
      id: portfolio.id,
      name: portfolio.name,
      cash: portfolio.cash,
      initialCash: portfolio.initialCash,
      leverage: portfolio.leverage,
      attentionInfo: portfolio.attentionInfo,
      transactions: portfolio.transactions,
      positions: positions,
      totalMarketValue: totalMarketValue,
      totalAssets: totalAssets,
      netAssets: netAssets,
      netDepositedCash: calculateNetDepositedCash(portfolio),
      totalCommission,
      leverageCost: leverageCostLifetime,
      dailyPnl: 0,
      totalPnl: pnlV2.totalPnl,
      realizedPnl: pnlV2.realizedPnl,
      unrealizedPnl: pnlV2.unrealizedPnl,
    };

    const assetCodes = extractAssetCodes(portfolio.transactions);
    preloadBasePrices(assetCodes);

    res.json(portfolioDetail);
  })
);

// DELETE /api/portfolio/:id - 删除投资组合
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    try {
      await container.getPortfolioRepository().delete(portfolioId);
      res.status(204).send();
    } catch (error) {
      console.error(`Error deleting portfolio ${portfolioId}:`, error);
      return res.status(404).json({ message: 'Portfolio not found' });
    }
  })
);

// GET /api/portfolio/:id/transactions - 获取交易记录
router.get(
  '/:id/transactions',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });

    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    res.json(portfolio.transactions);
  })
);

// POST /api/portfolio/:id/transactions - 添加交易记录
router.post(
  '/:id/transactions',
  asyncHandler(async (req: Request, res: Response) => {
    console.log(
      '[Backend Route] Received transaction request body:',
      JSON.stringify(req.body, null, 2)
    );
    console.log(
      `[POST /:id/transactions] Received request for portfolioId: ${req.params.id}`
    );

    const portfolioId = req.params.id;
    const transactionData = req.body as Omit<Transaction, 'id'>;

    const type = transactionData.type;
    const date = transactionData.date;
    const assetCode = transactionData.assetCode;
    const quantity = transactionData.quantity;
    const price = transactionData.price;
    const amount = transactionData.amount;

    // 基本验证
    if (!type || !date) {
      return res.status(400).json({
        message: 'Invalid transaction data. Required fields: type, date.',
      });
    }
    if (isNaN(Date.parse(date))) {
      return res
        .status(400)
        .json({ message: 'Invalid date format. Please use ISO 8601 format.' });
    }

    // 资产代码格式验证
    if (assetCode && !getMarketFromCode(assetCode)) {
      return res.status(400).json({
        message: `Invalid asset code format: ${assetCode}. Must start with sh, sz, hk, or us.`,
      });
    }

    // 类型特定验证
    if (type === TransactionType.BUY || type === TransactionType.SELL) {
      if (!assetCode || typeof assetCode !== 'string') {
        return res.status(400).json({
          message:
            'Invalid transaction data for BUY/SELL. Required field: assetCode (string).',
        });
      }
      if (
        quantity === undefined ||
        typeof quantity !== 'number' ||
        quantity <= 0
      ) {
        return res.status(400).json({
          message: 'Invalid quantity for BUY/SELL (must be positive number).',
        });
      }
      if (price === undefined || typeof price !== 'number' || price <= 0) {
        return res.status(400).json({
          message: 'Invalid price for BUY/SELL (must be positive number).',
        });
      }
    } else if (
      [
        TransactionType.DEPOSIT,
        TransactionType.WITHDRAW,
        TransactionType.LEVERAGE_ADD,
        TransactionType.LEVERAGE_REMOVE,
        TransactionType.LEVERAGE_COST,
        TransactionType.DIVIDEND,
      ].includes(type)
    ) {
      if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({
          message: `Invalid amount for ${type} transaction (must be positive number).`,
        });
      }
    } else {
      return res
        .status(400)
        .json({ message: `Unsupported transaction type: ${type}` });
    }

    // 🔄 自动推断币种（如果前端没有传递）
    if (!transactionData.currency && assetCode) {
      const lowerCode = assetCode.toLowerCase();
      if (lowerCode.startsWith('hk')) {
        transactionData.currency = 'HKD';
      } else if (lowerCode.startsWith('us')) {
        transactionData.currency = 'USD';
      } else {
        transactionData.currency = 'CNY';
      }
      console.log(
        `[POST /:id/transactions] Auto-inferred currency: ${transactionData.currency} for ${assetCode}`
      );
    }

    console.log(
      `[POST /:id/transactions] Passing data to Use Case:`,
      JSON.stringify(transactionData, null, 2)
    );

    try {
      // 调用 Use Case
      const updatedPortfolio = await container.addTransactionUseCase.execute({
        portfolioId,
        transaction: transactionData,
      });

      // 返回新添加的交易（最后一个）
      const newTransaction =
        updatedPortfolio.transactions[updatedPortfolio.transactions.length - 1];
      console.log(
        `[POST /:id/transactions] Use Case returned:`,
        JSON.stringify(newTransaction, null, 2)
      );

      res.status(201).json(newTransaction);
    } catch (error: any) {
      console.error(
        `Error adding transaction to portfolio ${portfolioId}:`,
        error
      );
      if (
        error.message &&
        (error.message.includes('Insufficient funds') ||
          error.message.includes('Insufficient shares'))
      ) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }
  })
);

// DELETE /api/portfolio/:id/transactions/:txId - 删除交易记录
router.delete(
  '/:id/transactions/:txId',
  asyncHandler(async (req: Request, res: Response) => {
    const { id: portfolioId, txId } = req.params;

    try {
      await container.removeTransactionUseCase.execute({
        portfolioId,
        transactionId: txId,
      });
      res.status(204).send();
    } catch (error: any) {
      console.error(
        `Error deleting transaction ${txId} from portfolio ${portfolioId}:`,
        error
      );
      return res
        .status(404)
        .json({ message: 'Portfolio or Transaction not found' });
    }
  })
);

// PATCH /api/portfolio/:id/transactions/:txId/notes - 更新交易备注
router.patch(
  '/:id/transactions/:txId/notes',
  asyncHandler(async (req: Request, res: Response) => {
    const { id: portfolioId, txId } = req.params;
    const { notes } = req.body;

    // 验证输入
    if (notes === undefined) {
      return res.status(400).json({
        message: 'notes field is required in request body',
      });
    }

    try {
      const updatedTransaction =
        await container.updateTransactionNotesUseCase.execute({
          portfolioId,
          transactionId: txId,
          notes: notes || '', // 允许空字符串
        });

      if (!updatedTransaction) {
        return res.status(404).json({
          message: 'Failed to update transaction notes',
        });
      }

      res.json(updatedTransaction);
    } catch (error: any) {
      console.error(
        `Error updating notes for transaction ${txId} in portfolio ${portfolioId}:`,
        error
      );
      return res.status(404).json({
        message: error.message || 'Portfolio or Transaction not found',
      });
    }
  })
);

// PATCH /api/portfolio/:id/attention - 更新投资组合注意信息
router.patch(
  '/:id/attention',
  asyncHandler(async (req: Request, res: Response) => {
    const { id: portfolioId } = req.params;
    const { attentionInfo } = req.body;

    // 验证输入
    if (attentionInfo === undefined) {
      return res.status(400).json({
        message: 'attentionInfo field is required in request body',
      });
    }

    try {
      const updatedPortfolio =
        await container.updatePortfolioAttentionUseCase.execute({
          portfolioId,
          attentionInfo: attentionInfo || '', // 允许空字符串
        });

      if (!updatedPortfolio) {
        return res.status(404).json({
          message: 'Failed to update portfolio attention info',
        });
      }

      // 只返回必要的字段
      res.json({
        id: updatedPortfolio.id,
        attentionInfo: updatedPortfolio.attentionInfo,
      });
    } catch (error: any) {
      console.error(
        `Error updating attention info for portfolio ${portfolioId}:`,
        error
      );
      return res.status(404).json({
        message: error.message || 'Portfolio not found',
      });
    }
  })
);

// ========== 复杂业务逻辑路由（暂时保持现有实现）==========

// GET /api/portfolio/:id/stats - 获取投资组合统计信息
router.get(
  '/:id/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const { startDate, endDate } = req.query;

    let start: Date;
    let end: Date;
    if (typeof startDate === 'string') {
      start = parseISO(startDate);
    } else {
      start = startOfYear(new Date());
    }
    if (typeof endDate === 'string') {
      end = parseISO(endDate);
    } else {
      end = new Date();
    }

    const rawPeriod = req.query.period as string | undefined;
    const allowedPeriods = ['total', 'daily', 'weekly', 'monthly', 'yearly'];
    const period:
      | 'total'
      | 'daily'
      | 'weekly'
      | 'monthly'
      | 'yearly'
      | undefined =
      rawPeriod && allowedPeriods.includes(rawPeriod)
        ? (rawPeriod as any)
        : 'total';

    // Step 1: 获取投资组合数据
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    console.log(
      `[DEBUG /stats ${portfolioId}] Fetched transactions:`,
      JSON.stringify(portfolio.transactions, null, 2)
    );

    // Step 2: 计算基础持仓
    const basePositions = calculateBasePositions(portfolio.transactions);
    console.log(
      `[DEBUG /stats ${portfolioId}] Calculated Base Positions:`,
      JSON.stringify(basePositions, null, 2)
    );

    // Step 3: 获取实时行情
    const assetCodes = basePositions.map((p) => p.asset.code);
    let quotesMap: Record<string, Quote> = {};
    if (assetCodes.length > 0) {
      const quotesArray = await fetchQuotes(assetCodes);
      quotesMap = quotesArray.reduce(
        (map, quote) => {
          map[quote.code] = quote;
          return map;
        },
        {} as Record<string, Quote>
      );
    }

    // Step 4: 计算实时盈亏
    const updatedPositions = calculateRealtimePnl(basePositions, quotesMap);
    console.log(
      `[DEBUG /stats ${portfolioId}] Positions after Realtime PnL:`,
      JSON.stringify(updatedPositions, null, 2)
    );

    // Step 5: 计算周期统计
    const statsOptions = { quotes: quotesMap };
    const bucket = periodCacheService.getPeriodStatsTimeBucket();
    const requestedPeriod = (period ?? 'total') as PeriodCacheBucket;

    type PeriodStatsResult = Awaited<
      ReturnType<typeof calculatePeriodStats>
    >;
    const statsPromiseMap: Partial<
      Record<PeriodCacheBucket, Promise<PeriodStatsResult>>
    > = {};

    const getCachedPeriodStats = (target: PeriodCacheBucket) => {
      if (!statsPromiseMap[target]) {
        const cacheKey = periodCacheService.getPeriodStatsCacheKey(
          portfolio.id,
          target,
          bucket
        );
        statsPromiseMap[target] = periodCacheService.rememberPeriodStats(
          cacheKey,
          PERIOD_CACHE_TTL.periodStats.ttl,
          () => calculatePeriodStats(portfolio, target, statsOptions)
        );
      }
      return statsPromiseMap[target]!;
    };

    const [periodStats, weeklyStats, monthlyStats, yearlyStats] =
      await Promise.all([
        getCachedPeriodStats(requestedPeriod),
        getCachedPeriodStats('weekly'),
        getCachedPeriodStats('monthly'),
        getCachedPeriodStats('yearly'),
      ]);

    // Step 6: 整合结果
    let totalMarketValueInCNY = 0;
    let dailyPnlInCNY = 0;

    for (const pos of updatedPositions) {
      totalMarketValueInCNY += pos.marketValue ?? pos.marketValueCNY ?? 0;
      dailyPnlInCNY += pos.dailyChange ?? 0;
    }

    const totalAssets = portfolio.cash + totalMarketValueInCNY;
    const netAssets = totalAssets - (portfolio.leverage?.usedAmount ?? 0);

    const totalCommission = await calculateTotalCommission(portfolio);
    console.log(
      `[Portfolio Stats Route] 计算得到手续费总和: ${totalCommission}`
    );

    let leverageCostLifetimeStats = 0;
    if (portfolio.transactions && portfolio.transactions.length > 0) {
      const firstTxDateStats = portfolio.transactions.reduce(
        (earliest, current) => {
          const currentTs = new Date(current.date);
          return currentTs < earliest ? currentTs : earliest;
        },
        new Date(portfolio.transactions[0].date)
      );
      leverageCostLifetimeStats = calculateLeverageCostByDay(
        portfolio,
        firstTxDateStats,
        new Date()
      );
      console.log(
        `[Portfolio Stats Route] 计算得到整个生命周期融资成本: ${leverageCostLifetimeStats}`
      );
    }

    const totalDividendIncome = calculateTotalDividendIncome(portfolio);
    console.log(
      `[Portfolio Stats Route] 计算得到总股息收入: ${totalDividendIncome}`
    );

    // 使用新的盈亏计算方法（已实现 + 未实现）
    const pnlV2 = await calculateTotalPnlV2(portfolio, updatedPositions);

    const response = {
      portfolioId: portfolio.id,
      name: portfolio.name,
      cash: portfolio.cash,
      leverage: portfolio.leverage,
      totalMarketValue: totalMarketValueInCNY,
      totalAssets: totalAssets,
      netAssets: netAssets,
      netDepositedCash: calculateNetDepositedCash(portfolio),
      totalCommission,
      leverageCost: leverageCostLifetimeStats,
      totalDividendIncome,
      dailyPnl: dailyPnlInCNY,
      totalPnl: pnlV2.totalPnl,
      realizedPnl: pnlV2.realizedPnl,
      unrealizedPnl: pnlV2.unrealizedPnl,
      periodReturnPercent: periodStats.periodReturnPercent,
      weeklyStats,
      monthlyStats,
      yearlyStats,
      positions: updatedPositions,
      timestamp: Date.now(),
    };

    console.log(
      `[Portfolio Stats Route] 最终返回数据中的totalCommission: ${response.totalCommission}`
    );
    res.json(response);
  })
);

// GET /api/portfolio/:id/cash-recalc - 现金重算校验
router.get(
  '/:id/cash-recalc',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;

    try {
      const updatedPortfolio =
        await container.recalculatePortfolioCashUseCase.execute({
          portfolioId,
        });

      // 注意：当前 Use Case 只返回 Portfolio，但路由需要更多信息
      // 这里需要调整，暂时使用旧的实现方式
      const portfolio = await container.getPortfolioUseCase.execute({
        portfolioId,
      });
      if (!portfolio) {
        return res.status(404).json({ message: 'Portfolio not found' });
      }

      // 导入旧的 cash recalculate 函数来获取详细信息
      const { cashRecalculateForPortfolioAsync } = await import(
        '../services/storage.prisma'
      );
      const result = await cashRecalculateForPortfolioAsync(portfolio);

      res.json({
        portfolioId: portfolio.id,
        name: portfolio.name,
        currentCash: portfolio.cash,
        recalculatedCash: result.cash,
        diff: result.diff,
        steps: result.steps,
      });
    } catch (error) {
      console.error(
        `Error recalculating cash for portfolio ${portfolioId}:`,
        error
      );
      return res.status(404).json({ message: 'Portfolio not found' });
    }
  })
);

// GET /api/portfolio/:id/export/markdown - 导出 Markdown 报表
router.get(
  '/:id/export/markdown',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;

    try {
      console.log(
        `[GET /:id/export/markdown] Generating markdown report for portfolio ${portfolioId}`
      );

      // 获取投资组合详情
      const portfolio = await container.getPortfolioUseCase.execute({
        portfolioId,
      });

      if (!portfolio) {
        return res.status(404).json({ message: 'Portfolio not found' });
      }

      // 获取所有资产代码
      const assetCodes = Array.from(
        new Set(
          portfolio.transactions
            .filter(
              (tx) =>
                (tx.type === TransactionType.BUY ||
                  tx.type === TransactionType.SELL) &&
                tx.assetCode
            )
            .map((tx) => tx.assetCode as string)
        )
      );

      // 获取行情数据
      let quotes: Record<string, Quote> = {};
      if (assetCodes.length > 0) {
        const quotesArray = await fetchQuotes(assetCodes);
        quotes = quotesArray.reduce(
          (acc, quote) => {
            acc[quote.code] = quote;
            return acc;
          },
          {} as Record<string, Quote>
        );
      }

      // 计算持仓（含实时盈亏）
      const basePositions = calculateBasePositions(portfolio.transactions);
      const positions = calculateRealtimePnl(basePositions, quotes);

      // 使用与统计接口一致的逻辑计算关键指标，确保导出报表与前端展示一致
      const netDeposit = calculateNetDepositedCash(portfolio);
      const totalCommission = await calculateTotalCommission(portfolio);

      // 计算整个生命周期融资成本（与 /stats、详情接口保持一致）
      let leverageCost = 0;
      if (portfolio.transactions && portfolio.transactions.length > 0) {
        const firstTxDate = portfolio.transactions.reduce(
          (earliest, current) => {
            const currentTs = new Date(current.date);
            return currentTs < earliest ? currentTs : earliest;
          },
          new Date(portfolio.transactions[0].date)
        );
        leverageCost = calculateLeverageCostByDay(
          portfolio,
          firstTxDate,
          new Date()
        );
      }

      // 计算总市值和当日盈亏（统一折算为 CNY）
      let totalMarketValue = 0;
      let dailyPnl = 0;
      for (const pos of positions) {
        totalMarketValue += pos.marketValue ?? pos.marketValueCNY ?? 0;
        dailyPnl += pos.dailyChange ?? 0;
      }

      const totalAssets = Number(portfolio.cash) + totalMarketValue;
      const netAssets =
        totalAssets - Number(portfolio.leverage.usedAmount || 0);

      // 使用统一的盈亏计算方法（已实现 + 未实现），保持与前端统计卡片一致
      const pnlV2 = await calculateTotalPnlV2(portfolio, positions);
      const totalReturnPercent =
        netDeposit > 0 ? (pnlV2.totalPnl / netDeposit) * 100 : 0;

      // 构建 PortfolioDetail（字段含义与 /portfolio/:id、/portfolio/:id/stats 对齐）
      const portfolioDetail: PortfolioDetail = {
        ...portfolio,
        positions,
        totalMarketValue,
        totalPnl: pnlV2.totalPnl,
        totalAssets,
        netAssets,
        netDepositedCash: netDeposit,
        totalCommission,
        leverageCost,
        dailyPnl,
        totalPnlPercent: totalReturnPercent,
        realizedPnl: pnlV2.realizedPnl,
        unrealizedPnl: pnlV2.unrealizedPnl,
      };

      // 导入 reportService
      const { reportService } = await import('../services/reportService');

      // 生成 Markdown
      const markdown = await reportService.generateMarkdownReport(
        portfolioDetail,
        true
      );

      // 设置响应头
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:T.]/g, '')
        .slice(0, 14);
      const filename = `投资组合报表_${portfolio.name}_${timestamp}.md`;

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );

      res.send(markdown);
      console.log(
        `[GET /:id/export/markdown] Successfully generated markdown report for ${portfolioId}`
      );
    } catch (error) {
      console.error(
        `Error generating markdown report for portfolio ${portfolioId}:`,
        error
      );
      return res
        .status(500)
        .json({ message: 'Failed to generate markdown report' });
    }
  })
);

export default router;
