import { Router, Request, Response, NextFunction } from 'express'; // Added NextFunction
import {
  readPortfolios,
  addPortfolio,
  getPortfolioById,
  addTransactionToPortfolio,
  deleteTransactionFromPortfolio,
  deletePortfolio,
  cashRecalculateForPortfolioAsync,
  correctHistoricalTransactionAmounts, // Import the new function
} from '../services/storage';
import { fetchQuotes } from '../services/tencentApi'; // Added
import { calculateRealtimePnl, calculatePeriodStats, calculateNetDepositedCash, calculateTotalCommission, calculateLeverageCostByDay, calculateTotalDividendIncome } from '../services/calculationService'; // Removed calculateLeverageCost
import { getExchangeRateForAssetToCNY, getExchangeRate } from '../services/currencyService'; // Added currency service and getExchangeRate
import { Portfolio, Transaction, PortfolioDetail, Position, TransactionType, Asset, Market, LeverageInfo, Quote } from '../types'; // Added Asset, Market, LeverageInfo, Quote
import { v4 as uuidv4 } from 'uuid';
import { parseISO, startOfYear, min as dateMin } from 'date-fns'; // Added dateMin

const router = Router();

// Helper function to wrap async route handlers and catch errors
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Helper function to parse market from asset code - Stricter version
// 修改后的函数：仅接受明确前缀，否则返回 null
const getMarketFromCode = (code: string): Market | null => {
  const lowerCode = code.toLowerCase();
  if (lowerCode.startsWith('sh') || lowerCode.startsWith('sz')) return Market.CN;
  if (lowerCode.startsWith('hk')) return Market.HK;
  if (lowerCode.startsWith('us')) return Market.US;
  // 对于无法识别的格式，不再默认猜测，返回 null
  console.warn(`[getMarketFromCode] Could not determine market for code: ${code}. Returning null.`);
  return null;
};


// --- Helper Function: Calculate Base Positions ---
// Extracted from GET /:id to be reusable
const calculateBasePositions = (transactions: Transaction[]): Position[] => {
    const positionsMap: Map<string, { quantity: number; totalCost: number; assetCode: string; transactions: Transaction[] }> = new Map();

    transactions.forEach(tx => {
      // Only process BUY/SELL transactions for positions
      if ((tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) && tx.assetCode) {
        // --- 严格检查资产代码格式 ---
        const market = getMarketFromCode(tx.assetCode);
        if (!market) {
            console.warn(`[calculateBasePositions] Skipping transaction with invalid or unrecognized asset code format: ${tx.assetCode}`);
            return; // 跳过此交易记录
        }
        // --- 结束检查 ---

        if (!positionsMap.has(tx.assetCode)) {
          positionsMap.set(tx.assetCode, { quantity: 0, totalCost: 0, assetCode: tx.assetCode, transactions: [] });
        }
        const pos = positionsMap.get(tx.assetCode)!;
        pos.transactions.push(tx); // Keep track of transactions per asset

        const quantity = tx.quantity ?? 0; // Handle optional quantity
        const price = tx.price ?? 0; // Handle optional price
        const transactionAmount = quantity * price; // 计算交易金额（不含手续费）

        if (tx.type === TransactionType.BUY) {
          pos.quantity += quantity;
          pos.totalCost += transactionAmount; // 买入时增加总成本
        } else if (tx.type === TransactionType.SELL) {
          pos.quantity -= quantity;
          pos.totalCost -= transactionAmount; // 卖出时直接减去卖出金额（不使用平均成本）

          // 处理超卖情况
          if (pos.quantity < 0) {
              console.warn(`Overselling detected for ${tx.assetCode}. Quantity adjusted to 0.`);
              pos.quantity = 0;
              // 注意：不再重置 totalCost，因为它现在代表历史买卖总额的差值
          }
        }
      }
    });

    const positions: Position[] = [];
    for (const data of positionsMap.values()) {
        if (data.quantity <= 0) continue; // 只处理数量大于0的

        const market = getMarketFromCode(data.assetCode);
        if (!market) {
            console.error(`[calculateBasePositions] Market became null unexpectedly for code: ${data.assetCode}`);
            continue;
        }

        const asset: Asset = {
            code: data.assetCode,
            market: market,
            name: data.assetCode
        };
        
        // 计算单位成本价（可能为负）
        const costPrice = data.quantity > 0 ? data.totalCost / data.quantity : 0;
        
        positions.push({
          asset: asset,
          quantity: data.quantity,
          costPrice: costPrice,
          totalCost: data.totalCost,
          // Placeholder values - to be filled later
          marketValue: 0,
          currentPrice: 0,
          dailyChange: 0,
          totalPnl: 0,
        });
    }
    return positions;
};
// --- End Helper Function ---


// GET /api/portfolio - Get list of portfolios (basic info)
router.get('/', asyncHandler(async (req: Request, res: Response, next: NextFunction) => { // Wrapped with asyncHandler
  try {
    const portfolios = await readPortfolios();
    // Return basic info including cash for display
    const basicPortfolios = portfolios.map(({ id, name, cash }) => ({ id, name, cash })); // 添加 cash 字段
    res.json(basicPortfolios);
  } catch (error) {
    console.error('Error fetching portfolios:', error);
    next(error); // Use next for error handling
  }
}));

// POST /api/portfolio - Create a new portfolio
router.post('/', asyncHandler(async (req: Request, res: Response, next: NextFunction) => { // Wrapped with asyncHandler
  try {
    // 从请求体中解构前端发送的字段名
    const { name, cash, leverageInfo } = req.body as { name: string; cash: number; leverageInfo?: { totalCredit: number; interestRate: number; /* 其他前端可能发送的字段 */ } };

    // 验证 cash 字段
    if (!name || typeof name !== 'string' || cash === undefined || typeof cash !== 'number' || cash < 0) {
      return res.status(400).json({ message: 'Invalid input data: name (string) and non-negative cash (number) are required.' });
    }
    // 验证 leverageInfo 及其内部字段
    if (leverageInfo && (typeof leverageInfo.totalCredit !== 'number' || typeof leverageInfo.interestRate !== 'number')) {
        // 注意：前端发送的是 interestRate (百分比 / 100 后的值)，后端期望 costRate。这里仅验证类型。
        // 如果 addPortfolio 需要 costRate，则需要在下方转换。
        return res.status(400).json({ message: 'Invalid leverage format (requires totalCredit and interestRate as numbers).' });
    }

    // 准备传递给 addPortfolio 的数据，注意字段名转换
    // addPortfolio 期望 { name: string; initialCash: number; leverage?: LeverageInfo }
    // LeverageInfo 期望 { totalAmount: number; usedAmount: number; availableAmount: number; costRate: number; }
    const portfolioDataForStorage: { name: string; initialCash: number; leverage?: LeverageInfo } = {
      name: name,
      initialCash: cash, // 使用前端传入的 cash 作为 initialCash
      // 如果 leverageInfo 存在，则转换其内部字段名以匹配 LeverageInfo 类型
      leverage: leverageInfo ? {
          totalAmount: leverageInfo.totalCredit, // totalCredit -> totalAmount
          costRate: leverageInfo.interestRate,  // interestRate -> costRate (假设 addPortfolio 需要 costRate)
          // usedAmount 和 availableAmount 通常在创建时初始化为 0 和 totalAmount
          usedAmount: 0,
          availableAmount: leverageInfo.totalCredit
      } : undefined,
    };

    const newPortfolio = await addPortfolio(portfolioDataForStorage);
    res.status(201).json(newPortfolio);
  } catch (error) {
    console.error('Error creating portfolio:', error);
    next(error);
  }
}));

/**
 * GET /api/portfolio/correct-history - 触发历史交易金额修正和现金重算
 * WARNING: 此路由用于数据修正，应谨慎使用，建议在执行前备份数据。
 */
router.get('/correct-history', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[Route /correct-history] Received request.');
    await correctHistoricalTransactionAmounts(); // 调用修正函数
    res.json({ message: 'Historical transaction amount correction initiated. Check backend logs for details.' });
  } catch (error) {
    console.error('Error initiating historical transaction amount correction:', error);
    next(error); // Pass error to the error handler
  }
}));


/**
 * GET /api/exchange-rates - 获取主要货币对人民币的实时汇率
 */
router.get('/exchange-rates', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[Route /exchange-rates] Received request.');
    const [usdRate, hkdRate] = await Promise.all([
      getExchangeRate('USD', 'CNY'),
      getExchangeRate('HKD', 'CNY'),
    ]);
    res.json({
      USD: usdRate,
      HKD: hkdRate,
      CNY: 1.0, // 人民币对人民币总是1
      updatedAt: new Date().toISOString(), // 提供更新时间戳
    });
  } catch (error: any) { // Added :any type hint for accessing message
    console.error('Error fetching exchange rates:', error);
    // Check if it's the rate limit error (Error Code 10012 or specific message)
    if (error instanceof Error && error.message && (error.message.includes('10012') || error.message.includes('超过每日可允许请求次数'))) {
       console.warn('[Route /exchange-rates] Juhe API rate limit exceeded.');
       // Return 503 Service Unavailable with a specific error message
       return res.status(503).json({
         message: 'Exchange rate service unavailable (Rate limit exceeded). Please try again later.',
         error: true,
         USD: null, // Indicate unavailable
         HKD: null, // Indicate unavailable
         CNY: 1.0,  // CNY rate is always 1
         updatedAt: new Date().toISOString(),
       });
    }
    // For other errors, pass to the default error handler
    next(error);
    // 或者可以返回默认值：
    // res.status(500).json({ 
    //   message: 'Failed to fetch real-time exchange rates. Using default values.',
    //   USD: 7.25, // Default fallback
    //   HKD: 0.92, // Default fallback
    //   CNY: 1.0,
    //   updatedAt: new Date().toISOString(),
    //   error: true 
    // });
  }
}));



// GET /api/portfolio/:id - Get portfolio details with calculated positions
router.get('/:id', asyncHandler(async (req: Request, res: Response, next: NextFunction) => { // Wrapped with asyncHandler
  try {
    const portfolioId = req.params.id;
    const portfolio = await getPortfolioById(portfolioId);

    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    // --- Position Calculation Logic (using helper function) ---
    const positions = calculateBasePositions(portfolio.transactions);
    // --- End Position Calculation ---

    // Calculate derived values for PortfolioDetail
    const totalMarketValue = positions.reduce((sum, pos) => sum + pos.quantity * pos.costPrice, 0); // Use cost price for now
    const totalAssets = portfolio.cash + totalMarketValue;
    // Assuming leverage.usedAmount needs calculation based on transactions or market value, default to 0 for now
    const netAssets = totalAssets - (portfolio.leverage?.usedAmount ?? 0);

    // 计算手续费总和
    const totalCommission = await calculateTotalCommission(portfolio);
    console.log(`[Portfolio Stats Route] 计算得到手续费总和: ${totalCommission}`);

    // 计算整个生命周期的融资成本 (使用逐日法)
    let leverageCostLifetime = 0;
    if (portfolio.transactions && portfolio.transactions.length > 0) {
      const firstTxDate = portfolio.transactions.reduce((earliest, current) => {
        const currentTs = new Date(current.date);
        return currentTs < earliest ? currentTs : earliest;
      }, new Date(portfolio.transactions[0].date));
      const startDateLifetime = firstTxDate;
      const endDateLifetime = new Date(); // Current date
      leverageCostLifetime = calculateLeverageCostByDay(portfolio, startDateLifetime, endDateLifetime);
      console.log(`[Portfolio Detail Route] 计算得到整个生命周期融资成本: ${leverageCostLifetime}`);
    } else {
      console.log(`[Portfolio Detail Route] 无交易记录，整个生命周期融资成本为 0`);
    }


    // 计算总股息收入
    const totalDividendIncome = calculateTotalDividendIncome(portfolio);
    console.log(`[Portfolio Stats Route] 计算得到总股息收入: ${totalDividendIncome}`);

    const portfolioDetail: PortfolioDetail = {
      // Spread Portfolio properties
      id: portfolio.id,
      name: portfolio.name,
      cash: portfolio.cash, // 可用现金（availableCash），受买卖、杠杆等影响
      initialCash: portfolio.initialCash, // 新增：补全初始现金余额
      leverage: portfolio.leverage, // Use 'leverage' from Portfolio type
      transactions: portfolio.transactions, // Include transactions as per Portfolio type

      // Add calculated/derived properties
      positions: positions,
      totalMarketValue: totalMarketValue,
      totalAssets: totalAssets,
      netAssets: netAssets,
      // 新增字段：净入金（netDepositedCash），仅由初始现金、所有入金、所有出金决定
      netDepositedCash: calculateNetDepositedCash(portfolio),
      // 新增字段：所有买卖交易手续费（折算为CNY）总和
      totalCommission,
      // 新增字段：融资成本 (整个生命周期)
      leverageCost: leverageCostLifetime,
      // totalDividendIncome, // REMOVED - This field belongs in the final API response, not PortfolioDetail type
      // Placeholder values - to be implemented later
      dailyPnl: 0,
      totalPnl: 0,
    };

    // Remove the incorrect totalValue calculation here as it's part of portfolioDetail now

    res.json(portfolioDetail);
  } catch (error) {
    console.error(`Error fetching portfolio details for ID ${req.params.id}:`, error);
    next(error); // Use next for error handling
    // res.status(500).json({ message: 'Error fetching portfolio details' }); // Removed direct response
  }
}));

// DELETE /api/portfolio/:id - 删除投资组合
router.delete('/:id', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const portfolioId = req.params.id;
    const success = await deletePortfolio(portfolioId);
    if (!success) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }
    res.status(204).send(); // No Content
  } catch (error) {
    console.error(`Error deleting portfolio ${req.params.id}:`, error);
    next(error);
  }
}));

// GET /api/portfolio/:id/transactions - Get transactions for a portfolio
router.get('/:id/transactions', asyncHandler(async (req: Request, res: Response, next: NextFunction) => { // Wrapped with asyncHandler
  try {
    const portfolioId = req.params.id;
    const portfolio = await getPortfolioById(portfolioId);

    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    res.json(portfolio.transactions);
  } catch (error) {
    console.error(`Error fetching transactions for portfolio ${req.params.id}:`, error);
    next(error); // Use next for error handling
    // res.status(500).json({ message: 'Error fetching transactions' }); // Removed direct response
  }
}));

// POST /api/portfolio/:id/transactions - Add a transaction to a portfolio
router.post('/:id/transactions', asyncHandler(async (req: Request, res: Response, next: NextFunction) => { // Wrapped with asyncHandler
  // --- 添加日志：打印收到的原始请求体 ---
  console.log('[Backend Route] Received transaction request body:', JSON.stringify(req.body, null, 2));
  // --- 结束日志 ---
  // --- 添加日志：开始处理请求 ---
  console.log(`[POST /:id/transactions] Received request for portfolioId: ${req.params.id}`);
  console.log(`[POST /:id/transactions] Request body:`, JSON.stringify(req.body, null, 2));
  // --- 结束日志 ---
  try {
    const portfolioId = req.params.id;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // Use Omit<Transaction, 'id'> for type safety
    const transactionData = req.body as Omit<Transaction, 'id'>;

    // Basic validation (add more specific checks as needed)
    const type = transactionData.type;
    const date = transactionData.date;
    const assetCode = transactionData.assetCode;
    const quantity = transactionData.quantity;
    const price = transactionData.price;
    const amount = transactionData.amount;

    if (!type || !date) {
         return res.status(400).json({ message: 'Invalid transaction data. Required fields: type, date.' });
    }
    if (isNaN(Date.parse(date))) {
         return res.status(400).json({ message: 'Invalid date format. Please use ISO 8601 format.' });
    }

    // Asset Code Format Validation (if provided)
    if (assetCode && !getMarketFromCode(assetCode)) {
        return res.status(400).json({ message: `Invalid asset code format: ${assetCode}. Must start with sh, sz, hk, or us.` });
    }

    // Type-specific validation
    if (type === TransactionType.BUY || type === TransactionType.SELL) {
        if (!assetCode || typeof assetCode !== 'string') {
            return res.status(400).json({ message: 'Invalid transaction data for BUY/SELL. Required field: assetCode (string).' });
        }
        if (quantity === undefined || typeof quantity !== 'number' || quantity <= 0) {
            return res.status(400).json({ message: 'Invalid quantity for BUY/SELL (must be positive number).' });
        }
        if (price === undefined || typeof price !== 'number' || price <= 0) {
            return res.status(400).json({ message: 'Invalid price for BUY/SELL (must be positive number).' });
        }
    } else if (type === TransactionType.DEPOSIT || type === TransactionType.WITHDRAW || type === TransactionType.LEVERAGE_ADD || type === TransactionType.LEVERAGE_REMOVE || type === TransactionType.LEVERAGE_COST) {
        if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ message: `Invalid amount for ${type} transaction (must be positive number).` });
        }
    } else if (type === TransactionType.DIVIDEND) {
        if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount for DIVIDEND transaction (must be positive number).' });
        }
        // assetCode is optional for DIVIDEND, format checked above if present
    } else {
        // Handle potential unknown types just in case
        return res.status(400).json({ message: `Unsupported transaction type: ${type}` });
    }

    // --- 添加日志：传递给服务层的数据 --- 
    console.log(`[POST /:id/transactions] Passing data to addTransactionToPortfolio:`, JSON.stringify(transactionData, null, 2));
    // --- 结束日志 ---
    const newTransaction = await addTransactionToPortfolio(portfolioId, transactionData);
    // --- 添加日志：服务层返回结果 --- 
    console.log(`[POST /:id/transactions] addTransactionToPortfolio returned:`, JSON.stringify(newTransaction, null, 2));
    // --- 结束日志 ---

    if (!newTransaction) {
      // This implies the portfolio was not found by the service function
      // --- 添加日志：服务层未找到 Portfolio --- 
      console.log(`[POST /:id/transactions] Service layer returned null (Portfolio or Transaction not found?), returning 404.`);
      // --- 结束日志 ---
      return res.status(404).json({ message: 'Portfolio not found' });
    }

    res.status(201).json(newTransaction);
  } catch (error: any) {
    console.error(`Error adding transaction to portfolio ${req.params.id}:`, error);
     // Check for specific error messages from storage service if available
     // Pass specific errors to the error handler via next()
     if (error.message && (error.message.includes('Insufficient funds') || error.message.includes('Insufficient shares'))) {
        // You might want to create custom error types or add properties to the error
        error.statusCode = 400; // Add status code for the error handler
        return next(error);
     }
    next(error); // Use next for general error handling
  }
}));

// DELETE /api/portfolio/:id/transactions/:txId - Delete a transaction
router.delete('/:id/transactions/:txId', asyncHandler(async (req: Request, res: Response, next: NextFunction) => { // Wrapped with asyncHandler
  try {
    const { id: portfolioId, txId } = req.params;

    const success = await deleteTransactionFromPortfolio(portfolioId, txId);

    if (!success) {
      // Could be portfolio not found OR transaction not found
      return res.status(404).json({ message: 'Portfolio or Transaction not found' });
    }

    res.status(204).send(); // No Content indicates success
  } catch (error) {
    console.error(`Error deleting transaction ${req.params.txId} from portfolio ${req.params.id}:`, error);
    next(error); // Use next for error handling
    // res.status(500).json({ message: 'Error deleting transaction' }); // Removed direct response
  }
}));

// GET /api/portfolio/:id/stats - Get portfolio statistics
router.get('/:id/stats', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const portfolioId = req.params.id;
    // 新增：解析区间参数
    const { startDate, endDate } = req.query;
    let start: Date;
    let end: Date;
    if (typeof startDate === 'string') {
      start = parseISO(startDate);
    } else {
      // 默认本年初
      start = startOfYear(new Date());
    }
    if (typeof endDate === 'string') {
      end = parseISO(endDate);
    } else {
      // 默认今天
      end = new Date();
    }
    // Validate and type cast period query parameter
    const rawPeriod = req.query.period as string | undefined;
    const allowedPeriods = ['total', 'daily', 'weekly', 'monthly', 'yearly'];
    const period: "total" | "daily" | "weekly" | "monthly" | "yearly" | undefined =
        rawPeriod && allowedPeriods.includes(rawPeriod) ? rawPeriod as "total" | "daily" | "weekly" | "monthly" | "yearly" : 'total'; // Default to 'total' if invalid or missing

    // Step 1: Get Portfolio Data
    const portfolio = await getPortfolioById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }
    // --- DEBUG LOGGING START: Transactions --- 
    console.log(`[DEBUG /stats ${portfolioId}] Fetched transactions:`, JSON.stringify(portfolio.transactions, null, 2));
    // --- DEBUG LOGGING END: Transactions --- 

    // Step 2: Calculate Base Positions
    const basePositions = calculateBasePositions(portfolio.transactions);
    // --- DEBUG LOGGING START: Base Positions --- 
    console.log(`[DEBUG /stats ${portfolioId}] Calculated Base Positions:`, JSON.stringify(basePositions, null, 2));
    // --- DEBUG LOGGING END: Base Positions --- 

    // Step 3: Fetch Realtime Quotes
    const assetCodes = basePositions.map(p => p.asset.code);
    let quotesMap: Record<string, Quote> = {};
    if (assetCodes.length > 0) {
        const quotesArray = await fetchQuotes(assetCodes);
        quotesMap = quotesArray.reduce((map, quote) => {
            map[quote.code] = quote;
            return map;
        }, {} as Record<string, Quote>);
    }
    // --- DEBUG LOGGING END ---


    // Step 4: Calculate Realtime PnL for Positions
    const updatedPositions = calculateRealtimePnl(basePositions, quotesMap);
    // --- DEBUG LOGGING START: Updated Positions --- 
    console.log(`[DEBUG /stats ${portfolioId}] Positions after Realtime PnL:`, JSON.stringify(updatedPositions, null, 2));
    // --- DEBUG LOGGING END: Updated Positions --- 

    // Step 5: Calculate Period Stats (Using Placeholder)
    // Note: calculatePeriodStats currently returns a placeholder like { periodReturnPercent: null }
    const periodStats = await calculatePeriodStats(portfolio, period);
    // 新增：分别计算周/月/年统计
    const [weeklyStats, monthlyStats, yearlyStats] = await Promise.all([
      calculatePeriodStats(portfolio, 'weekly'),
      calculatePeriodStats(portfolio, 'monthly'),
      calculatePeriodStats(portfolio, 'yearly'),
    ]);

    // Step 6: Integrate Results - Calculate total market value and PnL in CNY
    let totalMarketValueInCNY = 0;
    let dailyPnlInCNY = 0;
    let totalPnlInCNY = 0;

    for (const pos of updatedPositions) {
      let exchangeRate = 1; // Default for CNY
      if (pos.asset.market !== Market.CN) {
        try {
          // Fetch exchange rate for the asset's market to CNY
          exchangeRate = await getExchangeRateForAssetToCNY(pos.asset.code);
        } catch (rateError) {
          console.error(`[Stats Calc] Failed to get exchange rate for ${pos.asset.code}, using 1. Error:`, rateError);
          // Decide how to handle - skip this position's value? Use rate 1? Log and continue?
          // For now, log and use rate 1, which might lead to inaccuracies.
        }
      }
      totalMarketValueInCNY += (pos.marketValue ?? 0) * exchangeRate;
      dailyPnlInCNY += (pos.dailyChange ?? 0) * exchangeRate;
      // totalPnlInCNY calculation removed - now using netAssets - netDepositedCash approach
    }

    const totalAssets = portfolio.cash + totalMarketValueInCNY;
    // Ignore leverage.usedAmount calculation for now as per requirement
    const netAssets = totalAssets - (portfolio.leverage?.usedAmount ?? 0);
    // dailyPnl and totalPnl are now calculated in CNY above

    // 计算手续费总和
    const totalCommission = await calculateTotalCommission(portfolio);
    console.log(`[Portfolio Stats Route] 计算得到手续费总和: ${totalCommission}`);

    // 计算整个生命周期的融资成本 (使用逐日法) - 替换原有按区间计算逻辑
    let leverageCostLifetimeStats = 0;
    if (portfolio.transactions && portfolio.transactions.length > 0) {
        const firstTxDateStats = portfolio.transactions.reduce((earliest, current) => {
            const currentTs = new Date(current.date);
            return currentTs < earliest ? currentTs : earliest;
        }, new Date(portfolio.transactions[0].date));
        const startDateLifetimeStats = firstTxDateStats;
        const endDateLifetimeStats = new Date(); // Current date
        leverageCostLifetimeStats = calculateLeverageCostByDay(portfolio, startDateLifetimeStats, endDateLifetimeStats);
        console.log(`[Portfolio Stats Route] 计算得到整个生命周期融资成本: ${leverageCostLifetimeStats}`);
    } else {
        console.log(`[Portfolio Stats Route] 无交易记录，整个生命周期融资成本为 0`);
    }

    // 计算总股息收入
    const totalDividendIncome = calculateTotalDividendIncome(portfolio);
    console.log(`[Portfolio Stats Route] 计算得到总股息收入: ${totalDividendIncome}`);

    const response = {
      portfolioId: portfolio.id,
      name: portfolio.name,
      cash: portfolio.cash, // 可用现金（availableCash），受买卖、杠杆等影响
      leverage: portfolio.leverage,
      totalMarketValue: totalMarketValueInCNY, // Use CNY value
      totalAssets: totalAssets, // Use CNY value
      netAssets: netAssets, // Use CNY value
      // 新增字段：净入金（netDepositedCash），仅由初始现金、所有入金、所有出金决定
      netDepositedCash: calculateNetDepositedCash(portfolio),
      // 新增字段：所有买卖交易手续费（折算为CNY）总和
      totalCommission,
      // 新增字段：融资成本 (整个生命周期)
      leverageCost: leverageCostLifetimeStats,
      // 新增字段：总股息收入
      totalDividendIncome,
      dailyPnl: dailyPnlInCNY, // Use CNY value
      totalPnl: netAssets - calculateNetDepositedCash(portfolio), // New calculation based on netAssets - netDepositedCash
      periodReturnPercent: periodStats.periodReturnPercent, // Note: Period return calculation might also need currency adjustments
      weeklyStats,
      monthlyStats,
      yearlyStats,
      // Add other stats placeholders if needed, e.g., annualizedReturn: null
      positions: updatedPositions, // Return positions with realtime data
      timestamp: Date.now() // Add timestamp to stats response
    };

    console.log(`[Portfolio Stats Route] 最终返回数据中的totalCommission: ${response.totalCommission}`);
    res.json(response);

  } catch (error) {
    console.error(`Error fetching portfolio stats for ID ${req.params.id}:`, error);
    next(error);
  }
}));

// GET /api/portfolio/:id/cash-recalc - 现金重算校验
router.get('/:id/cash-recalc', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const portfolioId = req.params.id;
    const portfolio = await getPortfolioById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({ message: 'Portfolio not found' });
    }
    const result = await cashRecalculateForPortfolioAsync(portfolio);
    res.json({
      portfolioId: portfolio.id,
      name: portfolio.name,
      currentCash: portfolio.cash,
      recalculatedCash: result.cash,
      diff: result.diff,
      steps: result.steps
    });
  } catch (error) {
    console.error(`Error recalculating cash for portfolio ${req.params.id}:`, error);
    next(error);
  }
}));

export default router;
