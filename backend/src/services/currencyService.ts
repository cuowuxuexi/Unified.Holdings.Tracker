// backend/src/services/currencyService.ts

import axios from 'axios';
import schedule from 'node-schedule';
import { dataService } from './dataService';

// 汇率数据文件路径
const RATES_FILE = 'market/rates.json';

type RateInfo = {
  rate: number;
  timestamp: string;
};

type RateCache = {
  [pair: string]: RateInfo | null;
};

const PAIRS = ['USD-CNY', 'HKD-CNY'];

let rateCache: RateCache = {};

/**
 * 从Frankfurter API获取汇率数据
 * 支持USD-CNY和HKD-CNY
 * API文档: https://www.frankfurter.app/docs/
 * 示例: https://api.frankfurter.app/latest?from=USD&to=CNY
 */
async function fetchExternalRate(pair: string): Promise<number | null> {
  try {
    const [from, to] = pair.split('-');
    // 仅支持USD-CNY和HKD-CNY
    if (!((from === 'USD' || from === 'HKD') && to === 'CNY')) {
      console.warn(`[fetchExternalRate] 不支持的货币对: ${pair}`);
      return null;
    }
    const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
    const response = await axios.get(url);
    if (response.data && response.data.rates && typeof response.data.rates[to] === 'number') {
      return response.data.rates[to];
    } else {
      console.error(`[fetchExternalRate] API响应格式异常:`, response.data);
      return null;
    }
  } catch (error) {
    console.error(`[fetchExternalRate] 获取${pair}汇率失败:`, error);
    return null;
  }
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
        console.warn(`[currencyService] ${pair} 外部汇率获取失败，保留本地缓存`);
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
  getExchangeRateForAssetToCNY
};