import {
  BasisPointChangeInput,
  BasisPointChangeResult,
  CnUsTenYearSpreadInput,
  YieldCurveRecord,
  YieldCurveSpreadInput,
} from './types';

export function calculateTenYearTwoYearSpreadBp(
  input: YieldCurveSpreadInput
): number {
  return toBasisPoints(input.tenYearYieldPercent - input.twoYearYieldPercent);
}

export function calculateCnUsTenYearSpreadBp(
  input: CnUsTenYearSpreadInput
): number {
  return toBasisPoints(
    input.cnTenYearYieldPercent - input.usTenYearYieldPercent
  );
}

export function calculateBasisPointChanges(
  input: BasisPointChangeInput
): BasisPointChangeResult {
  return {
    change7dBp:
      input.prior7dYieldPercent === undefined
        ? undefined
        : toBasisPoints(input.currentYieldPercent - input.prior7dYieldPercent),
    change30dBp:
      input.prior30dYieldPercent === undefined
        ? undefined
        : toBasisPoints(input.currentYieldPercent - input.prior30dYieldPercent),
  };
}

export function findYieldCurveRecord(
  records: YieldCurveRecord[],
  country: YieldCurveRecord['country'],
  tenor: YieldCurveRecord['tenor']
): YieldCurveRecord | undefined {
  return records.find(
    (record) =>
      record.country === country &&
      record.tenor === tenor &&
      record.status === 'SUCCESS'
  );
}

function toBasisPoints(percentDelta: number): number {
  return Math.round(percentDelta * 10_000) / 100;
}
