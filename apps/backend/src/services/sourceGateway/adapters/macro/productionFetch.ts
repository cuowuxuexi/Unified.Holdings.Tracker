import { M2DataRepository } from '@uht/domain';
import { SourceGatewayRepository } from '@uht/domain/repositories';
import { persistMacroIndicatorSnapshots } from '../../persistence';
import { SourceGateway } from '../../sourceGateway';
import { RetryPolicy } from '../../types';
import {
  getFrozenMacroIndicatorIds,
  getMacroCatalogResponse,
  isFredMacroConfigured,
} from './catalog';
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

  if (!isFredMacroConfigured(apiKey)) {
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

  const adapter = createFredMacroIndicatorAdapter({
    apiKey,
    fetcher: dependencies.fetcher,
    baseUrl: dependencies.baseUrl,
    sourceId,
  });
  const gateway = new SourceGateway<
    MacroIndicatorRequest,
    MacroIndicatorSnapshot[]
  >({
    operation: DEFAULT_MACRO_OPERATION,
    adapters: [adapter],
    repository: dependencies.gatewayRepository,
    timeoutMs: dependencies.timeoutMs,
    retryPolicy: dependencies.retryPolicy,
  });
  const response = await gateway.execute({
    ...request,
    indicatorIds: requestedIndicatorIds,
  });

  const rowsWritten = dependencies.m2Repository
    ? await persistMacroIndicatorSnapshots(
        dependencies.m2Repository,
        response.data
      )
    : 0;

  return {
    ok: true,
    sourceId: response.sourceId,
    requestedIndicatorIds,
    catalog,
    records: response.data,
    persisted: {
      attempted: Boolean(dependencies.m2Repository),
      rowsWritten,
    },
    metadata: response.metadata,
  };
}
