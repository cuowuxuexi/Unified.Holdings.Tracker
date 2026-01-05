import express, {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma';
import marketDataRouter from './routes/marketData';
import portfolioRouter from './routes/portfolio';
import batchRouter from './routes/batch';
import { dataService } from './services/dataService';
import { initExchangeRates } from './services/currencyService';
import { appEnv } from './config/env';
import { openApiDocument } from './openapi';

const port = appEnv.port;
// 临时修复apiBasePath问题
const apiBasePath = appEnv.apiBasePath;
const isProduction = appEnv.nodeEnv === 'production';

type HealthStatus = {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  checks: {
    database: 'up' | 'down';
  };
};

const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  console.log(`[HTTP] --> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[HTTP] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });
  next();
};

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = err instanceof HttpError ? err.statusCode : 500;
  const message =
    err instanceof HttpError ? err.message : 'Internal Server Error';

  if (status >= 500) {
    console.error('[Error Handler]', err);
  }

  res.status(status).json({
    message,
    statusCode: status,
    timestamp: new Date().toISOString(),
  });
};

const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    message: 'Resource not found',
    path: req.originalUrl,
  });
};

export const createApp = (): Express => {
  console.log(
    `Server starting in ${isProduction ? 'production' : 'development'} mode`
  );
  console.log(`Data directory: ${dataService.getDataDirPath()}`);

  const app = express();

  app.use(
    cors({
      origin: appEnv.frontendUrl,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  app.get('/', (_req: Request, res: Response) => {
    res.send('Backend server is running!');
  });

  app.get(`${apiBasePath}/health`, async (_req: Request, res: Response) => {
    const payload: HealthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: 'up',
      },
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      payload.status = 'degraded';
      payload.checks.database = 'down';
      console.error('[Health Check] database unavailable', error);
    }

    const statusCode = payload.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(payload);
  });

  app.get(`${apiBasePath}/openapi.json`, (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(`${apiBasePath}/market`, marketDataRouter);
  app.use(`${apiBasePath}/portfolio`, portfolioRouter);
  app.use(`${apiBasePath}/batch`, batchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

const app = createApp();

// 数据库初始化：创建所有必需的表
async function initializeDatabase() {
  console.log('Checking database schema...');

  try {
    const tableStatements: Record<string, string> = {
      Portfolio: `
        CREATE TABLE IF NOT EXISTS "Portfolio" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "initialCash" REAL NOT NULL,
          "cash" REAL NOT NULL,
          "leverageTotalAmount" REAL NOT NULL,
          "leverageUsedAmount" REAL NOT NULL,
          "leverageAvailableAmount" REAL NOT NULL,
          "leverageCostRate" REAL NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          "attentionInfo" TEXT
        )
      `,
      Asset: `
        CREATE TABLE IF NOT EXISTS "Asset" (
          "code" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "market" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        )
      `,
      Transaction: `
        CREATE TABLE IF NOT EXISTS "Transaction" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "portfolioId" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "date" DATETIME NOT NULL,
          "assetCode" TEXT,
          "quantity" REAL,
          "price" REAL,
          "amount" REAL,
          "commission" REAL,
          "leverageUsed" REAL,
          "currency" TEXT NOT NULL DEFAULT 'CNY',
          "exchangeRate" REAL,
          "notes" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          FOREIGN KEY ("assetCode") REFERENCES "Asset"("code"),
          FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE
        )
      `,
      QuoteSnapshot: `
        CREATE TABLE IF NOT EXISTS "QuoteSnapshot" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "assetCode" TEXT NOT NULL,
          "timestamp" DATETIME NOT NULL,
          "currentPrice" REAL NOT NULL,
          "changePercent" REAL,
          "changeAmount" REAL,
          "volume" REAL,
          "turnover" REAL,
          "openPrice" REAL,
          "highPrice" REAL,
          "lowPrice" REAL,
          "prevClosePrice" REAL,
          "marketCap" REAL,
          "peRatio" REAL,
          "weekChangePercent" REAL,
          "monthChangePercent" REAL,
          "yearChangePercent" REAL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("assetCode") REFERENCES "Asset"("code") ON DELETE CASCADE
        )
      `,
      AttentionItem: `
        CREATE TABLE IF NOT EXISTS "AttentionItem" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "portfolioId" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE
        )
      `,
    };

    const indexStatements = [
      `CREATE INDEX IF NOT EXISTS "Transaction_assetCode_idx" ON "Transaction"("assetCode")`,
      `CREATE INDEX IF NOT EXISTS "Transaction_portfolioId_type_idx" ON "Transaction"("portfolioId", "type")`,
      `CREATE INDEX IF NOT EXISTS "Transaction_portfolioId_date_idx" ON "Transaction"("portfolioId", "date")`,
    ];

    const existingTables = new Set(
      (
        await prisma.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM sqlite_master WHERE type = 'table'
        `
      ).map((row: { name: string }) => row.name)
    );

    const missing = Object.keys(tableStatements).filter(
      (name) => !existingTables.has(name)
    );
    if (missing.length > 0) {
      console.log(
        `Database schema missing tables: ${missing.join(', ')}. Creating...`
      );
    } else {
      console.log('Database schema exists. Ensuring all tables and indexes...');
    }

    for (const [tableName, statement] of Object.entries(tableStatements)) {
      await prisma.$executeRawUnsafe(statement);
      if (!existingTables.has(tableName)) {
        console.log(`✓ Table ensured: ${tableName}`);
      }
    }

    for (const statement of indexStatements) {
      await prisma.$executeRawUnsafe(statement);
    }

    console.log('✅ Database schema ensured successfully');
  } catch (error) {
    console.error('Failed to ensure database schema:', error);
    throw error;
  }
}

const startServer = async () => {
  if (appEnv.nodeEnv !== 'test') {
    // 初始化数据库
    try {
      await initializeDatabase();
    } catch (error) {
      console.error('Database initialization failed:', error);
      console.error(
        'Application will continue, but database operations may fail'
      );
    }

    try {
      console.log('Initializing exchange rates...');
      await initExchangeRates();
      console.log('Exchange rates initialized');
    } catch (error) {
      console.error('Failed to initialize exchange rates:', error);
    }
  }

  // Zombie Killer: 当作为 Electron 子进程运行时，父进程退出后自动退出
  if (process.env.ELECTRON_RUN_AS_NODE) {
    const parentPid = process.ppid;
    console.log(
      `Running as Electron child process. Monitoring parent process ${parentPid}...`
    );

    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch (e) {
        console.log(`Parent process ${parentPid} is gone. Exiting...`);
        process.exit(0);
      }
    }, 3000); // 每 3 秒检查一次
  }

  const server = app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

if (process.env.JEST_WORKER_ID === undefined) {
  void startServer();
}

export { app, HttpError };
