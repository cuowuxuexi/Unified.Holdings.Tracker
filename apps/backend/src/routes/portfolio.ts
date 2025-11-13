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
} from '../services/calculationService';
import {
  getExchangeRateForAssetToCNY,
  getExchangeRate,
} from '../services/currencyService';
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
  
  // 按日期升序排序，确保先买后卖的顺序正确
  const sortedTransactions = [...transactions].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  const positionsMap: Map<
    string,
    {
      quantity: number;
      totalCost: number;
      assetCode: string;
      transactions: Transaction[];
    }
  > = new Map();

  sortedTransactions.forEach((tx) => {
    if (
      (tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) &&
      tx.assetCode
    ) {
      const market = getMarketFromCode(tx.assetCode);
      if (!market) {
        console.warn(
          `[calculateBasePositions] Skipping transaction with invalid asset code: ${tx.assetCode}`
        );
        return;
      }

      if (!positionsMap.has(tx.assetCode)) {
        positionsMap.set(tx.assetCode, {
          quantity: 0,
          totalCost: 0,
          assetCode: tx.assetCode,
          transactions: [],
        });
      }
      const pos = positionsMap.get(tx.assetCode)!;
      pos.transactions.push(tx);

      const quantity = tx.quantity ? Number(tx.quantity) : 0;
      const price = tx.price ? Number(tx.price) : 0;
      const transactionAmount = quantity * price;

      // DEBUG: 追踪关键股票
      if (tx.assetCode === 'hk09988' || tx.assetCode === 'sz300251') {
        console.log(`[calculateBasePositions] ${tx.assetCode} ${tx.type}:`, {
          'tx.quantity': tx.quantity,
          'tx.quantity typeof': typeof tx.quantity,
          'quantity (Number后)': quantity,
          'quantity typeof': typeof quantity,
          '当前持仓': pos.quantity,
        });
      }

      if (tx.type === TransactionType.BUY) {
        pos.quantity += quantity;
        pos.totalCost += transactionAmount;
        if (tx.assetCode === 'hk09988' || tx.assetCode === 'sz300251') {
          console.log(`  [BUY后] 持仓: ${pos.quantity}`);
        }
      } else if (tx.type === TransactionType.SELL) {
        pos.quantity -= quantity;
        pos.totalCost -= transactionAmount;
        if (tx.assetCode === 'hk09988' || tx.assetCode === 'sz300251') {
          console.log(`  [SELL后] 持仓: ${pos.quantity}`);
        }

        if (pos.quantity < 0) {
          console.warn(
            `Overselling detected for ${tx.assetCode}. Quantity adjusted to 0.`
          );
          pos.quantity = 0;
        }
      }
    }
  });

  const positions: Position[] = [];
  for (const data of positionsMap.values()) {
    if (data.quantity <= 0) continue;

    const market = getMarketFromCode(data.assetCode);
    if (!market) {
      console.error(
        `[calculateBasePositions] Market became null unexpectedly for code: ${data.assetCode}`
      );
      continue;
    }

    const asset: Asset = {
      code: data.assetCode,
      market: market,
      name: data.assetCode,
    };

    const costPrice = data.quantity > 0 ? data.totalCost / data.quantity : 0;

    positions.push({
      asset: asset,
      quantity: data.quantity,
      costPrice: costPrice,
      totalCost: data.totalCost,
      marketValue: 0,
      currentPrice: 0,
      dailyChange: 0,
      totalPnl: 0,
    });
  }
  return positions;
};

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
      return res
        .status(400)
        .json({
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
      const updatedTransaction = await container.updateTransactionNotesUseCase.execute({
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
      const updatedPortfolio = await container.updatePortfolioAttentionUseCase.execute({
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
    const periodStats = await calculatePeriodStats(portfolio, period);
    const [weeklyStats, monthlyStats, yearlyStats] = await Promise.all([
      calculatePeriodStats(portfolio, 'weekly'),
      calculatePeriodStats(portfolio, 'monthly'),
      calculatePeriodStats(portfolio, 'yearly'),
    ]);

    // Step 6: 整合结果
    let totalMarketValueInCNY = 0;
    let dailyPnlInCNY = 0;

    for (const pos of updatedPositions) {
      let exchangeRate = 1;
      if (pos.asset.market !== Market.CN) {
        try {
          exchangeRate = await getExchangeRateForAssetToCNY(pos.asset.code);
        } catch (rateError) {
          console.error(
            `[Stats Calc] Failed to get exchange rate for ${pos.asset.code}, using 1. Error:`,
            rateError
          );
        }
      }
      totalMarketValueInCNY += (pos.marketValue ?? 0) * exchangeRate;
      dailyPnlInCNY += (pos.dailyChange ?? 0) * exchangeRate;
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

      // 计算持仓
      const basePositions = calculateBasePositions(portfolio.transactions);
      const positions = calculateRealtimePnl(basePositions, quotes);

      // 计算统计数据
      const netDeposit = calculateNetDepositedCash(portfolio);
      const totalCommission = await calculateTotalCommission(portfolio);
      const startOfYearDate = startOfYear(new Date());
      const leverageCost = calculateLeverageCostByDay(
        portfolio,
        startOfYearDate,
        new Date()
      );
      const totalDividend = calculateTotalDividendIncome(portfolio);

      const totalMarketValue = positions.reduce(
        (sum, pos) => sum + (pos.marketValue || 0),
        0
      );
      const totalPnl = positions.reduce(
        (sum, pos) => sum + (pos.totalPnl || 0),
        0
      );
      const totalAssets =
        Number(portfolio.cash) +
        totalMarketValue +
        Number(portfolio.leverage.usedAmount || 0);
      const netAssets =
        Number(portfolio.cash) +
        totalMarketValue -
        Number(portfolio.leverage.usedAmount || 0);

      const totalReturnPercent =
        netDeposit > 0 ? (totalPnl / netDeposit) * 100 : 0;

      // 构建 PortfolioDetail
      const portfolioDetail: PortfolioDetail = {
        ...portfolio,
        positions,
        totalMarketValue,
        totalPnl,
        totalAssets,
        netAssets,
        netDepositedCash: netDeposit,
        totalCommission,
        leverageCost,
        dailyPnl: 0, // 简化处理，报表中可能不需要精确值
        totalPnlPercent: totalReturnPercent,
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
