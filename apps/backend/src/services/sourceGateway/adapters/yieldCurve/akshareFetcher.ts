import { spawn } from 'child_process';
import {
  YieldCurveBridgeRequest,
  YieldCurveBridgeRunner,
  YieldCurveFetcher,
  YieldCurveFetcherResponse,
  YieldCurveRequest,
  YIELD_CURVE_COUNTRIES,
  YIELD_CURVE_TENORS,
} from './types';

const DEFAULT_HISTORY_LOOKBACK_DAYS = 35;
const DEFAULT_PYTHON_COMMAND =
  process.env.UHT_YIELD_CURVE_PYTHON_BIN ?? 'python3';

const AKSHARE_YIELD_CURVE_BRIDGE_SCRIPT = String.raw`
import json
import math
import sys
from datetime import datetime, timezone

try:
    import akshare as ak
except ModuleNotFoundError as exc:
    print(json.dumps({
        "ok": False,
        "errorCode": "SOURCE_NOT_CONFIGURED",
        "error": f"Python runtime dependency missing: {exc.name}",
        "retryable": False,
    }, ensure_ascii=False))
    sys.exit(0)
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "errorCode": "SOURCE_EXCEPTION",
        "error": f"Failed to import akshare bridge dependency: {exc}",
        "retryable": False,
    }, ensure_ascii=False))
    sys.exit(0)

COLUMN_BY_KEY = {
    ("CN", "2Y"): "中国国债收益率2年",
    ("CN", "5Y"): "中国国债收益率5年",
    ("CN", "10Y"): "中国国债收益率10年",
    ("CN", "30Y"): "中国国债收益率30年",
    ("US", "2Y"): "美国国债收益率2年",
    ("US", "5Y"): "美国国债收益率5年",
    ("US", "10Y"): "美国国债收益率10年",
    ("US", "30Y"): "美国国债收益率30年",
}

def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def normalize_date(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("/", "-")
    if " " in text:
        text = text.split(" ")[0]
    return text

def normalize_number(value):
    if value is None:
        return None
    try:
        if hasattr(value, "item"):
            value = value.item()
    except Exception:
        pass
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
    try:
        number = float(value)
    except Exception:
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number

def fail(error_code, message, retryable):
    print(json.dumps({
        "ok": False,
        "errorCode": error_code,
        "error": message,
        "retryable": retryable,
    }, ensure_ascii=False))

def main():
    request = json.loads(sys.argv[1])
    as_of_date = request["asOfDate"]
    start_date = request["startDate"].replace("-", "")
    countries = request["countries"]
    tenors = request["tenors"]
    df = ak.bond_zh_us_rate(start_date=start_date)
    source_time = iso_now()

    if df is None or getattr(df, "empty", False):
        print(json.dumps({
            "ok": True,
            "data": {
                "sourceTime": source_time,
                "points": [],
            },
        }, ensure_ascii=False))
        return

    records = df.to_dict(orient="records")
    selected_row = None
    selected_date = None

    for row in records:
        row_date = normalize_date(row.get("日期"))
        if row_date is None or row_date > as_of_date:
            continue
        if selected_date is None or row_date > selected_date:
            selected_date = row_date
            selected_row = row

    if selected_row is None or selected_date is None:
        print(json.dumps({
            "ok": True,
            "data": {
                "sourceTime": source_time,
                "points": [],
            },
        }, ensure_ascii=False))
        return

    requested_columns = [
        COLUMN_BY_KEY[(country, tenor)]
        for country in countries
        for tenor in tenors
        if (country, tenor) in COLUMN_BY_KEY
    ]
    if requested_columns and not any(column in selected_row for column in requested_columns):
        fail(
            "SOURCE_FAILURE",
            "AkShare bond_zh_us_rate response is missing requested yield columns",
            True,
        )
        return

    points = []
    for country in countries:
        for tenor in tenors:
            column = COLUMN_BY_KEY.get((country, tenor))
            if column is None:
                continue
            points.append({
                "date": selected_date,
                "country": country,
                "tenor": tenor,
                "yieldPercent": normalize_number(selected_row.get(column)),
                "sourceTime": source_time,
            })

    print(json.dumps({
        "ok": True,
        "data": {
            "sourceTime": source_time,
            "points": points,
        },
    }, ensure_ascii=False))

try:
    main()
except Exception as exc:
    fail("SOURCE_FAILURE", f"AkShare yield curve fetch failed: {exc}", True)
`;

export interface AkshareYieldCurveFetcherOptions {
  pythonCommand?: string;
  lookbackDays?: number;
  runner?: YieldCurveBridgeRunner;
}

export function createAkshareYieldCurveFetcher(
  options: AkshareYieldCurveFetcherOptions = {}
): YieldCurveFetcher {
  const pythonCommand = options.pythonCommand ?? DEFAULT_PYTHON_COMMAND;
  const runner = options.runner ?? runAkshareYieldCurveBridge;

  return async (
    request: YieldCurveRequest,
    init: { signal: AbortSignal }
  ): Promise<YieldCurveFetcherResponse> => {
    const bridgeRequest = buildYieldCurveBridgeRequest(
      request,
      options.lookbackDays ?? DEFAULT_HISTORY_LOOKBACK_DAYS
    );

    return runner(bridgeRequest, {
      signal: init.signal,
      pythonCommand,
    });
  };
}

export function buildYieldCurveBridgeRequest(
  request: YieldCurveRequest,
  lookbackDays: number
): YieldCurveBridgeRequest {
  const countries = request.countries ?? [...YIELD_CURVE_COUNTRIES];
  const tenors = request.tenors ?? [...YIELD_CURVE_TENORS];
  const effectiveLookbackDays = Math.max(
    lookbackDays,
    (request.staleAfterDays ?? 2) + 7
  );

  return {
    asOfDate: request.asOfDate,
    startDate: shiftIsoDate(request.asOfDate, -effectiveLookbackDays),
    countries: [...countries],
    tenors: [...tenors],
  };
}

export async function runAkshareYieldCurveBridge(
  request: YieldCurveBridgeRequest,
  init: { signal: AbortSignal; pythonCommand: string }
): Promise<YieldCurveFetcherResponse> {
  if (init.signal.aborted) {
    return {
      ok: false,
      errorCode: 'SOURCE_EXCEPTION',
      error: 'Yield curve bridge aborted before execution',
      retryable: true,
    };
  }

  return new Promise<YieldCurveFetcherResponse>((resolve) => {
    const child = spawn(
      init.pythonCommand,
      ['-c', AKSHARE_YIELD_CURVE_BRIDGE_SCRIPT, JSON.stringify(request)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (response: YieldCurveFetcherResponse) => {
      if (settled) return;
      settled = true;
      init.signal.removeEventListener('abort', abortChild);
      resolve(response);
    };

    const abortChild = () => {
      child.kill('SIGTERM');
      finish({
        ok: false,
        errorCode: 'SOURCE_EXCEPTION',
        error: 'Yield curve bridge aborted',
        retryable: true,
      });
    };

    init.signal.addEventListener('abort', abortChild, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      finish({
        ok: false,
        errorCode: 'SOURCE_NOT_CONFIGURED',
        error: `Python bridge unavailable: ${error.message}`,
        retryable: false,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      const payload = stdout.trim();

      if (!payload) {
        finish({
          ok: false,
          errorCode: 'SOURCE_EXCEPTION',
          error:
            stderr.trim() ||
            `Yield curve bridge exited with code ${code ?? 'unknown'} and no JSON payload`,
          retryable: false,
        });
        return;
      }

      try {
        const parsed = JSON.parse(payload) as YieldCurveFetcherResponse;
        if (typeof parsed.ok !== 'boolean') {
          throw new Error('missing ok boolean');
        }
        if (parsed.ok) {
          finish({
            ok: true,
            data: parsed.data,
            statusCode: parsed.statusCode ?? 200,
          });
          return;
        }

        finish({
          ok: false,
          statusCode: parsed.statusCode,
          errorCode: parsed.errorCode ?? 'SOURCE_EXCEPTION',
          error:
            parsed.error ??
            (stderr.trim() ||
              `Yield curve bridge exited with code ${code ?? 'unknown'}`),
          retryable:
            parsed.retryable ?? parsed.errorCode !== 'SOURCE_NOT_CONFIGURED',
        });
      } catch (error) {
        finish({
          ok: false,
          errorCode: 'SOURCE_EXCEPTION',
          error:
            stderr.trim() ||
            `Invalid yield curve bridge JSON: ${
              error instanceof Error ? error.message : String(error)
            }`,
          retryable: false,
        });
      }
    });
  });
}

function shiftIsoDate(date: string, deltaDays: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) {
    return date;
  }

  return new Date(parsed + deltaDays * 86_400_000).toISOString().slice(0, 10);
}
