import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  M2DataRepository,
  MacroIndicatorSnapshotQuery,
  MacroIndicatorSnapshotRecord,
  SourceHealthRecord,
  SourceRunRecord,
  UpsertMacroIndicatorSnapshotInput,
  UpsertSourceHealthInput,
  UpsertSourceRunInput,
  UpsertYieldCurveSnapshotInput,
  YieldCurveSnapshotQuery,
  YieldCurveSnapshotRecord,
} from '@uht/domain';
import { prisma as defaultPrisma } from '../database/prisma-client';

export class PrismaM2DataRepository implements M2DataRepository {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async upsertSourceRun(input: UpsertSourceRunInput): Promise<SourceRunRecord> {
    const record = await this.prisma.sourceRun.upsert({
      where: { runKey: input.runKey },
      create: {
        runKey: input.runKey,
        sourceId: input.sourceId,
        domain: input.domain,
        job: input.job ?? null,
        targetDate: input.targetDate ?? null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
        status: input.status,
        rowsWritten: input.rowsWritten ?? 0,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        payloadHash: input.payloadHash ?? null,
      },
      update: {
        sourceId: input.sourceId,
        domain: input.domain,
        job: input.job ?? null,
        targetDate: input.targetDate ?? null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
        status: input.status,
        rowsWritten: input.rowsWritten ?? 0,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        payloadHash: input.payloadHash ?? null,
      },
    });

    return mapSourceRun(record);
  }

  async upsertSourceHealth(
    input: UpsertSourceHealthInput
  ): Promise<SourceHealthRecord> {
    const record = await this.prisma.sourceHealth.upsert({
      where: {
        sourceId_domain: {
          sourceId: input.sourceId,
          domain: input.domain,
        },
      },
      create: {
        sourceId: input.sourceId,
        domain: input.domain,
        status: input.status,
        checkedAt: input.checkedAt,
        lastSuccessAt: input.lastSuccessAt ?? null,
        lastFailureAt: input.lastFailureAt ?? null,
        consecutiveFailures: input.consecutiveFailures ?? 0,
        latencyMs: input.latencyMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
      update: {
        status: input.status,
        checkedAt: input.checkedAt,
        lastSuccessAt: input.lastSuccessAt ?? null,
        lastFailureAt: input.lastFailureAt ?? null,
        consecutiveFailures: input.consecutiveFailures ?? 0,
        latencyMs: input.latencyMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
    });

    return mapSourceHealth(record);
  }

  async upsertYieldCurveSnapshot(
    input: UpsertYieldCurveSnapshotInput
  ): Promise<YieldCurveSnapshotRecord> {
    const record = await this.prisma.yieldCurveSnapshot.upsert({
      where: {
        date_country_tenor_sourceId: {
          date: input.date,
          country: input.country,
          tenor: input.tenor,
          sourceId: input.sourceId,
        },
      },
      create: {
        date: input.date,
        country: input.country,
        tenor: input.tenor,
        yieldPercent: toNullableDecimal(input.yieldPercent),
        sourceId: input.sourceId,
        sourceTime: input.sourceTime ?? null,
        status: input.status,
        errorSummary: input.errorSummary ?? null,
        payloadHash: input.payloadHash ?? null,
      },
      update: {
        yieldPercent: toNullableDecimal(input.yieldPercent),
        sourceTime: input.sourceTime ?? null,
        status: input.status,
        errorSummary: input.errorSummary ?? null,
        payloadHash: input.payloadHash ?? null,
      },
    });

    return mapYieldCurveSnapshot(record);
  }

  async listYieldCurveSnapshots(
    query: YieldCurveSnapshotQuery
  ): Promise<YieldCurveSnapshotRecord[]> {
    const where: Prisma.YieldCurveSnapshotWhereInput = {
      date: dateWindow(query.dateFrom, query.dateTo),
      country: query.country,
      tenor: query.tenors ? { in: query.tenors } : undefined,
      sourceId: query.sourceId,
      status: query.status,
    };

    const records = await this.prisma.yieldCurveSnapshot.findMany({
      where,
      orderBy: [{ date: 'asc' }, { country: 'asc' }, { tenor: 'asc' }],
    });

    return records.map(mapYieldCurveSnapshot);
  }

  async upsertMacroIndicatorSnapshot(
    input: UpsertMacroIndicatorSnapshotInput
  ): Promise<MacroIndicatorSnapshotRecord> {
    const record = await this.prisma.macroIndicatorSnapshot.upsert({
      where: {
        date_indicatorId_sourceId: {
          date: input.date,
          indicatorId: input.indicatorId,
          sourceId: input.sourceId,
        },
      },
      create: {
        date: input.date,
        indicatorId: input.indicatorId,
        value: toNullableDecimal(input.value),
        unit: input.unit ?? null,
        sourceId: input.sourceId,
        sourceTime: input.sourceTime ?? null,
        status: input.status,
        errorSummary: input.errorSummary ?? null,
        payloadHash: input.payloadHash ?? null,
      },
      update: {
        value: toNullableDecimal(input.value),
        unit: input.unit ?? null,
        sourceTime: input.sourceTime ?? null,
        status: input.status,
        errorSummary: input.errorSummary ?? null,
        payloadHash: input.payloadHash ?? null,
      },
    });

    return mapMacroIndicatorSnapshot(record);
  }

  async listMacroIndicatorSnapshots(
    query: MacroIndicatorSnapshotQuery
  ): Promise<MacroIndicatorSnapshotRecord[]> {
    const where: Prisma.MacroIndicatorSnapshotWhereInput = {
      date: dateWindow(query.dateFrom, query.dateTo),
      indicatorId: query.indicatorIds ? { in: query.indicatorIds } : undefined,
      sourceId: query.sourceId,
      status: query.status,
    };

    const records = await this.prisma.macroIndicatorSnapshot.findMany({
      where,
      orderBy: [{ indicatorId: 'asc' }, { date: 'asc' }],
    });

    return records.map(mapMacroIndicatorSnapshot);
  }
}

function dateWindow(
  dateFrom: string | undefined,
  dateTo: string | undefined
): Prisma.StringFilter | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return {
    gte: dateFrom,
    lte: dateTo,
  };
}

function toNullableDecimal(value: number | undefined): Decimal | null {
  return value === undefined ? null : new Decimal(value);
}

function decimalToOptionalNumber(value: Decimal | null): number | undefined {
  return value === null ? undefined : value.toNumber();
}

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function mapSourceRun(
  record: Prisma.SourceRunGetPayload<object>
): SourceRunRecord {
  return {
    id: record.id,
    runKey: record.runKey,
    sourceId: record.sourceId,
    domain: record.domain,
    job: nullToUndefined(record.job),
    targetDate: nullToUndefined(record.targetDate),
    startedAt: record.startedAt,
    finishedAt: nullToUndefined(record.finishedAt),
    status: record.status,
    rowsWritten: record.rowsWritten,
    errorCode: nullToUndefined(record.errorCode),
    errorMessage: nullToUndefined(record.errorMessage),
    payloadHash: nullToUndefined(record.payloadHash),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapSourceHealth(
  record: Prisma.SourceHealthGetPayload<object>
): SourceHealthRecord {
  return {
    id: record.id,
    sourceId: record.sourceId,
    domain: record.domain,
    status: record.status,
    checkedAt: record.checkedAt,
    lastSuccessAt: nullToUndefined(record.lastSuccessAt),
    lastFailureAt: nullToUndefined(record.lastFailureAt),
    consecutiveFailures: record.consecutiveFailures,
    latencyMs: nullToUndefined(record.latencyMs),
    errorCode: nullToUndefined(record.errorCode),
    errorMessage: nullToUndefined(record.errorMessage),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapYieldCurveSnapshot(
  record: Prisma.YieldCurveSnapshotGetPayload<object>
): YieldCurveSnapshotRecord {
  return {
    id: record.id,
    date: record.date,
    country: record.country,
    tenor: record.tenor,
    yieldPercent: decimalToOptionalNumber(record.yieldPercent),
    sourceId: record.sourceId,
    sourceTime: nullToUndefined(record.sourceTime),
    status: record.status,
    errorSummary: nullToUndefined(record.errorSummary),
    payloadHash: nullToUndefined(record.payloadHash),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapMacroIndicatorSnapshot(
  record: Prisma.MacroIndicatorSnapshotGetPayload<object>
): MacroIndicatorSnapshotRecord {
  return {
    id: record.id,
    date: record.date,
    indicatorId: record.indicatorId,
    value: decimalToOptionalNumber(record.value),
    unit: nullToUndefined(record.unit),
    sourceId: record.sourceId,
    sourceTime: nullToUndefined(record.sourceTime),
    status: record.status,
    errorSummary: nullToUndefined(record.errorSummary),
    payloadHash: nullToUndefined(record.payloadHash),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
