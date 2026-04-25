import { Router, Request, Response, NextFunction } from 'express';
import {
  M2DataRepository,
  M2SnapshotStatus,
  SourceHealthStatus,
} from '@uht/domain';
import { PrismaM2DataRepository } from '@uht/infra';

type ApiWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

const SOURCE_HEALTH_STATUSES: SourceHealthStatus[] = [
  'HEALTHY',
  'DEGRADED',
  'DOWN',
  'UNKNOWN',
];

const SNAPSHOT_STATUSES: M2SnapshotStatus[] = [
  'SUCCESS',
  'MISSING',
  'STALE',
  'SOURCE_FAILED',
];

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function createSourceDataRouter(
  repository: M2DataRepository = new PrismaM2DataRepository()
): Router {
  const router = Router();

  router.get(
    '/source-health',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
      const status = parseEnumQuery(
        req.query.status,
        SOURCE_HEALTH_STATUSES,
        'status',
        res
      );
      if (status === null) return;

      const sources = await repository.listSourceHealth({
        domain: queryString(req.query.domain),
        sourceId: queryString(req.query.sourceId),
        status,
      });

      res.json(
        envelope(
          { sources },
          {
            source: 'uht.source-health',
            filters: {
              domain: queryString(req.query.domain) ?? null,
              sourceId: queryString(req.query.sourceId) ?? null,
              status: status ?? null,
            },
          }
        )
      );
    })
  );

  router.get(
    '/data/yield-curve',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
      const status = parseEnumQuery(
        req.query.status,
        SNAPSHOT_STATUSES,
        'status',
        res
      );
      if (status === null) return;

      const date = queryString(req.query.date);
      const records = await repository.listYieldCurveSnapshots({
        dateFrom: date ?? queryString(req.query.dateFrom),
        dateTo: date ?? queryString(req.query.dateTo),
        country: queryString(req.query.country),
        tenors: queryList(req.query.tenors),
        sourceId: queryString(req.query.sourceId),
        status,
      });

      res.json(
        envelope(
          { records },
          {
            source: 'uht.yield-curve',
            count: records.length,
          }
        )
      );
    })
  );

  router.get(
    '/data/macro-indicators',
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
      const status = parseEnumQuery(
        req.query.status,
        SNAPSHOT_STATUSES,
        'status',
        res
      );
      if (status === null) return;

      const date = queryString(req.query.date);
      const records = await repository.listMacroIndicatorSnapshots({
        dateFrom: date ?? queryString(req.query.dateFrom),
        dateTo: date ?? queryString(req.query.dateTo),
        indicatorIds: queryList(req.query.indicatorIds),
        sourceId: queryString(req.query.sourceId),
        status,
      });

      res.json(
        envelope(
          { records },
          {
            source: 'uht.macro-indicators',
            count: records.length,
          }
        )
      );
    })
  );

  return router;
}

const defaultRouter = createSourceDataRouter();

export default defaultRouter;

function envelope<T>(
  data: T,
  meta: Record<string, unknown>,
  warnings: ApiWarning[] = [],
  errors: ApiError[] = []
) {
  return {
    data,
    meta: {
      generated_at: new Date().toISOString(),
      ...meta,
    },
    warnings,
    errors,
  };
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function queryList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value
      .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }

  if (typeof value !== 'string') return undefined;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseEnumQuery<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
  res: Response
): T | undefined | null {
  const parsed = queryString(value);
  if (!parsed) return undefined;
  if (allowed.includes(parsed as T)) return parsed as T;

  res.status(400).json(
    envelope(
      null,
      { source: 'uht.source-data' },
      [],
      [
        {
          code: `invalid_${name}`,
          message: `Query parameter ${name} must be one of: ${allowed.join(', ')}`,
          details: { [name]: parsed },
        },
      ]
    )
  );
  return null;
}
