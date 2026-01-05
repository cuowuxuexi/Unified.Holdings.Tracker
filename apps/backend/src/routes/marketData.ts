import { Router, Request, Response, NextFunction } from 'express';
import { fetchQuotes, fetchKline } from '../services/tencentApi';
import { Quote, KlinePoint } from '../types';

const router = Router();

// Helper function to wrap async route handlers
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// GET /api/market/quote?codes=sh600519,hk00700
router.get(
  '/quote',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const codesQuery = req.query.codes as string;
    if (!codesQuery) {
      res
        .status(400)
        .json({ error: 'Missing required query parameter: codes' });
      return;
    }
    const codes = codesQuery.split(',');

    const quotes: Quote[] = await fetchQuotes(codes);
    res.json(quotes);
  })
);

// GET /api/market/kline?code=sh600519&period=daily&fq=qfq
router.get(
  '/kline',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const code = req.query.code as string;
    const period = req.query.period as
      | 'daily'
      | 'weekly'
      | 'monthly'
      | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const fq = req.query.fq as 'qfq' | 'hfq' | 'none' | undefined;

    if (!code) {
      res.status(400).json({ error: 'Missing required query parameter: code' });
      return;
    }

    const klineData: KlinePoint[] = await fetchKline(
      code,
      period,
      startDate,
      endDate,
      fq
    );
    res.json(klineData);
  })
);

export default router;
