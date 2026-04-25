import { openApiDocument } from '../../openapi';

describe('OpenAPI M1 readonly contract', () => {
  it('documents current readonly endpoints and reserved future contracts', () => {
    expect(
      openApiDocument.paths['/portfolio/{id}/snapshot-data']
    ).toBeDefined();
    expect(
      openApiDocument.paths['/portfolio/{id}/overview-context']
    ).toBeDefined();
    expect(openApiDocument.paths['/portfolio/exchange-rates']).toBeDefined();
    expect(openApiDocument.paths['/market/quote']).toBeDefined();
    expect(openApiDocument.paths['/market/kline']).toBeDefined();
    expect(openApiDocument.paths['/source-health']).toBeDefined();
    expect(openApiDocument.paths['/data/yield-curve']).toBeDefined();
    expect(openApiDocument.paths['/data/macro-indicators']).toBeDefined();
    expect(
      openApiDocument.paths['/portfolio/{id}/period-report']
    ).toBeDefined();
    expect(openApiDocument.paths['/portfolio/period-report']).toBeDefined();

    const schemas = openApiDocument.components?.schemas ?? {};
    expect(schemas.SnapshotDataEnvelope).toBeDefined();
    expect(schemas.QuoteDiagnosticsEnvelope).toBeDefined();
    expect(schemas.KlineDiagnosticsEnvelope).toBeDefined();
    expect(schemas.DataFreshnessEnvelope).toBeDefined();
    expect(schemas.SourceHealthEnvelope).toBeDefined();
    expect(schemas.YieldCurveEnvelope).toBeDefined();
    expect(schemas.MacroIndicatorEnvelope).toBeDefined();
    expect(schemas.PortfolioOverviewContextEnvelope).toBeDefined();

    const planned = (openApiDocument as any)[
      'x-uht-planned-readonly-contracts'
    ];
    expect(planned['/portfolio/{id}/data-freshness'].status).toBe('reserved');
    expect(planned['/source-health']).toBeUndefined();
  });
});
