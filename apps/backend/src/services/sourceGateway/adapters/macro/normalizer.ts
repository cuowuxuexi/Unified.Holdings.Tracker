import { toSourceError } from '../../errors';
import { SourceError } from '../../types';
import { getMacroIndicatorDefinition } from './catalog';
import {
  FredObservationResponse,
  MacroIndicatorId,
  MacroIndicatorSnapshot,
} from './types';

export interface NormalizeMacroIndicatorOptions {
  indicatorId: MacroIndicatorId;
  sourceId: string;
  asOfDate?: string;
  maxStaleDays?: number;
}

export function normalizeFredObservations(
  payload: unknown,
  options: NormalizeMacroIndicatorOptions
): { records: MacroIndicatorSnapshot[]; error?: SourceError } {
  const response = payload as FredObservationResponse;
  const definition = getMacroIndicatorDefinition(options.indicatorId);

  if (response.error_code || response.error_message) {
    return {
      records: [],
      error: toSourceError(
        options.sourceId,
        'SOURCE_FAILURE',
        response.error_message ?? `FRED returned error ${response.error_code}`,
        true
      ),
    };
  }

  if (!Array.isArray(response.observations)) {
    return {
      records: [],
      error: toSourceError(
        options.sourceId,
        'SOURCE_EMPTY_DATA',
        `FRED response for ${options.indicatorId} did not include observations`,
        false
      ),
    };
  }

  const records = response.observations.map((observation) => {
    const parsedValue = parseFredValue(observation.value);
    const sourceTime = parseSourceTime(
      observation.realtime_end ?? observation.realtime_start
    );
    const stale = isStale(
      observation.date,
      options.asOfDate,
      options.maxStaleDays
    );

    if (parsedValue === undefined) {
      return {
        date: observation.date,
        indicatorId: options.indicatorId,
        unit: definition.unit,
        sourceId: options.sourceId,
        sourceTime,
        status: 'MISSING' as const,
        errorSummary: `Missing value for ${options.indicatorId} on ${observation.date}`,
      };
    }

    if (stale) {
      return {
        date: observation.date,
        indicatorId: options.indicatorId,
        value: parsedValue,
        unit: definition.unit,
        sourceId: options.sourceId,
        sourceTime,
        status: 'STALE' as const,
        errorSummary: `Latest ${options.indicatorId} observation is stale as of ${options.asOfDate}`,
      };
    }

    return {
      date: observation.date,
      indicatorId: options.indicatorId,
      value: parsedValue,
      unit: definition.unit,
      sourceId: options.sourceId,
      sourceTime,
      status: 'SUCCESS' as const,
    };
  });

  return { records };
}

function parseFredValue(value: string): number | undefined {
  if (value === '.' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSourceTime(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isStale(
  observationDate: string,
  asOfDate?: string,
  maxStaleDays?: number
): boolean {
  if (!asOfDate || maxStaleDays === undefined) return false;
  const observed = Date.parse(`${observationDate}T00:00:00.000Z`);
  const asOf = Date.parse(`${asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(observed) || Number.isNaN(asOf)) return false;
  const ageDays = Math.floor((asOf - observed) / 86_400_000);
  return ageDays > maxStaleDays;
}
