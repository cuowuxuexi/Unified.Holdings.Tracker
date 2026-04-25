import { Router, Request, Response, NextFunction } from 'express';
import { container } from '../container';
import {
  getExchangeRate,
  getExchangeRateInfo,
} from '../services/currencyService';
import {
  Transaction,
  PortfolioDetail,
  TransactionType,
  Market,
} from '../types';
import { correctHistoricalTransactionAmounts } from '../services/storage.prisma';
import { prisma } from '../lib/prisma';
import { portfolioStatsService } from '../services/portfolioStatsService';
import { PeriodCacheBucket } from '@uht/infra/cache/period-cache-service';
import { periodReportService } from '../services/periodReportService';
import { fetchQuotes } from '../services/tencentApi';

const router = Router();

type ApiContractWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
type ApiContractError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function wantsEnvelope(req: Request): boolean {
  const value = queryString(req.query.envelope);
  return value === 'true' || value === '1' || value === 'yes';
}

function makeEnvelope<T>(
  data: T | null,
  meta: Record<string, unknown>,
  warnings: ApiContractWarning[] = [],
  errors: ApiContractError[] = []
) {
  return {
    data,
    meta: { source: 'uht', generated_at: new Date().toISOString(), ...meta },
    warnings,
    errors,
  };
}

function sendContractError(
  res: Response,
  statusCode: number,
  envelope: boolean,
  message: string,
  errors: ApiContractError[],
  meta: Record<string, unknown> = {}
): void {
  res.status(statusCode).json(
    envelope
      ? makeEnvelope(null, meta, [], errors)
      : {
          error: message,
          message,
          errors,
        }
  );
}

function queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
  return (
    prisma.$queryRawUnsafe as (
      query: string,
      ...values: unknown[]
    ) => Promise<T>
  )(query, ...values);
}

async function fillAssetNameAsync(assetCode: string): Promise<void> {
  try {
    const normalizedCode = assetCode.trim();
    if (!normalizedCode) {
      return;
    }

    const quotes = await fetchQuotes([normalizedCode]);
    const quote =
      quotes.find((item) => item.code === normalizedCode) ?? quotes[0];
    const assetName = quote?.name?.trim();

    if (!assetName || assetName === normalizedCode) {
      console.warn(
        `[AssetNameFill] Skip update due to empty/equal name: code=${normalizedCode}, name=${assetName ?? 'N/A'}`
      );
      return;
    }

    const result = await prisma.asset.updateMany({
      where: {
        code: normalizedCode,
        OR: [{ name: normalizedCode }, { name: '' }],
      },
      data: {
        name: assetName,
      },
    });

    if (result.count > 0) {
      console.log(
        `[AssetNameFill] Updated asset name: code=${normalizedCode}, name=${assetName}`
      );
    }
  } catch (error) {
    console.warn(`[AssetNameFill] Failed: code=${assetCode}`, error);
  }
}

// Helper function to wrap async route handlers and catch errors
const asyncHandler =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

const PERIOD_SHORTCUTS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

type PeriodShortcut = (typeof PERIOD_SHORTCUTS)[number];

type NormalizedPeriodReportQuery = {
  from: string;
  to: string;
  format?: string;
  periodType: PeriodShortcut | 'custom';
};

function isPeriodShortcut(value: string): value is PeriodShortcut {
  return PERIOD_SHORTCUTS.includes(value as PeriodShortcut);
}

type PeriodReportQueryValidation =
  | { ok: true; value: NormalizedPeriodReportQuery }
  | { ok: false; message: string; errors: ApiContractError[] };

function normalizePeriodReportQuery(
  query: Request['query']
): PeriodReportQueryValidation {
  const { from: rawFrom, to: rawTo, format: rawFormat, period } = query;

  let from: string | undefined = queryString(rawFrom);
  let to: string | undefined = queryString(rawTo);
  const periodValue = queryString(period);
  const format = queryString(rawFormat);
  let periodType: PeriodShortcut | 'custom' = 'custom';

  if (periodValue) {
    if (!isPeriodShortcut(periodValue)) {
      return {
        ok: false,
        message:
          'Query parameter period must be one of: daily|weekly|monthly|yearly',
        errors: [
          {
            code: 'invalid_period',
            message:
              'Query parameter period must be one of: daily|weekly|monthly|yearly',
            details: { period: periodValue },
          },
        ],
      };
    }

    periodType = periodValue;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (!to) to = todayStr;

    if (!from) {
      switch (periodValue) {
        case 'daily': {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          from = yesterday.toISOString().slice(0, 10);
          break;
        }
        case 'weekly': {
          const monday = new Date(now);
          const day = monday.getDay();
          const diff = day === 0 ? 6 : day - 1;
          monday.setDate(monday.getDate() - diff);
          from = monday.toISOString().slice(0, 10);
          break;
        }
        case 'monthly':
          from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          break;
        case 'yearly':
          from = `${now.getFullYear()}-01-01`;
          break;
      }
    }
  }

  if (format && format !== 'json' && format !== 'markdown') {
    return {
      ok: false,
      message: 'Query parameter format must be json or markdown',
      errors: [
        {
          code: 'invalid_format',
          message: 'Query parameter format must be json or markdown',
          details: { format },
        },
      ],
    };
  }

  if (!from || !to) {
    return {
      ok: false,
      message:
        'Query parameters from and to are required (YYYY-MM-DD), or use period=daily|weekly|monthly|yearly',
      errors: [
        {
          code: 'missing_date_range',
          message:
            'Query parameters from and to are required unless a valid period shortcut is provided.',
        },
      ],
    };
  }

  const invalidDateErrors: ApiContractError[] = [];
  if (!isValidDateOnly(from)) {
    invalidDateErrors.push({
      code: 'invalid_date',
      message:
        'Query parameter from must be a real calendar date in YYYY-MM-DD format.',
      details: { from },
    });
  }
  if (!isValidDateOnly(to)) {
    invalidDateErrors.push({
      code: 'invalid_date',
      message:
        'Query parameter to must be a real calendar date in YYYY-MM-DD format.',
      details: { to },
    });
  }
  if (invalidDateErrors.length > 0) {
    return {
      ok: false,
      message:
        'Query parameters from/to must be real YYYY-MM-DD calendar dates',
      errors: invalidDateErrors,
    };
  }

  if (from > to) {
    return {
      ok: false,
      message: 'Query parameter from must be earlier than or equal to to',
      errors: [
        {
          code: 'invalid_date_range',
          message: 'Query parameter from must be earlier than or equal to to.',
          details: { from, to },
        },
      ],
    };
  }

  return {
    ok: true,
    value: {
      from,
      to,
      format: format || undefined,
      periodType,
    },
  };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function resolveLegacyPeriodReportPortfolioId(
  query: Request['query'],
  from: string,
  to: string
): Promise<
  | { portfolioId: string }
  | {
      statusCode: 400 | 404;
      body: Record<string, unknown>;
    }
> {
  const explicitPortfolioId =
    typeof query.portfolioId === 'string'
      ? query.portfolioId
      : typeof query.id === 'string'
        ? query.id
        : undefined;

  if (explicitPortfolioId) {
    return { portfolioId: explicitPortfolioId };
  }

  const portfolios = await container.listPortfoliosUseCase.execute();
  if (portfolios.length === 0) {
    return {
      statusCode: 404,
      body: {
        message: 'No portfolio found',
      },
    };
  }

  if (portfolios.length === 1) {
    return { portfolioId: portfolios[0].id };
  }

  const snapshotCandidates = await prisma.portfolioSnapshot.findMany({
    where: {
      portfolioId: {
        in: portfolios.map(({ id }) => id),
      },
      date: {
        gte: from,
        lte: to,
      },
    },
    select: {
      portfolioId: true,
    },
    distinct: ['portfolioId'],
  });

  if (snapshotCandidates.length === 1) {
    return { portfolioId: snapshotCandidates[0].portfolioId };
  }

  return {
    statusCode: 400,
    body: {
      message:
        'Query parameter portfolioId is required when multiple portfolios match the requested report period',
      from,
      to,
      candidates: portfolios.map(({ id, name }) => ({ id, name })),
    },
  };
}

async function sendPeriodReport(
  res: Response,
  portfolioId: string,
  query: NormalizedPeriodReportQuery,
  routeLabel: string,
  envelope: boolean
): Promise<void> {
  console.log(
    `[GET ${routeLabel}] Generating ${query.periodType} report for portfolio ${portfolioId} from ${query.from} to ${query.to}`
  );

  const report = await periodReportService.getPeriodReport(
    portfolioId,
    query.from,
    query.to,
    query.periodType
  );

  if (query.format === 'markdown') {
    const md = periodReportService.formatReportAsMarkdown(report);
    res.type('text/markdown').send(md);
    return;
  }

  if (envelope) {
    res.json(
      makeEnvelope(report, {
        portfolioId,
        requested_from: query.from,
        requested_to: query.to,
        period: query.periodType,
        source: 'uht.period-report',
      })
    );
    return;
  }

  res.json(report);
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

      const rateInfoList = [
        getExchangeRateInfo('USD-CNY'),
        getExchangeRateInfo('HKD-CNY'),
      ];
      let latestRateTimestampMs: number | null = null;
      for (const rateInfo of rateInfoList) {
        if (!rateInfo?.timestamp) {
          continue;
        }
        const timestampMs = new Date(rateInfo.timestamp).getTime();
        if (Number.isNaN(timestampMs)) {
          continue;
        }
        latestRateTimestampMs =
          latestRateTimestampMs === null
            ? timestampMs
            : Math.max(latestRateTimestampMs, timestampMs);
      }

      const exchangeRatePayload = {
        USD: usdRate,
        HKD: hkdRate,
        CNY: 1.0,
        updatedAt:
          latestRateTimestampMs === null
            ? new Date().toISOString()
            : new Date(latestRateTimestampMs).toISOString(),
      };

      if (wantsEnvelope(req)) {
        res.json(
          makeEnvelope(exchangeRatePayload, {
            source: 'uht.exchange-rates',
            requested_pairs: ['USD-CNY', 'HKD-CNY'],
          })
        );
        return;
      }

      res.json(exchangeRatePayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Error fetching exchange rates:', error);
      if (
        error instanceof Error &&
        error.message &&
        (error.message.includes('10012') ||
          error.message.includes('超过每日可允许请求次数'))
      ) {
        console.warn('[Route /exchange-rates] Juhe API rate limit exceeded.');
        const exchangeRateErrorPayload = {
          message:
            'Exchange rate service unavailable (Rate limit exceeded). Please try again later.',
          error: true,
          USD: null,
          HKD: null,
          CNY: 1.0,
          updatedAt: new Date().toISOString(),
        };

        if (wantsEnvelope(req)) {
          return res.status(503).json(
            makeEnvelope(
              exchangeRateErrorPayload,
              {
                source: 'uht.exchange-rates',
                requested_pairs: ['USD-CNY', 'HKD-CNY'],
              },
              [],
              [
                {
                  code: 'exchange_rate_rate_limited',
                  message:
                    'Exchange rate service unavailable (rate limit exceeded).',
                },
              ]
            )
          );
        }

        return res.status(503).json(exchangeRateErrorPayload);
      }
      next(error);
    }
  })
);

// GET /api/portfolio/period-report - 旧版兼容入口（优先传 portfolioId）
router.get(
  '/period-report',
  asyncHandler(async (req: Request, res: Response) => {
    const envelope = wantsEnvelope(req);
    const reportQueryResult = normalizePeriodReportQuery(req.query);
    if (!reportQueryResult.ok) {
      return sendContractError(
        res,
        400,
        envelope,
        reportQueryResult.message,
        reportQueryResult.errors
      );
    }

    const reportQuery = reportQueryResult.value;
    if (envelope && reportQuery.format === 'markdown') {
      return sendContractError(
        res,
        400,
        envelope,
        'Query parameter envelope cannot be combined with format=markdown',
        [
          {
            code: 'invalid_envelope_format',
            message:
              'Query parameter envelope cannot be combined with format=markdown.',
          },
        ]
      );
    }

    const resolution = await resolveLegacyPeriodReportPortfolioId(
      req.query,
      reportQuery.from,
      reportQuery.to
    );

    if ('statusCode' in resolution) {
      return res.status(resolution.statusCode).json(resolution.body);
    }

    res.setHeader('X-UHT-Resolved-Portfolio-Id', resolution.portfolioId);

    try {
      await sendPeriodReport(
        res,
        resolution.portfolioId,
        reportQuery,
        '/period-report',
        envelope
      );
    } catch (error) {
      console.error(
        `Error generating legacy period report for portfolio ${resolution.portfolioId}:`,
        error
      );
      res.status(500).json({
        message: 'Failed to generate period report',
        error: String(error),
      });
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

    const stats = await portfolioStatsService.getFullStats(portfolio, {
      includePeriods: ['total', 'weekly', 'monthly', 'yearly'],
      includeQuotes: true,
    });

    const portfolioDetail: PortfolioDetail = {
      id: portfolio.id,
      name: portfolio.name,
      cash: portfolio.cash,
      initialCash: portfolio.initialCash,
      leverage: portfolio.leverage,
      attentionInfo: portfolio.attentionInfo,
      transactions: portfolio.transactions,
      positions: stats.positions,
      totalMarketValue: stats.totalMarketValue,
      totalAssets: stats.totalAssets,
      netAssets: stats.netAssets,
      netDepositedCash: stats.netDepositedCash,
      totalCommission: stats.totalCommission,
      leverageCost: stats.leverageCost,
      dailyPnl: stats.dailyPnl,
      totalPnl: stats.totalPnl,
      realizedPnl: stats.realizedPnl,
      unrealizedPnl: stats.unrealizedPnl,
      weeklyStats: stats.weeklyStats,
      monthlyStats: stats.monthlyStats,
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
      portfolioStatsService.clearCache(portfolioId);
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

      portfolioStatsService.clearCache(portfolioId);
      res.status(201).json(newTransaction);

      if (newTransaction?.assetCode) {
        setImmediate(() => {
          void fillAssetNameAsync(newTransaction.assetCode as string);
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      portfolioStatsService.clearCache(portfolioId);
      res.status(204).send();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// GET /api/portfolio/:id/stats/historical - 获取指定日期的历史统计快照
router.get(
  '/:id/stats/historical',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const date =
      typeof req.query.date === 'string' ? req.query.date.trim() : '';

    if (!date) {
      return res.status(400).json({
        message: 'Query parameter date is required in YYYY-MM-DD format.',
      });
    }

    if (!isValidDateOnly(date)) {
      return res.status(400).json({
        message: 'Query parameter date must be a valid YYYY-MM-DD date.',
      });
    }

    try {
      const { getHistoricalStats } = await import(
        '../services/historicalStatsService'
      );
      const stats = await getHistoricalStats(portfolioId, date);
      res.json(stats);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'HistoricalStatsNotFoundError'
      ) {
        return res.status(404).json({
          message: error.message,
          portfolioId,
          date,
        });
      }
      throw error;
    }
  })
);

// GET /api/portfolio/:id/stats - 获取投资组合统计信息
router.get(
  '/:id/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const rawPeriod = req.query.period as string | undefined;
    const allowedPeriods: PeriodCacheBucket[] = [
      'total',
      'daily',
      'weekly',
      'monthly',
      'yearly',
    ];
    const period: PeriodCacheBucket = allowedPeriods.includes(
      rawPeriod as PeriodCacheBucket
    )
      ? (rawPeriod as PeriodCacheBucket)
      : 'total';

    // Step 1: 获取投资组合数据
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    const includePeriods = new Set<PeriodCacheBucket>([
      'weekly',
      'monthly',
      'yearly',
    ]);
    includePeriods.add(period);

    const stats = await portfolioStatsService.getFullStats(portfolio, {
      includePeriods: Array.from(includePeriods),
      includeQuotes: true,
    });

    const periodStats = stats.periodStats?.[period];

    const response = {
      portfolioId: stats.portfolioId,
      name: stats.name,
      cash: stats.cash,
      leverage: stats.leverage,
      totalMarketValue: stats.totalMarketValue,
      totalAssets: stats.totalAssets,
      netAssets: stats.netAssets,
      netDepositedCash: stats.netDepositedCash,
      totalCommission: stats.totalCommission,
      leverageCost: stats.leverageCost,
      totalDividendIncome: stats.totalDividendIncome,
      dailyPnl: stats.dailyPnl,
      totalPnl: stats.totalPnl,
      realizedPnl: stats.realizedPnl,
      unrealizedPnl: stats.unrealizedPnl,
      periodReturnPercent: periodStats?.periodReturnPercent ?? null,
      weeklyStats: stats.weeklyStats,
      monthlyStats: stats.monthlyStats,
      yearlyStats: stats.yearlyStats,
      positions: stats.positions,
      timestamp: stats.timestamp,
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

// GET /api/portfolio/:id/snapshot-enabled - 获取快照开关状态
router.get(
  '/:id/snapshot-enabled',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
      select: { snapshotEnabled: true },
    });
    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }
    res.json({ snapshotEnabled: portfolio.snapshotEnabled });
  })
);

// PATCH /api/portfolio/:id/snapshot-enabled - 切换快照开关
router.patch(
  '/:id/snapshot-enabled',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const { snapshotEnabled } = req.body;

    if (typeof snapshotEnabled !== 'boolean') {
      return res
        .status(400)
        .json({ message: 'snapshotEnabled must be a boolean' });
    }

    try {
      const updated = await prisma.portfolio.update({
        where: { id: portfolioId },
        data: { snapshotEnabled },
        select: { id: true, snapshotEnabled: true },
      });
      console.log(
        `[Portfolio] Snapshot ${snapshotEnabled ? 'enabled' : 'disabled'} for ${portfolioId}`
      );
      res.json(updated);
    } catch (error) {
      console.error(
        `Error updating snapshot-enabled for portfolio ${portfolioId}:`,
        error
      );
      return res.status(404).json({ message: 'Portfolio not found' });
    }
  })
);

// GET /api/portfolio/:id/period-report - 期间报表（日/周/月/季/年通用）
router.get(
  '/:id/period-report',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const envelope = wantsEnvelope(req);
    const reportQueryResult = normalizePeriodReportQuery(req.query);
    if (!reportQueryResult.ok) {
      return sendContractError(
        res,
        400,
        envelope,
        reportQueryResult.message,
        reportQueryResult.errors
      );
    }

    const reportQuery = reportQueryResult.value;
    if (envelope && reportQuery.format === 'markdown') {
      return sendContractError(
        res,
        400,
        envelope,
        'Query parameter envelope cannot be combined with format=markdown',
        [
          {
            code: 'invalid_envelope_format',
            message:
              'Query parameter envelope cannot be combined with format=markdown.',
          },
        ]
      );
    }

    try {
      await sendPeriodReport(
        res,
        portfolioId,
        reportQuery,
        '/:id/period-report',
        envelope
      );
    } catch (error) {
      console.error(
        `Error generating period report for portfolio ${portfolioId}:`,
        error
      );
      res.status(500).json({
        message: 'Failed to generate period report',
        error: String(error),
      });
    }
  })
);

// GET /api/portfolio/:id/export - 导出组合结构化数据（JSON）
router.get(
  '/:id/export',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;

    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });

    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    const stats = await portfolioStatsService.getFullStats(portfolio, {
      includePeriods: ['total', 'weekly', 'monthly', 'yearly'],
      includeQuotes: true,
    });

    const netDeposit = stats.netDepositedCash;

    const portfolioDetail: PortfolioDetail = {
      ...portfolio,
      positions: stats.positions,
      totalMarketValue: stats.totalMarketValue,
      totalPnl: stats.totalPnl,
      totalAssets: stats.totalAssets,
      netAssets: stats.netAssets,
      netDepositedCash: netDeposit,
      totalCommission: stats.totalCommission,
      leverageCost: stats.leverageCost,
      dailyPnl: stats.dailyPnl,
      totalPnlPercent: netDeposit > 0 ? (stats.totalPnl / netDeposit) * 100 : 0,
      realizedPnl: stats.realizedPnl,
      unrealizedPnl: stats.unrealizedPnl,
      weeklyStats: stats.weeklyStats,
      monthlyStats: stats.monthlyStats,
      yearlyStats: stats.yearlyStats,
    };

    res.json(portfolioDetail);
  })
);

// GET /api/portfolio/:id/snapshots - 查询组合快照
router.get(
  '/:id/snapshots',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const { getSnapshots } = await import('../services/snapshotService');
    const snapshots = await getSnapshots(portfolioId, from, to);
    res.json(snapshots);
  })
);

// GET /api/portfolio/:id/weekly-report - 获取周报数据
router.get(
  '/:id/weekly-report',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const week = req.query.week as string | undefined;

    const { getWeeklyReport } = await import('../services/snapshotService');
    const report = await getWeeklyReport(portfolioId, week);
    res.json(report);
  })
);

// POST /api/portfolio/:id/snapshots/trigger - 手动触发组合快照
// ?force=true 跳过 correctedAt 保护，强制覆盖已修正的快照
router.post(
  '/:id/snapshots/trigger',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const force = req.query.force === 'true';

    const { getSnapshotDateForNow } = await import(
      '../services/snapshotService'
    );
    const snapshotDate = getSnapshotDateForNow();

    if (!force) {
      const existing = await queryRawUnsafe<
        Array<{ correctedAt: string | null }>
      >(
        `SELECT "correctedAt" FROM "PortfolioSnapshot"
          WHERE "portfolioId" = ? AND "date" = ?
          LIMIT 1`,
        portfolioId,
        snapshotDate
      );
      const correctedAt = existing[0]?.correctedAt ?? null;
      if (correctedAt) {
        res.status(409).json({
          message: `快照已于 ${correctedAt} 完成 K 线修正，如需覆盖请传 ?force=true`,
          correctedAt,
          snapshotDate,
        });
        return;
      }
    }

    const { takeSnapshotForPortfolio } = await import(
      '../services/snapshotService'
    );
    await takeSnapshotForPortfolio(portfolioId);
    res.json({
      message: 'Snapshot triggered successfully.',
      snapshotDate,
      force,
    });
  })
);

// GET /api/portfolio/:id/snapshot-data?date=YYYY-MM-DD
// 纯读库，返回指定日期的完整快照数据（不依赖实时 API）
router.get(
  '/:id/snapshot-data',
  asyncHandler(async (req: Request, res: Response) => {
    const portfolioId = req.params.id;
    const date = req.query.date as string | undefined;
    const envelope = wantsEnvelope(req);

    if (!date || !isValidDateOnly(date)) {
      return sendContractError(
        res,
        400,
        envelope,
        'Missing or invalid date parameter (format: YYYY-MM-DD)',
        [
          {
            code: 'invalid_date',
            message:
              'Query parameter date must be a real calendar date in YYYY-MM-DD format.',
            details: { date: date ?? null },
          },
        ],
        {
          portfolioId,
          requested_date: date ?? null,
          source: 'uht.snapshot-data',
        }
      );
    }

    const [
      portfolioSnap,
      positionSnaps,
      quoteSnaps,
      indexSnaps,
      exchangeRates,
    ] = await Promise.all([
      queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "PortfolioSnapshot" WHERE "portfolioId" = ? AND "date" = ? LIMIT 1`,
        portfolioId,
        date
      ),
      queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT ps.*, a.name as assetName, a.market
           FROM "PositionSnapshot" ps
           LEFT JOIN "Asset" a ON a.code = ps.assetCode
           WHERE ps."portfolioId" = ? AND ps."date" = ?
           ORDER BY ps.marketValue DESC`,
        portfolioId,
        date
      ),
      queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT qs.* FROM "QuoteSnapshot" qs
           INNER JOIN "PositionSnapshot" ps ON ps.assetCode = qs.assetCode
           WHERE ps."portfolioId" = ? AND qs."date" = ?`,
        portfolioId,
        date
      ),
      queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "IndexSnapshot" WHERE "date" = ? ORDER BY "indexCode"`,
        date
      ),
      queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "ExchangeRateSnapshot" WHERE "date" = ?`,
        date
      ),
    ]);

    if (portfolioSnap.length === 0) {
      if (envelope) {
        return sendContractError(
          res,
          404,
          envelope,
          `No snapshot found for portfolio ${portfolioId} on ${date}`,
          [
            {
              code: 'snapshot_not_found',
              message: 'No snapshot found for the requested portfolio/date.',
              details: { portfolioId, date },
            },
          ],
          {
            portfolioId,
            requested_date: date,
            resolved_date: null,
            source: 'uht.snapshot-data',
          }
        );
      }

      return res.status(404).json({
        error: `No snapshot found for portfolio ${portfolioId} on ${date}`,
      });
    }

    const snapshotPayload = {
      date,
      portfolioId,
      portfolio: portfolioSnap[0],
      positions: positionSnaps,
      quotes: quoteSnaps,
      indices: indexSnaps,
      exchangeRates,
    };

    if (envelope) {
      res.json(
        makeEnvelope(snapshotPayload, {
          portfolioId,
          requested_date: date,
          resolved_date: date,
          source: 'uht.snapshot-data',
        })
      );
      return;
    }

    res.json(snapshotPayload);
  })
);

export default router;
