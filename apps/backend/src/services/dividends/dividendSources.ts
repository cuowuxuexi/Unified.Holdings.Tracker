import {
  DividendCurrency,
  DividendEvent,
  DividendMarket,
  DividendWarning,
} from './types';

/**
 * 分红数据源：东方财富（2026-10-21 在 guonei 出口实测可用）
 * - A 股个股：datacenter-web RPT_SHAREBONUS_DET（每 10 股税前派现、股权登记日、除权除息日；派息日即除息日）
 * - 场内基金：fundf10 fhsp_{code}.html（权益登记日、除息日、每 10 份派现、分红发放日）
 * - 港股：datacenter RPT_HKF10_MAIN_DIVBASIC（方案文字「每股派港币X元」、除净日、派息日）
 * - 美股：datacenter RPT_USF10_INFO_DIVIDEND（方案文字「每1股派X美元股息」、除息日、派息日）
 */

export const DIVIDEND_SOURCE_ID = 'eastmoney-dividend';

export type DividendHttpGet = (url: string) => Promise<string>;

export interface ParsedDividends {
  events: DividendEvent[];
  warnings: DividendWarning[];
}

interface AShareBonusRow {
  ASSIGN_PROGRESS?: string | null;
  PRETAX_BONUS_RMB?: number | null;
  BONUS_IT_RATIO?: number | null;
  EQUITY_RECORD_DATE?: string | null;
  EX_DIVIDEND_DATE?: string | null;
  IMPL_PLAN_PROFILE?: string | null;
}

interface HkDividendRow {
  IS_BFP?: string | null;
  EX_DIVIDEND_DATE?: string | null;
  DIVIDEND_DATE?: string | null;
  PLAN_EXPLAIN?: string | null;
  YEAR?: string | null;
  REPORT_TYPE?: string | null;
}

interface UsDividendRow {
  ASSIGN_TYPE?: string | null;
  EX_DIVIDEND_DATE?: string | null;
  EQUITY_RECORD_DATE?: string | null;
  BONUS_PAY_DATE?: string | null;
  PLAN_EXPLAIN?: string | null;
}

interface EastmoneyDataResponse<T> {
  success?: boolean;
  message?: string;
  result?: { data?: T[] } | null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15_000;

const CURRENCY_WORDS: Record<string, DividendCurrency> = {
  港币: 'HKD',
  港元: 'HKD',
  美元: 'USD',
  人民币: 'CNY',
};

/** "2026/05/15" / "2026-05-15 00:00:00" → "2026-05-15" */
export function normalizeSourceDate(value?: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function parseAShareDividendRows(
  assetCode: string,
  rows: AShareBonusRow[]
): ParsedDividends {
  const events: DividendEvent[] = [];
  for (const row of rows) {
    // 只取已实施方案；预案、股东大会通过但未实施的除权日未定
    if (row.ASSIGN_PROGRESS !== '实施分配') continue;
    const exDate = normalizeSourceDate(row.EX_DIVIDEND_DATE);
    if (!exDate) continue;
    const cashPer10 = Number(row.PRETAX_BONUS_RMB ?? 0);
    const bonusPer10 = Number(row.BONUS_IT_RATIO ?? 0);
    if (!(cashPer10 > 0) && !(bonusPer10 > 0)) continue;
    events.push({
      assetCode,
      market: 'CN',
      exDate,
      recordDate: normalizeSourceDate(row.EQUITY_RECORD_DATE),
      // 沪深两市现金红利发放日与除息日为同一天
      payDate: exDate,
      cashPerShare: cashPer10 > 0 ? cashPer10 / 10 : 0,
      currency: 'CNY',
      description: row.IMPL_PLAN_PROFILE ?? `10派${cashPer10}元`,
      bonusSharesPerShare: bonusPer10 > 0 ? bonusPer10 / 10 : null,
      sourceId: DIVIDEND_SOURCE_ID,
    });
  }
  return { events, warnings: [] };
}

export function parseFundDividendHtml(
  assetCode: string,
  html: string
): ParsedDividends {
  const events: DividendEvent[] = [];
  const rowPattern =
    /<td>\d{4}年<\/td><td>(\d{4}-\d{2}-\d{2})<\/td><td>(\d{4}-\d{2}-\d{2})<\/td><td>(每10份派现金([\d.]+)元)<\/td><td>(\d{4}-\d{2}-\d{2})<\/td>/g;
  for (const match of html.matchAll(rowPattern)) {
    const cashPer10 = Number(match[4]);
    if (!(cashPer10 > 0)) continue;
    events.push({
      assetCode,
      market: 'CN',
      exDate: match[2],
      recordDate: match[1],
      payDate: match[5],
      cashPerShare: cashPer10 / 10,
      currency: 'CNY',
      description: match[3],
      bonusSharesPerShare: null,
      sourceId: DIVIDEND_SOURCE_ID,
    });
  }
  return { events, warnings: [] };
}

/**
 * 解析港股派息方案文字。港股常以人民币/美元宣派、按公告汇率以港币支付，
 * 「相当于港币X元」即港币账户实际到账口径，优先采用；否则用宣派币种。
 * 多个现金组成部分（如末期息 + 特别息）同币种时相加，币种混杂则放弃自动解析。
 */
export function parseHkPlanExplain(
  text: string
): { cashPerShare: number; currency: DividendCurrency } | null {
  const hkdEquivalents = [...text.matchAll(/相当于港[币元]\s*([\d.]+)\s*元/g)];
  if (hkdEquivalents.length > 0) {
    const total = hkdEquivalents.reduce((sum, m) => sum + Number(m[1]), 0);
    return total > 0 ? { cashPerShare: total, currency: 'HKD' } : null;
  }

  const declared = [
    ...text.matchAll(/(港币|港元|美元|人民币)\s*([\d.]+)\s*元/g),
  ];
  if (declared.length === 0) return null;
  const currencies = new Set(declared.map((m) => CURRENCY_WORDS[m[1]]));
  if (currencies.size !== 1) return null;
  const total = declared.reduce((sum, m) => sum + Number(m[2]), 0);
  return total > 0
    ? { cashPerShare: total, currency: [...currencies][0] }
    : null;
}

export function parseHkDividendRows(
  assetCode: string,
  rows: HkDividendRow[]
): ParsedDividends {
  const events: DividendEvent[] = [];
  const warnings: DividendWarning[] = [];
  for (const row of rows) {
    // IS_BFP=1：该期「未派发或宣派股息」
    if (row.IS_BFP !== '0') continue;
    const exDate = normalizeSourceDate(row.EX_DIVIDEND_DATE);
    if (!exDate) continue;
    const text = row.PLAN_EXPLAIN ?? '';
    const parsed = parseHkPlanExplain(text);
    if (!parsed) {
      warnings.push({
        code: 'dividend_plan_unparsed',
        assetCode,
        message: `${assetCode} 除净日 ${exDate} 的派息方案无法自动解析：${text || '（空）'}`,
      });
      continue;
    }
    events.push({
      assetCode,
      market: 'HK',
      exDate,
      recordDate: null,
      payDate: normalizeSourceDate(row.DIVIDEND_DATE),
      cashPerShare: parsed.cashPerShare,
      currency: parsed.currency,
      description: [row.YEAR, row.REPORT_TYPE, text].filter(Boolean).join(' '),
      bonusSharesPerShare: null,
      sourceId: DIVIDEND_SOURCE_ID,
    });
  }
  return { events, warnings };
}

export function parseUsDividendRows(
  assetCode: string,
  rows: UsDividendRow[]
): ParsedDividends {
  const events: DividendEvent[] = [];
  const warnings: DividendWarning[] = [];
  for (const row of rows) {
    if (row.ASSIGN_TYPE && row.ASSIGN_TYPE !== 'Cash') continue;
    const exDate = normalizeSourceDate(row.EX_DIVIDEND_DATE);
    if (!exDate) continue;
    const text = row.PLAN_EXPLAIN ?? '';
    // 「每1股派0.27美元股息」「每1份ADR派1.05美元股息」
    const match =
      /每\s*([\d.]+)\s*(?:股|份ADR|份ADS|份)派\s*([\d.]+)\s*美元/.exec(text);
    const unit = match ? Number(match[1]) : 0;
    const amount = match ? Number(match[2]) : 0;
    if (!(unit > 0) || !(amount > 0)) {
      warnings.push({
        code: 'dividend_plan_unparsed',
        assetCode,
        message: `${assetCode} 除息日 ${exDate} 的派息方案无法自动解析：${text || '（空）'}`,
      });
      continue;
    }
    events.push({
      assetCode,
      market: 'US',
      exDate,
      recordDate: normalizeSourceDate(row.EQUITY_RECORD_DATE),
      payDate: normalizeSourceDate(row.BONUS_PAY_DATE),
      cashPerShare: amount / unit,
      currency: 'USD',
      description: text,
      bonusSharesPerShare: null,
      sourceId: DIVIDEND_SOURCE_ID,
    });
  }
  return { events, warnings };
}

export function getDividendMarket(assetCode: string): DividendMarket | null {
  const prefix = assetCode.slice(0, 2).toLowerCase();
  if (prefix === 'sh' || prefix === 'sz') return 'CN';
  if (prefix === 'hk') return 'HK';
  if (prefix === 'us') return 'US';
  return null;
}

/** 沪市 5 开头、深市 15/16/18 开头为场内基金（ETF/LOF/REITs） */
export function isChinaExchangeFund(assetCode: string): boolean {
  const prefix = assetCode.slice(0, 2).toLowerCase();
  const code = assetCode.slice(2);
  if (prefix === 'sh') return code.startsWith('5');
  if (prefix === 'sz') return /^1[568]/.test(code);
  return false;
}

function buildEastmoneyUrl(
  base: string,
  params: Record<string, string>
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function getEastmoneyRows<T>(
  httpGet: DividendHttpGet,
  url: string
): Promise<T[]> {
  const payload = JSON.parse(await httpGet(url)) as EastmoneyDataResponse<T>;
  // 无分红记录的标的返回 success=false「返回数据为空」，按空列表处理
  return payload.result?.data ?? [];
}

export async function fetchDividendEvents(
  assetCode: string,
  httpGet: DividendHttpGet = defaultHttpGet
): Promise<ParsedDividends> {
  const market = getDividendMarket(assetCode);
  const code = assetCode.slice(2);
  if (market === 'CN' && isChinaExchangeFund(assetCode)) {
    const html = await httpGet(
      `https://fundf10.eastmoney.com/fhsp_${encodeURIComponent(code)}.html`
    );
    return parseFundDividendHtml(assetCode, html);
  }
  if (market === 'CN') {
    const rows = await getEastmoneyRows<AShareBonusRow>(
      httpGet,
      buildEastmoneyUrl(
        'https://datacenter-web.eastmoney.com/api/data/v1/get',
        {
          reportName: 'RPT_SHAREBONUS_DET',
          columns: 'ALL',
          filter: `(SECURITY_CODE="${code}")`,
          pageNumber: '1',
          pageSize: '50',
          sortColumns: 'EX_DIVIDEND_DATE',
          sortTypes: '-1',
          source: 'WEB',
          client: 'WEB',
        }
      )
    );
    return parseAShareDividendRows(assetCode, rows);
  }
  if (market === 'HK') {
    const rows = await getEastmoneyRows<HkDividendRow>(
      httpGet,
      buildEastmoneyUrl(
        'https://datacenter.eastmoney.com/securities/api/data/v1/get',
        {
          reportName: 'RPT_HKF10_MAIN_DIVBASIC',
          columns: 'ALL',
          filter: `(SECURITY_CODE="${code}")`,
          pageNumber: '1',
          pageSize: '50',
          sortColumns: 'NOTICE_DATE',
          sortTypes: '-1',
          source: 'F10',
          client: 'PC',
        }
      )
    );
    return parseHkDividendRows(assetCode, rows);
  }
  if (market === 'US') {
    const rows = await getEastmoneyRows<UsDividendRow>(
      httpGet,
      buildEastmoneyUrl(
        'https://datacenter.eastmoney.com/securities/api/data/v1/get',
        {
          reportName: 'RPT_USF10_INFO_DIVIDEND',
          columns: 'ALL',
          filter: `(SECURITY_CODE="${code.toUpperCase()}")`,
          pageNumber: '1',
          pageSize: '50',
          sortColumns: 'EX_DIVIDEND_DATE',
          sortTypes: '-1',
          source: 'SECURITIES',
          client: 'PC',
        }
      )
    );
    return parseUsDividendRows(assetCode, rows);
  }
  return { events: [], warnings: [] };
}

const defaultHttpGet: DividendHttpGet = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${new URL(url).hostname}`);
  }
  return response.text();
};
