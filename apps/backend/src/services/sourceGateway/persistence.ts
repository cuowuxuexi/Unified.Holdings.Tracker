import { M2DataRepository } from '@uht/domain';
import { MacroIndicatorSnapshot, YieldCurveRecord } from './adapters';

export async function persistYieldCurveSnapshots(
  repository: M2DataRepository,
  records: YieldCurveRecord[]
): Promise<number> {
  for (const record of records) {
    await repository.upsertYieldCurveSnapshot({
      date: record.date,
      country: record.country,
      tenor: record.tenor,
      yieldPercent: record.yieldPercent,
      sourceId: record.sourceId,
      sourceTime: parseOptionalDate(record.sourceTime),
      status: record.status,
      errorSummary: record.errorSummary,
    });
  }

  return records.length;
}

export async function persistMacroIndicatorSnapshots(
  repository: M2DataRepository,
  records: MacroIndicatorSnapshot[]
): Promise<number> {
  for (const record of records) {
    await repository.upsertMacroIndicatorSnapshot({
      date: record.date,
      indicatorId: record.indicatorId,
      value: record.value,
      unit: record.unit,
      sourceId: record.sourceId,
      sourceTime: record.sourceTime,
      status: record.status,
      errorSummary: record.errorSummary,
    });
  }

  return records.length;
}

function parseOptionalDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
