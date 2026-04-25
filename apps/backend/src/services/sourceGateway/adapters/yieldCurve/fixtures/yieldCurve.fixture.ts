import { RawYieldCurveResponse } from '../types';

export const completeYieldCurveFixture: RawYieldCurveResponse = {
  sourceTime: '2026-04-25T08:30:00.000Z',
  points: [
    { date: '2026-04-25', country: 'CN', tenor: '2Y', yieldPercent: 1.62 },
    { date: '2026-04-25', country: 'CN', tenor: '5Y', yieldPercent: 1.83 },
    { date: '2026-04-25', country: 'CN', tenor: '10Y', yieldPercent: 2.12 },
    { date: '2026-04-25', country: 'CN', tenor: '30Y', yieldPercent: 2.38 },
    { date: '2026-04-25', country: 'US', tenor: '2Y', yieldPercent: 4.79 },
    { date: '2026-04-25', country: 'US', tenor: '5Y', yieldPercent: 4.52 },
    { date: '2026-04-25', country: 'US', tenor: '10Y', yieldPercent: 4.31 },
    { date: '2026-04-25', country: 'US', tenor: '30Y', yieldPercent: 4.77 },
  ],
};

export const missingTenorFixture: RawYieldCurveResponse = {
  sourceTime: '2026-04-25T08:30:00.000Z',
  points: completeYieldCurveFixture.points.filter(
    (point) => !(point.country === 'CN' && point.tenor === '30Y')
  ),
};

export const staleYieldCurveFixture: RawYieldCurveResponse = {
  sourceTime: '2026-04-20T08:30:00.000Z',
  points: completeYieldCurveFixture.points.map((point) => ({
    ...point,
    date: '2026-04-20',
    sourceTime: '2026-04-20T08:30:00.000Z',
  })),
};
