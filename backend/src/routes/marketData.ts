import { Router, Request, Response } from 'express';
import { fetchQuotes, fetchKline } from '../services/tencentApi'; // 导入函数
import { Quote, KlinePoint } from '../types'; // 直接从类型定义文件导入类型

const router = Router();

// GET /api/quote?codes=sh600519,hk00700
router.get('/quote', async (req: Request, res: Response): Promise<void> => {
  const codesQuery = req.query.codes as string;
  if (!codesQuery) {
    res.status(400).json({ error: 'Missing required query parameter: codes' });
    return; // Explicitly return void after sending response
  }
  const codes = codesQuery.split(',');

  try {
    // 注意：需要确保 tencentApi.ts 导出了 Quote 类型
    const quotes: Quote[] = await fetchQuotes(codes);
    res.json(quotes);
  } catch (error) {
    console.error('Error in /api/quote:', error);
    // 考虑更具体的错误处理或日志记录
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// GET /api/kline?code=sh600519&period=daily&fq=qfq
router.get('/kline', async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  // 提供默认值或进行更严格的类型检查
  const period = req.query.period as 'daily' | 'weekly' | 'monthly' | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const fq = req.query.fq as 'qfq' | 'hfq' | 'none' | undefined;

  if (!code) {
    res.status(400).json({ error: 'Missing required query parameter: code' });
    return; // Explicitly return void after sending response
  }

  try {
    // 注意：需要确保 tencentApi.ts 导出了 KlinePoint 类型
    const klineData: KlinePoint[] = await fetchKline(code, period, startDate, endDate, fq);
    res.json(klineData);
  } catch (error) {
    console.error('Error in /api/kline:', error);
    // 考虑更具体的错误处理或日志记录
    res.status(500).json({ error: 'Failed to fetch kline data' });
  }
});

export default router; // 导出路由
