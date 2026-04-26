import { SourceGatewayRepository } from '@uht/domain/repositories';
import { SourceGateway } from '../../sourceGateway';
import { RetryPolicy } from '../../types';
import { createYieldCurveAdapter } from './adapter';
import { AkshareYieldCurveFetcherOptions } from './akshareFetcher';
import {
  YieldCurveFetcher,
  YieldCurveRecord,
  YieldCurveRequest,
} from './types';

export interface ProductionYieldCurveGatewayOptions {
  repository: SourceGatewayRepository;
  sourceId?: string;
  fetcher?: YieldCurveFetcher;
  fetcherOptions?: AkshareYieldCurveFetcherOptions;
  timeoutMs?: number;
  retryPolicy?: Partial<RetryPolicy>;
  now?: () => Date;
}

export function createProductionYieldCurveGateway(
  options: ProductionYieldCurveGatewayOptions
): SourceGateway<YieldCurveRequest, YieldCurveRecord[]> {
  return new SourceGateway({
    operation: 'yield-curve',
    adapters: [
      createYieldCurveAdapter({
        sourceId: options.sourceId,
        fetcher: options.fetcher,
        fetcherOptions: options.fetcherOptions,
      }),
    ],
    repository: options.repository,
    timeoutMs: options.timeoutMs,
    retryPolicy: options.retryPolicy,
    now: options.now,
  });
}
