import { buildMacroHistory, MacroIndicatorSnapshotLike } from '../macroHistory';

const sourceTime = new Date('2026-04-25T01:00:00.000Z');

function row(
  overrides: Partial<MacroIndicatorSnapshotLike>
): MacroIndicatorSnapshotLike {
  return {
    date: '2026-04-24',
    indicatorId: 'DXY',
    value: 105,
    unit: 'index',
    sourceId: 'fred-macro',
    sourceTime,
    status: 'SUCCESS',
    ...overrides,
  };
}

describe('buildMacroHistory', () => {
  it('returns annual-window macro records and latest values for the current adapter catalog', () => {
    const result = buildMacroHistory({
      year: 2026,
      requestedDate: '2026-04-25',
      maxStaleDays: 70,
      rows: [
        row({ date: '2025-12-31', value: 99 }),
        row({ date: '2026-01-02', value: 101 }),
        row({ date: '2026-04-24', value: 106 }),
        row({
          date: '2026-03-01',
          indicatorId: 'US_CPI',
          value: 312.3,
          unit: 'index_1982_1984_100',
        }),
        row({
          date: '2026-03-01',
          indicatorId: 'CN_CPI',
          value: 101.2,
        }),
      ],
    });

    expect(result.window).toEqual({
      year: 2026,
      start_date: '2026-01-01',
      end_date: '2026-04-25',
    });
    expect(result.records.map((record) => record.indicator_id)).toEqual([
      'DXY',
      'US_CPI',
      'DXY',
    ]);
    expect(result.latest_values.DXY).toEqual(
      expect.objectContaining({
        date: '2026-04-24',
        value: 106,
        source_time: '2026-04-25T01:00:00.000Z',
      })
    );
    expect(result.latest_values.US_CPI).toEqual(
      expect.objectContaining({ date: '2026-03-01', value: 312.3 })
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'macro_indicator_unsupported' }),
        expect.objectContaining({
          code: 'macro_indicator_missing',
          details: expect.objectContaining({ indicator_id: 'US_PMI' }),
        }),
        expect.objectContaining({
          code: 'macro_indicator_missing',
          details: expect.objectContaining({ indicator_id: 'US_POLICY_RATE' }),
        }),
      ])
    );
  });

  it('warns when latest macro facts are stale or do not carry usable values', () => {
    const result = buildMacroHistory({
      year: 2026,
      requestedDate: '2026-04-25',
      maxStaleDays: 30,
      rows: [
        row({
          date: '2026-03-01',
          indicatorId: 'US_CPI',
          value: 312.3,
          unit: 'index_1982_1984_100',
        }),
        row({
          date: '2026-04-01',
          indicatorId: 'US_PMI',
          value: null,
          unit: 'index',
          status: 'MISSING',
          errorSummary: 'Missing value for US_PMI on 2026-04-01',
        }),
        row({
          date: '2026-04-01',
          indicatorId: 'US_POLICY_RATE',
          value: 4.4,
          unit: 'percent',
          status: 'STALE',
          errorSummary: 'Latest US_POLICY_RATE observation is stale',
        }),
      ],
    });

    expect(result.latest_values.US_CPI).toEqual(
      expect.objectContaining({ value: 312.3 })
    );
    expect(result.latest_values.US_PMI).toBeNull();
    expect(result.latest_values.US_POLICY_RATE).toEqual(
      expect.objectContaining({ value: 4.4, status: 'STALE' })
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'macro_indicator_stale',
          details: expect.objectContaining({ indicator_id: 'US_CPI' }),
        }),
        expect.objectContaining({
          code: 'macro_indicator_unavailable',
          details: expect.objectContaining({ indicator_id: 'US_PMI' }),
        }),
        expect.objectContaining({
          code: 'macro_indicator_stale',
          details: expect.objectContaining({ indicator_id: 'US_POLICY_RATE' }),
        }),
      ])
    );
  });

  it('clamps the requested end to the natural year and does not daily-fill macro observations', () => {
    const result = buildMacroHistory({
      year: 2026,
      requestedDate: '2027-02-01',
      rows: [
        row({ date: '2026-12-15', value: 110 }),
        row({ date: '2027-01-01', value: 111 }),
      ],
      indicatorIds: ['DXY'],
    });

    expect(result.window.end_date).toBe('2026-12-31');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual(
      expect.objectContaining({ date: '2026-12-15', value: 110 })
    );
  });
});
