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

const startServer = async () => {
  if (appEnv.nodeEnv !== 'test') {
    try {
      console.log('Initializing exchange rates...');
      await initExchangeRates();
      console.log('Exchange rates initialized');
    } catch (error) {
      console.error('Failed to initialize exchange rates:', error);
    }
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
