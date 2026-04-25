import { InvalidCodeDiagnostic, MarketCodeDiagnostics } from './types';

interface CodeParseSuccess {
  ok: true;
  code: string;
}

interface CodeParseFailure {
  ok: false;
  invalid: InvalidCodeDiagnostic;
}

type CodeParseResult = CodeParseSuccess | CodeParseFailure;

export function normalizeMarketCode(rawCode: string): CodeParseResult {
  const trimmed = rawCode.trim();
  if (!trimmed) {
    return { ok: false, invalid: { code: rawCode, reason: 'empty_code' } };
  }

  if (/^hkHSI$/i.test(trimmed)) return { ok: true, code: 'hkHSI' };

  const cnMatch = /^(sh|sz)(\d{6})$/i.exec(trimmed);
  if (cnMatch) {
    return { ok: true, code: `${cnMatch[1].toLowerCase()}${cnMatch[2]}` };
  }

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

export function parseMarketCodeList(codes: string[]): MarketCodeDiagnostics {
  const requested = codes.map((code) => code.trim());
  const validSet = new Set<string>();
  const invalid: InvalidCodeDiagnostic[] = [];

  for (const requestedCode of requested) {
    const parsed = normalizeMarketCode(requestedCode);
    if (parsed.ok) validSet.add(parsed.code);
    else invalid.push(parsed.invalid);
  }

  return { requested, valid: Array.from(validSet), invalid };
}
