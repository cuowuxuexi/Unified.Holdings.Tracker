import {
  RawYieldCurveResponse,
  YieldCurveCountry,
  YieldCurveRecord,
  YieldCurveRequest,
  YieldCurveTenor,
  YIELD_CURVE_COUNTRIES,
  YIELD_CURVE_TENORS,
} from './types';

export function normalizeYieldCurveResponse(
  raw: RawYieldCurveResponse,
  request: YieldCurveRequest,
  sourceId: string
): YieldCurveRecord[] {
  const countries = request.countries ?? [...YIELD_CURVE_COUNTRIES];
  const tenors = request.tenors ?? [...YIELD_CURVE_TENORS];
  const pointsByKey = new Map<string, (typeof raw.points)[number]>();

  for (const point of raw.points) {
    pointsByKey.set(curveKey(point.country, point.tenor), point);
  }

  return countries.flatMap((country) =>
    tenors.map((tenor) => {
      const point = pointsByKey.get(curveKey(country, tenor));
      if (
        !point ||
        point.yieldPercent === undefined ||
        point.yieldPercent === null
      ) {
        return {
          date: request.asOfDate,
          country,
          tenor,
          sourceId,
          sourceTime: raw.sourceTime,
          status: 'MISSING',
          errorSummary: `Missing ${country} ${tenor} yield curve value`,
        } satisfies YieldCurveRecord;
      }

      const stale = isStale(
        point.date,
        request.asOfDate,
        request.staleAfterDays ?? 2
      );
      return {
        date: point.date,
        country,
        tenor,
        yieldPercent: point.yieldPercent,
        sourceId,
        sourceTime: point.sourceTime ?? raw.sourceTime,
        status: stale ? 'STALE' : 'SUCCESS',
        errorSummary: stale
          ? `Stale ${country} ${tenor} yield curve value from ${point.date}`
          : undefined,
      } satisfies YieldCurveRecord;
    })
  );
}

export function normalizeYieldCurveSourceFailure(
  request: YieldCurveRequest,
  sourceId: string,
  errorSummary: string
): YieldCurveRecord[] {
  const countries = request.countries ?? [...YIELD_CURVE_COUNTRIES];
  const tenors = request.tenors ?? [...YIELD_CURVE_TENORS];

  return countries.flatMap((country) =>
    tenors.map(
      (tenor): YieldCurveRecord => ({
        date: request.asOfDate,
        country,
        tenor,
        sourceId,
        status: 'SOURCE_FAILED',
        errorSummary,
      })
    )
  );
}

function curveKey(country: YieldCurveCountry, tenor: YieldCurveTenor): string {
  return `${country}:${tenor}`;
}

function isStale(
  date: string,
  asOfDate: string,
  staleAfterDays: number
): boolean {
  const pointTime = Date.parse(`${date}T00:00:00.000Z`);
  const asOfTime = Date.parse(`${asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(pointTime) || Number.isNaN(asOfTime)) return false;
  const ageDays = (asOfTime - pointTime) / 86_400_000;
  return ageDays > staleAfterDays;
}
