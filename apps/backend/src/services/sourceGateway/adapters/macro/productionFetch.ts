import { M2DataRepository } from '@uht/domain';
import { SourceGatewayRepository } from '@uht/domain/repositories';
import { persistMacroIndicatorSnapshots } from '../../persistence';
import { SourceGateway } from '../../sourceGateway';
import { RetryPolicy, SourceAdapter } from '../../types';
import {
  getFrozenMacroIndicatorIds,
  getMacroCatalogResponse,
  isFredMacroConfigured,
  MACRO_INDICATORS,
} from './catalog';
import { createEastmoneyMacroIndicatorAdapter } from './eastmoneyMacroIndicatorAdapter';
import { createFredMacroIndicatorAdapter } from './fredMacroIndicatorAdapter';
import {
  MacroHttpFetcher,
  MacroIndicatorRequest,
  MacroIndicatorSnapshot,
  MacroIndicatorId,
  MacroCatalogResponseEntry,
} from './types';

export interface MacroProductionFetchDependencies {
  gatewayRepository: SourceGatewayRepository;
  m2Repository?: M2DataRepository;
  apiKey?: string;
  fetcher?: MacroHttpFetcher;
  baseUrl?: string;
  sourceId?: string;
  eastmoneyFetcher?: MacroHttpFetcher;
  eastmoneyBaseUrl?: string;
  timeoutMs?: number;
  retryPolicy?: Partial<RetryPolicy>;
}

export interface MacroProductionFetchBlockedResult {
  ok: false;
  sourceId: string;
  requestedIndicatorIds: MacroIndicatorId[];
  catalog: MacroCatalogResponseEntry[];
  records: [];
  failClosed: true;
  blocked: {
    code: 'SOURCE_NOT_CONFIGURED';
    message: string;
  };
  persisted: {
    attempted: false;
    rowsWritten: 0;
  };
}

export interface MacroProductionFetchSuccessResult {
  ok: true;
  sourceId: string;
  requestedIndicatorIds: MacroIndicatorId[];
  catalog: MacroCatalogResponseEntry[];
  records: MacroIndicatorSnapshot[];
  persisted: {
    attempted: boolean;
    rowsWritten: number;
  };
  metadata?: Record<string, unknown>;
}

export type MacroProductionFetchResult =
  | MacroProductionFetchBlockedResult
  | MacroProductionFetchSuccessResult;

const DEFAULT_MACRO_OPERATION = 'macro-indicator';
const DEFAULT_MACRO_SOURCE_ID = 'fred-macro';
const MISSING_API_KEY_MESSAGE =
  'FRED_API_KEY is not configured; macro production fetch is fail-closed.';

export async function runMacroProductionFetch(
  request: MacroIndicatorRequest,
  dependencies: MacroProductionFetchDependencies
): Promise<MacroProductionFetchResult> {
  const sourceId = dependencies.sourceId ?? DEFAULT_MACRO_SOURCE_ID;
  const requestedIndicatorIds = getFrozenMacroIndicatorIds(
    request.indicatorIds
  );
  const catalog = getMacroCatalogResponse(requestedIndicatorIds);
  const apiKey = dependencies.apiKey ?? process.env.FRED_API_KEY;
  const fredIndicatorIds = requestedIndicatorIds.filter(
    (indicatorId) => MACRO_INDICATORS[indicatorId].source === 'FRED'
  );
  const eastmoneyIndicatorIds = requestedIndicatorIds.filter(
    (indicatorId) => MACRO_INDICATORS[indicatorId].source === 'EASTMONEY'
  );
  const fredConfigured = isFredMacroConfigured(apiKey);

  if (eastmoneyIndicatorIds.length === 0 && !fredConfigured) {
    return {
      ok: false,
      sourceId,
      requestedIndicatorIds,
      catalog,
      records: [],
      failClosed: true,
      blocked: {
        code: 'SOURCE_NOT_CONFIGURED',
        message: MISSING_API_KEY_MESSAGE,
      },
      persisted: {
        attempted: false,
        rowsWritten: 0,
      },
    };
  }

  // 各源独立走 SourceGateway（各自记 SourceRun/健康度）；一个源失败不拖垮另一个，
  // 只有全部失败才抛出，单源时与原先行为一致。
  const runs: Array<{
    indicatorIds: MacroIndicatorId[];
    adapter: SourceAdapter<MacroIndicatorRequest, MacroIndicatorSnapshot[]>;
  }> = [];
  if (fredIndicatorIds.length > 0 && fredConfigured) {
    runs.push({
      indicatorIds: fredIndicatorIds,
      adapter: createFredMacroIndicatorAdapter({
        apiKey,
        fetcher: dependencies.fetcher,
        baseUrl: dependencies.baseUrl,
        sourceId,
      }),
    });
  }
  if (eastmoneyIndicatorIds.length > 0) {
    runs.push({
      indicatorIds: eastmoneyIndicatorIds,
      adapter: createEastmoneyMacroIndicatorAdapter({
        fetcher: dependencies.eastmoneyFetcher,
        baseUrl: dependencies.eastmoneyBaseUrl,
      }),
    });
  }

  const records: MacroIndicatorSnapshot[] = [];
  const succeededSourceIds: string[] = [];
  const sourceErrors: Array<{ sourceId: string; error: unknown }> = [];
  let metadata: Record<string, unknown> | undefined;

  for (const run of runs) {
    const gateway = new SourceGateway<
      MacroIndicatorRequest,
      MacroIndicatorSnapshot[]
    >({
      operation: DEFAULT_MACRO_OPERATION,
      adapters: [run.adapter],
      repository: dependencies.gatewayRepository,
      timeoutMs: dependencies.timeoutMs,
      retryPolicy: dependencies.retryPolicy,
    });
    try {
      const response = await gateway.execute({
        ...request,
        indicatorIds: run.indicatorIds,
      });
      records.push(...response.data);
      succeededSourceIds.push(response.sourceId);
      metadata = { ...metadata, ...response.metadata };
    } catch (error) {
      sourceErrors.push({ sourceId: run.adapter.id, error });
    }
  }

  if (succeededSourceIds.length === 0 && sourceErrors.length > 0) {
    throw sourceErrors[0].error;
  }

  const rowsWritten = dependencies.m2Repository
    ? await persistMacroIndicatorSnapshots(dependencies.m2Repository, records)
    : 0;

  return {
    ok: true,
    sourceId: succeededSourceIds[0],
    requestedIndicatorIds,
    catalog,
    records,
    persisted: {
      attempted: Boolean(dependencies.m2Repository),
      rowsWritten,
    },
    metadata: {
      ...metadata,
      ...(succeededSourceIds.length > 1
        ? { sourceIds: succeededSourceIds }
        : {}),
      ...(sourceErrors.length > 0
        ? {
            sourceErrors: sourceErrors.map(({ sourceId: failedId, error }) => ({
              sourceId: failedId,
              message: error instanceof Error ? error.message : String(error),
            })),
          }
        : {}),
      ...(!fredConfigured && fredIndicatorIds.length > 0
        ? { skippedIndicatorIds: fredIndicatorIds }
        : {}),
    },
  };
}
