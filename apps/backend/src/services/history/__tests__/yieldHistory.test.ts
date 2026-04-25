import { buildYieldHistory, YieldCurveSnapshotLike } from '../yieldHistory';

const SOURCE_TIME = new Date('2026-04-25T08:30:00.000Z');

function curveRow(
  date: string,
  country: 'CN' | 'US',
  tenor: '2Y' | '5Y' | '10Y' | '30Y',
  yieldPercent: number
): YieldCurveSnapshotLike {
  return {
    date,
    country,
    tenor,
    yieldPercent,
    sourceId: `${country.toLowerCase()}-yield-source`,
    sourceTime: SOURCE_TIME,
    status: 'SUCCESS',
  };
}

describe('buildYieldHistory', () => {
  it('returns annual-window CN/US yield records, latest curve and required spreads', () => {
    const result = buildYieldHistory({
      year: 2026,
      requestedEnd: '2026-04-25',
      rows: [
        curveRow('2025-12-31', 'US', '10Y', 4.2),
        curveRow('2026-04-20', 'US', '10Y', 4.2),
        curveRow('2026-04-25', 'CN', '2Y', 1.72),
        curveRow('2026-04-25', 'CN', '5Y', 1.9),
        curveRow('2026-04-25', 'CN', '10Y', 2.12),
        curveRow('2026-04-25', 'CN', '30Y', 2.48),
        curveRow('2026-04-25', 'US', '2Y', 4.79),
        curveRow('2026-04-25', 'US', '5Y', 4.4),
        curveRow('2026-04-25', 'US', '10Y', 4.31),
        curveRow('2026-04-25', 'US', '30Y', 4.66),
        curveRow('2027-01-01', 'CN', '10Y', 2.4),
        {
          date: '2026-04-25',
          country: 'JP',
          tenor: '10Y',
          yieldPercent: 1.1,
          status: 'SUCCESS',
        },
      ],
    });

    expect(result.window).toEqual({
      year: 2026,
      start: '2026-01-01',
      end: '2026-04-25',
    });
    expect(result.records).toHaveLength(9);
    expect(result.latest_curve).toMatchObject({
      latest_date: '2026-04-25',
      records: expect.arrayContaining([
        expect.objectContaining({
          date: '2026-04-25',
          country: 'CN',
          tenor: '10Y',
          yieldPercent: 2.12,
          sourceTime: '2026-04-25T08:30:00.000Z',
        }),
        expect.objectContaining({
          date: '2026-04-25',
          country: 'US',
          tenor: '10Y',
          yieldPercent: 4.31,
        }),
      ]),
    });
    expect(result.spreads).toEqual({
      us_10y_2y_bp: -48,
      cn_10y_2y_bp: 40,
      cn_us_10y_bp: -219,
    });
    expect(result.warnings).toEqual([]);
  });

  it('returns yield_curve_missing warning when required country/tenor points are absent or diagnostic-only', () => {
    const result = buildYieldHistory({
      year: 2026,
      requestedEnd: '2026-04-25',
      rows: [
        curveRow('2026-04-25', 'CN', '2Y', 1.72),
        curveRow('2026-04-25', 'CN', '5Y', 1.9),
        curveRow('2026-04-25', 'CN', '10Y', 2.12),
        {
          date: '2026-04-25',
          country: 'CN',
          tenor: '30Y',
          sourceId: 'akshare-yield-source',
          status: 'MISSING',
          errorSummary: 'Missing CN 30Y yield curve value',
        },
        curveRow('2026-04-25', 'US', '2Y', 4.79),
        curveRow('2026-04-25', 'US', '10Y', 4.31),
      ],
    });

    expect(result.spreads).toEqual({
      us_10y_2y_bp: -48,
      cn_10y_2y_bp: 40,
      cn_us_10y_bp: -219,
    });
    expect(result.warnings).toEqual([
      {
        code: 'yield_curve_missing',
        message:
          'Yield curve history is missing one or more required CN/US tenor records in the annual window.',
        details: {
          window_start: '2026-01-01',
          window_end: '2026-04-25',
          missing: [
            { country: 'CN', tenor: '30Y' },
            { country: 'US', tenor: '5Y' },
            { country: 'US', tenor: '30Y' },
          ],
        },
      },
    ]);
  });

  it('clips requests after year-end to the requested annual window', () => {
    const result = buildYieldHistory({
      year: 2026,
      requestedEnd: '2027-01-10',
      countries: ['US'],
      tenors: ['10Y'],
      rows: [
        curveRow('2026-12-31', 'US', '10Y', 4.1),
        curveRow('2027-01-02', 'US', '10Y', 4.2),
      ],
    });

    expect(result.window.end).toBe('2026-12-31');
    expect(result.records).toEqual([
      expect.objectContaining({ date: '2026-12-31', yieldPercent: 4.1 }),
    ]);
    expect(result.latest_curve.records).toEqual([
      expect.objectContaining({ date: '2026-12-31', yieldPercent: 4.1 }),
    ]);
  });
});
