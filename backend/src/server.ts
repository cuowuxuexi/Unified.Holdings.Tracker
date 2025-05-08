import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import marketDataRouter from './routes/marketData'; // 导入市场数据路由
import portfolioRouter from './routes/portfolio'; // 导入投资组合路由
import { dataService } from './services/dataService'; // 导入数据访问服务
import { initExchangeRates } from './services/currencyService'; // 只导入初始化函数

// 记录启动信息
const isProduction = process.env.NODE_ENV === 'production';
console.log(`Server starting in ${isProduction ? 'production' : 'development'} mode`);
console.log(`Data directory: ${dataService.getDataDirPath()}`);

const app: Express = express();
const port = process.env.PORT || 3001; // 使用 3001 端口，避免与前端常用端口冲突

// 中间件
app.use(cors()); // 允许跨域请求
app.use(express.json()); // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true })); // 解析 URL 编码的请求体


// API 路由
app.use('/api/market', marketDataRouter); // 明确市场数据路由路径
app.use('/api/portfolio', portfolioRouter); // 挂载投资组合路由

// 基础路由用于测试
app.get('/', (_req: Request, res: Response) => {
  res.send('Backend server is running!');
});

/**
 * 用异步方式初始化汇率并启动服务器
 */
(async () => {
  try {
    console.log('正在初始化汇率...');
    await initExchangeRates();
    console.log('汇率初始化成功。');
    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('汇率初始化或服务器启动失败:', error);
    process.exit(1);
  }
})();

// 优雅关闭处理 (可选，但推荐)
process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    // 在这里可以添加清理逻辑，例如关闭数据库连接
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    // 在这里可以添加清理逻辑
    process.exit(0);
});

