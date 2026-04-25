import { Router, Request, Response, NextFunction } from 'express';
import { fetchQuotes, fetchKline } from '../services/tencentApi';
import { Quote, KlinePoint } from '../types';

const router = Router();

type ApiContractWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
type ApiContractError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
type InvalidCodeDiagnostic = { code: string; reason: string };
type CodeParseResult =
  | { ok: true; code: string }
  | { ok: false; invalid: InvalidCodeDiagnostic };
type CodeDiagnostics = {
  requested: string[];
  valid: string[];
  invalid: InvalidCodeDiagnostic[];
};

const KLINE_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const FQ_TYPES = ['qfq', 'hfq', 'none'] as const;
const MIN_KLINE_COUNT = 1;
const MAX_KLINE_COUNT = 1000;
type KlinePeriod = (typeof KLINE_PERIODS)[number];
type FqType = (typeof FQ_TYPES)[number];

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function wantsEnvelope(req: Request): boolean {
  const value = queryString(req.query.envelope);
  return value === 'true' || value === '1' || value === 'yes';
}

function makeEnvelope<T>(
  data: T | null,
  meta: Record<string, unknown>,
  warnings: ApiContractWarning[] = [],
  errors: ApiContractError[] = []
) {
  return {
    data,
    meta: {
      source: 'uht.market',
      generated_at: new Date().toISOString(),
      ...meta,
    },
    warnings,
    errors,
  };
}

function sendValidationError(
  res: Response,
  envelope: boolean,
  message: string,
  errors: ApiContractError[],
  meta: Record<string, unknown> = {}
): void {
  res
    .status(400)
    .json(
      envelope
        ? makeEnvelope(null, meta, [], errors)
        : { error: message, errors }
    );
}

function normalizeMarketCode(rawCode: string): CodeParseResult {
  const trimmed = rawCode.trim();
  if (!trimmed)
    return { ok: false, invalid: { code: rawCode, reason: 'empty_code' } };
  if (/^hkHSI$/i.test(trimmed)) return { ok: true, code: 'hkHSI' };
  const cnMatch = /^(sh|sz)(\d{6})$/i.exec(trimmed);
  if (cnMatch)
    return { ok: true, code: `${cnMatch[1].toLowerCase()}${cnMatch[2]}` };
  const hkMatch = /^hk(\d{5})$/i.exec(trimmed);
  if (hkMatch) return { ok: true, code: `hk${hkMatch[1]}` };
  const usMatch = /^us([A-Za-z][A-Za-z0-9.]{0,15})$/.exec(trimmed);
  if (usMatch) return { ok: true, code: `us${usMatch[1].toUpperCase()}` };
  return {
    ok: false,
    invalid: {
      code: rawCode,
      reason:
        'unsupported_format: expected sh/sz + 6 digits, hk + 5 digits, hkHSI, or us + ticker',
    },
  };
}

function parseCodeList(codesQuery: string): CodeDiagnostics {
  const requested = codesQuery.split(',').map((code) => code.trim());
  const validSet = new Set<string>();
  const invalid: InvalidCodeDiagnostic[] = [];
  for (const requestedCode of requested) {
    const parsed = normalizeMarketCode(requestedCode);
    if (parsed.ok) validSet.add(parsed.code);
    else invalid.push(parsed.invalid);
  }
  return { requested, valid: Array.from(validSet), invalid };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function parseKlinePeriod(value: string | undefined): KlinePeriod | null {
  if (!value) return 'daily';
  return KLINE_PERIODS.includes(value as KlinePeriod)
    ? (value as KlinePeriod)
    : null;
}

function parseFqType(value: string | undefined): FqType | null {
  if (!value) return 'qfq';
  return FQ_TYPES.includes(value as FqType) ? (value as FqType) : null;
}

function parseCount(value: string | undefined): number | null {
  if (!value) return 400;
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= MIN_KLINE_COUNT && count <= MAX_KLINE_COUNT ? count : null;
}

function setDiagnosticsHeaders(
  res: Response,
  requested: string[],
  found: string[],
  missing: string[],
  invalid: InvalidCodeDiagnostic[]
): void {
  res.setHeader('X-UHT-Requested-Codes', requested.join(','));
  res.setHeader('X-UHT-Found-Codes', found.join(','));
  res.setHeader('X-UHT-Missing-Codes', missing.join(','));
  res.setHeader(
    'X-UHT-Invalid-Codes',
    invalid.map(({ code }) => code).join(',')
  );
}

function buildDiagnosticWarnings(
  missing: string[],
  invalid: InvalidCodeDiagnostic[]
): ApiContractWarning[] {
  const warnings: ApiContractWarning[] = [];
  if (missing.length > 0) {
    warnings.push({
      code: 'market_data_missing',
      message: 'Some requested valid codes did not return market data.',
      details: { missing },
    });
  }
  if (invalid.length > 0) {
    warnings.push({
      code: 'invalid_codes_ignored',
      message:
        'Some requested codes were invalid and were not sent to the market data source.',
      details: { invalid },
    });
  }
  return warnings;
}

// GET /api/market/quote?codes=sh600519,hk00700
router.get(
  '/quote',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const envelope = wantsEnvelope(req);
    const codesQuery = queryString(req.query.codes);
    if (!codesQuery) {
      sendValidationError(
        res,
        envelope,
        'Missing required query parameter: codes',
        [
          {
            code: 'missing_codes',
            message:
              'Query parameter codes is required and must be comma-separated market codes.',
          },
        ]
      );
      return;
    }

    const diagnostics = parseCodeList(codesQuery);
    if (diagnostics.valid.length === 0) {
      sendValidationError(
        res,
        envelope,
        'No valid market codes in query parameter: codes',
        [
          {
            code: 'invalid_codes',
            message:
              'All requested codes failed market code format validation.',
            details: { invalid: diagnostics.invalid },
          },
        ],
        {
          requested: diagnostics.requested,
          found: [],
          missing: [],
          invalid: diagnostics.invalid,
        }
      );
      return;
    }

    const quotes: Quote[] = await fetchQuotes(diagnostics.valid);
    const found = diagnostics.valid.filter((code) =>
      quotes.some((quote) => quote.code === code)
    );
    const missing = diagnostics.valid.filter((code) => !found.includes(code));
    setDiagnosticsHeaders(
      res,
      diagnostics.requested,
      found,
      missing,
      diagnostics.invalid
    );

    if (!envelope) {
      res.json(quotes);
      return;
    }

    res.json(
      makeEnvelope(
        {
          requested: diagnostics.requested,
          found,
          missing,
          invalid: diagnostics.invalid,
          quotes,
        },
        {
          requested: diagnostics.requested,
          found,
          missing,
          invalid: diagnostics.invalid,
          source: 'tencent.quote',
        },
        buildDiagnosticWarnings(missing, diagnostics.invalid)
      )
    );
  })
);

// GET /api/market/kline?code=sh600519&period=daily&fq=qfq
router.get(
  '/kline',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const envelope = wantsEnvelope(req);
    const rawCode = queryString(req.query.code);
    if (!rawCode) {
      sendValidationError(
        res,
        envelope,
        'Missing required query parameter: code',
        [{ code: 'missing_code', message: 'Query parameter code is required.' }]
      );
      return;
    }

    const parsedCode = normalizeMarketCode(rawCode);
    if (!parsedCode.ok) {
      sendValidationError(
        res,
        envelope,
        'Invalid market code format',
        [
          {
            code: 'invalid_code',
            message: 'The requested market code failed format validation.',
            details: { invalid: [parsedCode.invalid] },
          },
        ],
        {
          requested: [rawCode],
          found: [],
          missing: [],
          invalid: [parsedCode.invalid],
        }
      );
      return;
    }

    const period = parseKlinePeriod(queryString(req.query.period));
    if (!period) {
      sendValidationError(res, envelope, 'Invalid query parameter: period', [
        {
          code: 'invalid_period',
          message: `Query parameter period must be one of: ${KLINE_PERIODS.join(', ')}`,
        },
      ]);
      return;
    }

    const startDate = queryString(req.query.startDate);
    const endDate = queryString(req.query.endDate);
    for (const [name, value] of [
      ['startDate', startDate],
      ['endDate', endDate],
    ] as const) {
      if (value && !isValidDateOnly(value)) {
        sendValidationError(res, envelope, `Invalid query parameter: ${name}`, [
          {
            code: 'invalid_date',
            message: `Query parameter ${name} must be a real calendar date in YYYY-MM-DD format.`,
            details: { [name]: value },
          },
        ]);
        return;
      }
    }

    if (startDate && endDate && startDate > endDate) {
      sendValidationError(res, envelope, 'Invalid date range', [
        {
          code: 'invalid_date_range',
          message:
            'Query parameter startDate must be earlier than or equal to endDate.',
          details: { startDate, endDate },
        },
      ]);
      return;
    }

    const fq = parseFqType(queryString(req.query.fq));
    if (!fq) {
      sendValidationError(res, envelope, 'Invalid query parameter: fq', [
        {
          code: 'invalid_fq',
          message: `Query parameter fq must be one of: ${FQ_TYPES.join(', ')}`,
        },
      ]);
      return;
    }

    const count = parseCount(queryString(req.query.count));
    if (count === null) {
      sendValidationError(res, envelope, 'Invalid query parameter: count', [
        {
          code: 'invalid_count',
          message: `Query parameter count must be an integer between ${MIN_KLINE_COUNT} and ${MAX_KLINE_COUNT}.`,
        },
      ]);
      return;
    }

    const klineData: KlinePoint[] = await fetchKline(
      parsedCode.code,
      period,
      startDate,
      endDate,
      fq,
      count
    );
    const found = klineData.length > 0 ? [parsedCode.code] : [];
    const missing = klineData.length > 0 ? [] : [parsedCode.code];
    setDiagnosticsHeaders(res, [rawCode], found, missing, []);

    if (!envelope) {
      res.json(klineData);
      return;
    }

    res.json(
      makeEnvelope(
        {
          requested: [rawCode],
          found,
          missing,
          invalid: [],
          points: klineData,
        },
        {
          requested: [rawCode],
          found,
          missing,
          invalid: [],
          period,
          count,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          fq,
          source: 'tencent.kline',
        },
        buildDiagnosticWarnings(missing, [])
      )
    );
  })
);

export default router;
