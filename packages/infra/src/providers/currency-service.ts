import axios from 'axios';
import schedule from 'node-schedule';
import { dataService } from '../data/data-service';

// 汇率数据文件路径
const RATES_FILE = 'market/rates.json';
const FRANKFURTER_API_BASE = 'https://api.frankfurter.dev/v1';
const FRANKFURTER_TIMEOUT_MS = 10_000;

const PAIRS = ['USD-CNY', 'HKD-CNY'] as const;

export type SupportedFxPair = (typeof PAIRS)[number];

type RateInfo = {
  rate: number;
  timestamp: string;
};

type RateCache = {
  [pair: string]: RateInfo | null;
};

export type HistoricalRateRecord = {
  date: string;
  pair: SupportedFxPair;
  rate: number | null;
  timestamp: string;
};

export type FrankfurterHttpClient = (input: {
  url: string;
  signal?: AbortSignal;
  timeoutMs: number;
}) => Promise<unknown>;

export type FetchExchangeRatesHistoryRequest = {
  pairs?: readonly SupportedFxPair[];
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
  client?: FrankfurterHttpClient;
};

let rateCache: RateCache = {};

const defaultFrankfurterHttpClient: FrankfurterHttpClient = async ({
  url,
  signal,
  timeoutMs,
}) => {
  const response = await axios.get(url, {
    signal,
    timeout: timeoutMs,
  });
  return response.data;
};

/**
 * 从Frankfurter API获取汇率数据
 * 支持USD-CNY和HKD-CNY
 * API文档: https://frankfurter.dev/v1/
 * 示例:
 * - latest: https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY
 * - exact-date: https://api.frankfurter.dev/v1/2026-04-24?base=USD&symbols=CNY
 * - date-range: https://api.frankfurter.dev/v1/2026-04-23..2026-04-24?base=USD&symbols=CNY
 */
async function fetchExternalRate(pair: string): Promise<number | null> {
  try {
    const [record] = await fetchExchangeRatesHistory({
      pairs: [toSupportedPair(pair)],
    });
    return record?.rate ?? null;
  } catch (error) {
    console.error(`[fetchExternalRate] 获取${pair}汇率失败:`, error);
    return null;
  }
}

export async function fetchExchangeRateOnDate(
  pair: SupportedFxPair,
  date: string,
  request: Omit<FetchExchangeRatesHistoryRequest, 'pairs' | 'date'> = {}
): Promise<HistoricalRateRecord | null> {
  const [record] = await fetchExchangeRatesHistory({
    ...request,
    pairs: [pair],
    date,
  });
  return record ?? null;
}

export async function fetchExchangeRatesHistory(
  request: FetchExchangeRatesHistoryRequest = {}
): Promise<HistoricalRateRecord[]> {
  const pairs = request.pairs?.length
    ? request.pairs
    : ([...PAIRS] as SupportedFxPair[]);
  const timestamp = (request.now ?? (() => new Date()))().toISOString();
  const client = request.client ?? defaultFrankfurterHttpClient;
  const timeoutMs = request.timeoutMs ?? FRANKFURTER_TIMEOUT_MS;
  const path = buildFrankfurterPath(request);

  const payloads = await Promise.all(
    pairs.map(async (pair) => {
      const { base, quote } = splitPair(pair);
      const payload = await client({
        url: `${FRANKFURTER_API_BASE}/${path}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`,
        signal: request.signal,
        timeoutMs,
      });

      return parseFrankfurterPayload(pair, quote, payload, timestamp);
    })
  );

  return payloads.flat().sort(compareHistoricalRateRecords);
}

function splitPair(pair: SupportedFxPair): { base: string; quote: string } {
  const [base, quote] = pair.split('-');
  if (!((base === 'USD' || base === 'HKD') && quote === 'CNY')) {
    throw new Error(`Unsupported FX pair: ${pair}`);
  }
  return { base, quote };
}

function toSupportedPair(pair: string): SupportedFxPair {
  if (pair === 'USD-CNY' || pair === 'HKD-CNY') {
    return pair;
  }
  throw new Error(`Unsupported FX pair: ${pair}`);
}

function buildFrankfurterPath(
  request: Pick<
    FetchExchangeRatesHistoryRequest,
    'date' | 'dateFrom' | 'dateTo'
  >
): string {
  if (request.date && (request.dateFrom || request.dateTo)) {
    throw new Error(
      'FX history request must use either date or dateFrom/dateTo, not both'
    );
  }

  if (request.date) {
    return request.date;
  }

  if (request.dateFrom || request.dateTo) {
    if (!request.dateFrom || !request.dateTo) {
      throw new Error(
        'FX history date-range requests require both dateFrom and dateTo'
      );
    }
    return `${request.dateFrom}..${request.dateTo}`;
  }

  return 'latest';
}

function parseFrankfurterPayload(
  pair: SupportedFxPair,
  quote: string,
  payload: unknown,
  timestamp: string
): HistoricalRateRecord[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const data = payload as {
    date?: string;
    rates?: Record<string, unknown>;
  };

  const rates = data.rates;
  if (!rates || typeof rates !== 'object') {
    return [];
  }

  const firstValue = Object.values(rates)[0];
  if (
    firstValue &&
    typeof firstValue === 'object' &&
    !Array.isArray(firstValue)
  ) {
    return Object.entries(rates).map(([date, quoteRates]) => ({
      date,
      pair,
      rate: parseRate((quoteRates as Record<string, unknown>)[quote]),
      timestamp,
    }));
  }

  if (!data.date) {
    return [];
  }

  return [
    {
      date: data.date,
      pair,
      rate: parseRate(rates[quote]),
      timestamp,
    },
  ];
}

function parseRate(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function compareHistoricalRateRecords(
  left: HistoricalRateRecord,
  right: HistoricalRateRecord
): number {
  return (
    left.date.localeCompare(right.date) || left.pair.localeCompare(right.pair)
  );
}

/**
 * 加载本地持久化汇率文件到内存缓存
 */
async function loadRatesFromFile() {
  try {
    // 使用数据服务读取汇率文件
    rateCache = dataService.readJsonFile<RateCache>(RATES_FILE, {});
    console.info('[currencyService] 汇率文件加载成功:', rateCache);
  } catch (err) {
    console.error('[currencyService] 加载汇率文件失败:', err);
    // 解析失败或其他错误，全部置为 null
    for (const pair of PAIRS) {
      rateCache[pair] = null;
    }
  }
}

/**
 * 持久化当前内存缓存到文件
 */
function saveRatesToFile() {
  try {
    // 使用数据服务写入汇率文件
    const success = dataService.writeJsonFile(RATES_FILE, rateCache);
    if (success) {
      console.info('[currencyService] 汇率已写入文件');
    } else {
      console.error('[currencyService] 写入汇率文件失败');
    }
  } catch (err) {
    console.error('[currencyService] 写入汇率文件失败:', err);
  }
}

/**
 * 启动时初始化汇率（加载本地+尝试更新）
 */
export async function initExchangeRates() {
  await loadRatesFromFile();

  for (const pair of PAIRS) {
    try {
      const rate = await fetchExternalRate(pair);
      if (typeof rate === 'number' && !isNaN(rate)) {
        const now = new Date().toISOString();
        rateCache[pair] = { rate, timestamp: now };
        console.info(`[currencyService] ${pair} 外部汇率获取成功:`, rate);
      } else {
        console.warn(
          `[currencyService] ${pair} 外部汇率获取失败，保留本地缓存`
        );
        // 若本地无缓存，保持为 null
      }
    } catch (err) {
      console.error(`[currencyService] ${pair} 外部汇率获取异常:`, err);
      // 若本地无缓存，保持为 null
    }
  }

  saveRatesToFile();
}

/**
 * 运行时获取汇率，仅查内存缓存
 * 支持两种调用方式：
 * 1. getExchangeRate('USD-CNY') - 直接传入货币对
 * 2. getExchangeRate('USD', 'CNY') - 传入源货币和目标货币
 */
export function getExchangeRate(from: string, to?: string): number | null {
  // 如果传入两个参数，则构建pair字符串
  const pair = to ? `${from}-${to}` : from;

  // 如果是CNY到CNY的汇率，直接返回1
  if (pair === 'CNY-CNY') {
    return 1;
  }

  const info = rateCache[pair];
  if (info && typeof info.rate === 'number') {
    return info.rate;
  }
  return null;
}

/**
 * 根据资产代码获取对CNY的汇率
 * 对于不同市场的资产，返回不同的汇率：
 * - 中国A股(sh/sz开头): 返回1(人民币)
 * - 香港股票(hk开头): 返回港币兑人民币汇率
 * - 美股(us开头): 返回美元兑人民币汇率
 */
export function getExchangeRateForAssetToCNY(assetCode: string): number {
  // 获取资产的市场前缀(sh, sz, hk, us等)
  const prefix = assetCode.substring(0, 2).toLowerCase();

  // 根据前缀确定汇率
  if (prefix === 'sh' || prefix === 'sz') {
    // 中国A股，使用人民币，汇率为1
    return 1;
  } else if (prefix === 'hk') {
    // 香港股票，需要港币兑人民币汇率
    const hkdRate = getExchangeRate('HKD-CNY');
    if (hkdRate !== null) {
      return hkdRate;
    }
    // 如果没有找到汇率，返回默认值
    console.warn('HKD-CNY exchange rate not found, using default 0.9');
    return 0.9; // 默认港币兑人民币汇率
  } else if (prefix === 'us') {
    // 美股，需要美元兑人民币汇率
    const usdRate = getExchangeRate('USD-CNY');
    if (usdRate !== null) {
      return usdRate;
    }
    // 如果没有找到汇率，返回默认值
    console.warn('USD-CNY exchange rate not found, using default 7.2');
    return 7.2; // 默认美元兑人民币汇率
  }

  // 对于未知的资产代码前缀，返回1
  console.warn(`Unknown asset code prefix: ${prefix}, using exchange rate 1`);
  return 1;
}

/**
 * 可选：获取带时间戳的汇率信息
 */
export function getExchangeRateInfo(pair: string): RateInfo | null {
  return rateCache[pair] || null;
}

// === 每日定时任务：每天凌晨1点自动刷新汇率 ===
schedule.scheduleJob('0 1 * * *', async () => {
  console.info('[currencyService] 定时任务触发：开始每日自动刷新汇率');
  await initExchangeRates();
});

export default {
  initExchangeRates,
  getExchangeRate,
  getExchangeRateInfo,
  getExchangeRateForAssetToCNY,
  fetchExchangeRateOnDate,
  fetchExchangeRatesHistory,
};
