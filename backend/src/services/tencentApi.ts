import axios from 'axios';
import iconv from 'iconv-lite';
// Import calculation service and types
import {
  calculateIndexPeriodChanges,
  getYearBasePrice, 
  getMonthBasePrice, 
  getWeekBasePrice
} from './calculationService';
import { KlinePoint, Quote } from '../types'; // Import KlinePoint from central types
import { subYears, formatISO } from 'date-fns'; // Import date-fns functions needed

// Removed local Quote interface definition

// Removed local KlinePoint definition as it's imported now
const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/q=';

/**
 * 解析腾讯 API 返回的单条行情数据字符串
 * @param line - 单条行情数据字符串，例如 v_sh600519="1~贵州茅台~600519~1634.00~..."
 * @returns 解析后的 Quote 对象或 null (如果解析失败)
 */
function parseQuoteLine(line: string): Quote | null {
  if (!line || !line.trim()) return null;

  const parts = line.split('=');
  if (parts.length < 2) return null;

  const codeWithPrefix = parts[0].replace('v_', '').trim(); // 如 sh600519, hk00700, usAAPL
  const dataString = parts[1].replace(/"/g, '').trim(); // 去掉引号
  const dataParts = dataString.split('~');

  if (dataParts.length < 5) return null; // 基础数据不足

  try {
    const quote: Partial<Quote> = {
      code: codeWithPrefix,
      timestamp: Date.now(), // 暂时使用当前时间戳，后续可考虑解析时间字段
    };

    const market = codeWithPrefix.substring(0, 2); // sh, sz, hk, us

    if (market === 'sh' || market === 'sz') { // A 股
      if (dataParts.length >= 48) { // 确保 A 股数据字段足够
        quote.name = dataParts[1];
        quote.currentPrice = parseFloat(dataParts[3]);
        quote.prevClosePrice = parseFloat(dataParts[4]);
        quote.openPrice = parseFloat(dataParts[5]);
        quote.volume = parseFloat(dataParts[6]); // 单位：手
        // dataParts[7] 是外盘
        quote.highPrice = parseFloat(dataParts[33]);
        quote.lowPrice = parseFloat(dataParts[34]);
        quote.changeAmount = parseFloat(dataParts[31]);
        quote.changePercent = parseFloat(dataParts[32]);
        quote.turnover = parseFloat(dataParts[37]); // 单位：万元
        quote.peRatio = parseFloat(dataParts[39]) || undefined; // 市盈率(动)
        quote.marketCap = parseFloat(dataParts[45]) || undefined; // 总市值 (亿)
        // 时间戳在 dataParts[30] 格式如 20240101150000，可以解析
        const timeStr = dataParts[30];
        if (timeStr && timeStr.length === 14) {
            const year = parseInt(timeStr.substring(0, 4), 10);
            const month = parseInt(timeStr.substring(4, 6), 10) - 1; // 月份从0开始
            const day = parseInt(timeStr.substring(6, 8), 10);
            const hour = parseInt(timeStr.substring(8, 10), 10);
            const minute = parseInt(timeStr.substring(10, 12), 10);
            const second = parseInt(timeStr.substring(12, 14), 10);
            // 注意：这里使用本地时区创建Date对象，腾讯返回的可能是北京时间
            quote.timestamp = new Date(year, month, day, hour, minute, second).getTime();
        }
      } else {
        console.warn(`[parseQuoteLine] Insufficient data fields for A-share quote: ${codeWithPrefix}`);
        return null;
      }
    } else if (market === 'hk') { // 港股

       // 根据再次核对后的正确港股索引进行修正 (2025-04-15)
       if (dataParts.length >= 46) { // 确保港股数据字段足够 (基于最新索引观察)
         quote.name = dataParts[1];
         quote.openPrice = parseFloat(dataParts[5]); // Corrected index: 5 (开盘价)
         quote.prevClosePrice = parseFloat(dataParts[4]); // Corrected index: 4 (昨收价)
         quote.highPrice = parseFloat(dataParts[33]); // 确认索引: 33
         quote.lowPrice = parseFloat(dataParts[34]); // 确认索引: 34
         quote.currentPrice = parseFloat(dataParts[3]); // Corrected index: 3 (当前价)
         quote.volume = parseFloat(dataParts[6]); // Corrected index: 6 (成交量 - 股)
         quote.turnover = parseFloat(dataParts[11]); // 确认索引: 11 (港元)
         quote.changeAmount = parseFloat(dataParts[31]); // 确认索引: 31
         quote.changePercent = parseFloat(dataParts[32]); // 确认索引: 32
         quote.peRatio = parseFloat(dataParts[38]) || undefined; // 确认索引: 38
         quote.marketCap = parseFloat(dataParts[44]) || undefined; // 确认索引: 44 (亿港元?)

         // 时间戳在 dataParts[30] 格式: "YYYY/MM/DD HH:MM:SS"
         const timeStr = dataParts[30]; // 确认索引: 30
         if (timeStr && timeStr.includes('/') && timeStr.includes(':')) { // 检查格式特征
             try {
                 // 尝试解析 YYYY/MM/DD HH:MM:SS 格式
                 // 注意：腾讯返回的可能是香港时间，这里解析为本地时间
                 // Date.parse 可以处理 'YYYY/MM/DD HH:MM:SS'
                 const parsedTimestamp = Date.parse(timeStr);
                 if (!isNaN(parsedTimestamp)) {
                    quote.timestamp = parsedTimestamp;
                 } else {
                    console.warn(`[parseQuoteLine] Failed to parse HK timestamp (NaN): ${timeStr}`);
                 }
             } catch (e) {
                 console.warn(`[parseQuoteLine] Error parsing HK timestamp: ${timeStr}`, e);
                 // 保留默认的 Date.now()
             }
         }
       } else {
         console.warn(`[parseQuoteLine] Insufficient data fields for HK-share quote: ${codeWithPrefix}`);
         return null;
       }
    } else if (market === 'us') { // 美股

      // 根据 v_usAAPL 日志重新映射索引
      if (dataParts.length >= 46) { // 确保美股数据字段足够 (根据日志观察到的长度)
        quote.name = dataParts[1]; // "苹果"
        quote.currentPrice = parseFloat(dataParts[3]); // "202.52"
        quote.prevClosePrice = parseFloat(dataParts[4]); // "198.15"
        quote.openPrice = parseFloat(dataParts[5]); // "211.44"
        quote.volume = parseFloat(dataParts[6]); // "101352911" (单位: 股)
        quote.highPrice = parseFloat(dataParts[33]); // "212.94"
        quote.lowPrice = parseFloat(dataParts[34]); // "201.16"
        quote.changeAmount = parseFloat(dataParts[31]); // "4.37"
        quote.changePercent = parseFloat(dataParts[32]); // "2.21"
        quote.turnover = parseFloat(dataParts[37]); // "20819141533" (单位: 美元?) - 需要确认
        quote.peRatio = parseFloat(dataParts[39]) || undefined; // "32.15"
        quote.marketCap = parseFloat(dataParts[45]) || undefined; // "30405.56540" (单位: 亿?) - 需要确认

        // 时间戳在 dataParts[30] 格式: "2025-04-14 16:00:02"
        const timeStr = dataParts[30];
        if (timeStr && timeStr.includes(' ')) {
            try {
                // 尝试直接解析 YYYY-MM-DD HH:MM:SS 格式
                // 注意：腾讯返回的可能是美东时间，这里解析为本地时间，可能需要时区转换
                quote.timestamp = new Date(timeStr).getTime();
            } catch (e) {
                console.warn(`[parseQuoteLine] Failed to parse US timestamp: ${timeStr}`, e);
                // 保留默认的 Date.now()
            }
        }
      } else {
        console.warn(`[parseQuoteLine] Insufficient data fields for US-share quote: ${codeWithPrefix}`);
        return null;
      }
    } else {
      console.warn(`[parseQuoteLine] Unknown market type for code: ${codeWithPrefix}`);
      return null; // 未知市场类型
    }

    // 基础数据校验
    if (quote.code && quote.name && !isNaN(quote.currentPrice!) && !isNaN(quote.changePercent!) && !isNaN(quote.changeAmount!)) {
      return quote as Quote;
    } else {
      console.warn(`[parseQuoteLine] Failed to parse quote for ${codeWithPrefix}: Invalid or missing essential data after parsing.`);
      return null;
    }

  } catch (parseError) {
    console.error(`[parseQuoteLine] Error parsing quote line for ${codeWithPrefix}:`, parseError, 'Line:', line);
    return null;
  }
}


/**
 * 从腾讯 API 获取实时股票行情数据
 * @param codes - 股票代码数组，例如 ['sh600519', 'hk00700', 'usAAPL']
 * @returns 返回包含 Quote 对象数组的 Promise
 */
// Define known index codes that require period change calculation
const INDEX_CODES_FOR_PERIOD_CHANGE = new Set([
  'sh000001', // 上证指数
  'sz399001', // 深证成指
  'sz399006', // 创业板指
  'sh000688', // 科创50
  'hkHSI',    // 恒生指数
  // Add US indices - need to confirm exact codes used by Tencent quote API vs kline API
  // Assuming quote API uses these, kline mapping might be needed internally in fetchKline
  'usDJI',    // 道琼斯
  'usIXIC',   // 纳斯达克
  'usINX',    // 标普500 (Corrected code)
]);

export async function fetchQuotes(codes: string[]): Promise<Quote[]> {
  if (!codes || codes.length === 0) {
    console.log('[fetchQuotes] Input codes array is empty.');
    return [];
  }

  // 过滤无效代码格式 (简单示例，可根据需要增强)
  const validCodes = codes.filter(code => {
    // 特殊处理恒生指数
    if (code === 'hkHSI') {
      return true; // 恒生指数是有效代码
    }
    // 其他代码格式检查
    return /^(sh|sz|hk)\d+$/.test(code) || /^(us)[A-Z.]+$/.test(code);
  });
  if (validCodes.length === 0) {
      console.log('[fetchQuotes] No valid codes found after filtering.');
      return [];
  }

  const query = validCodes.join(',');
  const url = `${TENCENT_QUOTE_URL}${query}`;
  console.log(`[fetchQuotes] Fetching URL: ${url}`);

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer', // Important for correct encoding handling
      headers: {
        'Referer': 'http://finance.qq.com', // Mimic browser Referer
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000 // 10 seconds timeout
    });

    const decodedBody = iconv.decode(Buffer.from(response.data), 'gb2312');
    const lines = decodedBody.split('\n');
    const parsedQuotes: (Quote | null)[] = lines.map(parseQuoteLine).filter(q => q !== null);

    // Process indices to add period changes using NEW logic
    for (const quote of parsedQuotes) {
      if (quote && quote.currentPrice != null) { // Ensure currentPrice exists
        console.log(`[fetchQuotes] Calculating period changes for index: ${quote.code} using NEW logic`);
        
        const { price: weekBasePrice } = await getWeekBasePrice(quote.code);
        if (weekBasePrice && weekBasePrice !== 0) {
          quote.weekChangePercent = parseFloat((((quote.currentPrice - weekBasePrice) / weekBasePrice) * 100).toFixed(2));
        } else {
          quote.weekChangePercent = undefined; // Or 0, or null depending on desired frontend display
        }

        const { price: monthBasePrice } = await getMonthBasePrice(quote.code);
        if (monthBasePrice && monthBasePrice !== 0) {
          quote.monthChangePercent = parseFloat((((quote.currentPrice - monthBasePrice) / monthBasePrice) * 100).toFixed(2));
        } else {
          quote.monthChangePercent = undefined;
        }

        const { price: yearBasePrice } = await getYearBasePrice(quote.code);
        if (yearBasePrice && yearBasePrice !== 0) {
          quote.yearChangePercent = parseFloat((((quote.currentPrice - yearBasePrice) / yearBasePrice) * 100).toFixed(2));
        } else {
          quote.yearChangePercent = undefined;
        }
        
        console.log(`[fetchQuotes] New Period Changes for ${quote.code}: W=${quote.weekChangePercent}%, M=${quote.monthChangePercent}%, Y=${quote.yearChangePercent}%`);
      }
    }

    console.log(`[fetchQuotes] Successfully fetched and processed ${parsedQuotes.length} quotes.`);
    return parsedQuotes as Quote[]; // Filter out nulls if any step could return them

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[fetchQuotes] Axios error fetching quotes:`, error.message, error.config?.url);
      if (error.response) {
        // Try to decode error response if it's gbk encoded (though less common for errors)
        try {
          const errorBody = iconv.decode(Buffer.from(error.response.data), 'gb2312');
          console.error('[fetchQuotes] Error response data (decoded):', errorBody);
        } catch (decodeError) {
          console.error('[fetchQuotes] Error response data (raw, could not decode):', error.response.data);
        }
      }
    } else {
      console.error('[fetchQuotes] Generic error fetching quotes:', error);
    }
    return [];
  }
}


// K线基础URL，路径会动态调整
const TENCENT_KLINE_BASE_URL = 'https://web.ifzq.gtimg.cn/appstock/app';

/**
 * 从腾讯 API 获取历史 K 线数据
 * @param code - 股票代码，例如 sh600519
 * @param period - 周期: 'daily', 'weekly', 'monthly' (默认 'daily')
 * @param startDate - 开始日期 (YYYY-MM-DD)，可选
 * @param endDate - 结束日期 (YYYY-MM-DD)，可选
 * @param fq - 复权类型: 'qfq' (前复权), 'hfq' (后复权), 'none' (不复权) (默认 'qfq')
 * @param count - 返回的数据点数量，可选 (默认 400)
 * @returns 返回包含 KlinePoint 对象数组的 Promise
 */
export async function fetchKline(
  code: string,
  period: 'daily' | 'weekly' | 'monthly' = 'daily',
  startDate?: string, // YYYY-MM-DD
  endDate?: string,   // YYYY-MM-DD
  fq: 'qfq' | 'hfq' | 'none' = 'qfq', // 前复权, 后复权, 不复权
  count: number = 400 // 默认获取400个数据点
): Promise<KlinePoint[]> {
      // REMOVED: console.log(`[fetchKline ENTRY] code: ${code}, period: ${period}, startDate: ${startDate}, endDate: ${endDate}, fq: ${fq}`);

  // --- K线 URL 和参数构建 ---
  let apiUrlPath: string;
  let processedCode = code; // 处理后的代码，例如美股加后缀
  let effectiveFq = fq; // 使用有效复权类型变量，避免修改原始输入参数

  // 移除 hkHSI 到 hk800000 的映射 (2025-04-16 根据用户反馈)
  // if (code === 'hkHSI') {
  //   processedCode = 'hk800000';
  //   console.log(`[fetchKline] Special handling for HSI: mapped 'hkHSI' to '${processedCode}'`);
  // }

  const market = processedCode.substring(0, 2);
  // **修正**: 将 usINX 添加到已知美股指数集合中
  const knownUSIndices = new Set(['usDJI', 'usIXIC', 'usSPX', 'usINX']);

  // 1. 处理美股代码后缀
  if (market === 'us') {
    // 仅为非已知指数的美股代码添加 .OQ 后缀
    if (!knownUSIndices.has(code) && !processedCode.includes('.')) {
      console.log(`[fetchKline] Adding .OQ suffix for non-index US code: ${code}`);
      processedCode = `${processedCode}.OQ`;
    } else if (knownUSIndices.has(code)) {
      console.log(`[fetchKline] Using original code (no suffix) for known US index: ${code}`);
      // 确保 processedCode 使用原始代码
      processedCode = code;
    }
  }

  // 2. 根据市场、周期和复权类型选择 URL 路径 (基于验证文档 2025-04-16)
  if (market === 'sh' || market === 'sz') {
      apiUrlPath = '/fqkline/get'; // A 股: 支持 qfq, hfq, none (空)
  } else if (market === 'hk') {
      // 港股: 不复权用 /fqkline/get, 复权用 /hkfqkline/get
      if (fq === 'qfq' || fq === 'hfq') {
          apiUrlPath = '/hkfqkline/get';
      } else {
          apiUrlPath = '/fqkline/get'; // 港股不复权
          effectiveFq = 'none'; // 明确设置为 none
      }
  } else if (market === 'us') {
      // 美股: 必须使用 /usfqkline/get 路径和 qfq 复权类型获取历史 K 线
      console.log(`[fetchKline] US market requested for ${code}. Forcing path to '/usfqkline/get' and fq to 'qfq' as per verified documentation.`);
      apiUrlPath = '/usfqkline/get';
      effectiveFq = 'qfq'; // 强制前复权
  } else {
      console.error(`[fetchKline] Unknown market type for kline: ${market}`);
      return [];
  }
  const fullApiUrl = `${TENCENT_KLINE_BASE_URL}${apiUrlPath}`;

  // 3. 映射周期参数
  let apiPeriod: string;
  switch (period) {
      case 'weekly':
          apiPeriod = 'week';
          break;
      case 'monthly':
          apiPeriod = 'month';
          break;
      case 'daily':
      default:
          apiPeriod = 'day';
          break;
  }
 
   // 4. 构建 param 参数 (遵循用户提供格式)
   const fqParam = effectiveFq === 'none' ? '' : effectiveFq; // 使用调整后的 effectiveFq
   const params = {
      // 格式: <代码>,<周期>,[<开始日期>],[<结束日期>],<数量>,[<复权>]
      param: `${processedCode},${apiPeriod},${startDate || ''},${endDate || ''},${count},${fqParam}`,
  };
      // REMOVED: console.log(`[fetchKline PARAMS] processedCode: ${processedCode}, effectiveFq: ${effectiveFq}, apiPeriod: ${apiPeriod}, url: ${fullApiUrl}, params: ${JSON.stringify(params)}`);


  console.log(`[fetchKline] Fetching URL: ${fullApiUrl} with params: ${params.param}`);

  // 增加重试逻辑
  const maxRetries = 3; // 最大重试次数
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await axios.get(fullApiUrl, { // 使用动态构建的完整 URL
          params,
          headers: {
              'Referer': 'http://finance.qq.com',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 15000 // 增加超时时间
      });
      const responseData = response.data;

      // 记录详细响应数据（始终记录以便调试）
      console.log(`[fetchKline] Raw response for ${code} (period: ${period}, fq: ${effectiveFq}):`, JSON.stringify(responseData, null, 2).substring(0, 1000) + '...'); // 增加日志长度

      if (responseData.code !== 0) {
        console.error(`[fetchKline] Error from Tencent API for ${code}: ${responseData.msg || 'Unknown error'}`);
        return [];
      }

      // 更灵活地探测数据结构 - 首先查找可能的数据容器
      const dataContainer = responseData.data?.[processedCode];
      if (!dataContainer) {
        console.error(`[fetchKline] No data container found for code ${processedCode} in response`);
        return [];
      }

      // 尝试多种可能的数据路径
      let klineRawData: any[] | undefined;

      // **修改：兼容处理复权和非复权数据**
      // 构建可能的字段路径
      const possibleFieldKeys: string[] = [];

      // 根据复权类型和周期构建可能的字段名
      if (effectiveFq === 'qfq') { // 使用 effectiveFq
        possibleFieldKeys.push(`qfq${apiPeriod}`); // 首选前复权字段: qfqday, qfqweek, qfqmonth
      } else if (effectiveFq === 'hfq') { // 使用 effectiveFq
        possibleFieldKeys.push(`hfq_${apiPeriod}`); // 首选后复权字段: hfq_day, hfq_week, hfq_month
      }

      // 始终将非复权字段作为备选
      possibleFieldKeys.push(apiPeriod); // 备选非复权字段: day, week, month

      // 依次尝试所有可能的字段路径
      console.log(`[fetchKline] Trying field keys for ${code}: ${possibleFieldKeys.join(', ')}`); // 打印尝试的字段
      for (const fieldKey of possibleFieldKeys) {
        if (Array.isArray(dataContainer[fieldKey])) {
          klineRawData = dataContainer[fieldKey];
          console.log(`[fetchKline] Found valid kline data in field '${fieldKey}' for ${code}`);
          break; // 找到有效数据，停止尝试
        } else {
          console.log(`[fetchKline] Field '${fieldKey}' not found or not an array for ${code}.`); // 打印未找到的字段
        }
      }

      // 如果所有路径都不存在有效数据
      if (!klineRawData || !Array.isArray(klineRawData)) {
        console.error(`[fetchKline] Invalid or empty kline data structure received for ${code}, period ${period}, fq ${fq}`);
        console.log(`[fetchKline] Tried field keys: ${possibleFieldKeys.join(', ')}`);

        // 记录可用的字段
        if (dataContainer) {
          console.log(`[fetchKline] Available keys under data.${processedCode}:`, Object.keys(dataContainer));
        }

        // 增加重试计数并尝试重试
        retryCount++;

        if (retryCount <= maxRetries) {
          console.log(`[fetchKline] Retrying (${retryCount}/${maxRetries}) after pause...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // 递增延迟
          continue;
        }

        return []; // 达到最大重试次数后返回空数组
      }

      const klinePoints: KlinePoint[] = klineRawData.map((item): KlinePoint | null => { // TYPE FIX
        // 腾讯 K 线数据字段索引:
        // 0: date (YYYY-MM-DD)
        // 1: open
        // 2: close
        // 3: high
        // 4: low
        // 5: volume (股数)
        // ... 其他字段可能存在
        if (!item || item.length < 6) {
          console.warn(`[fetchKline] Skipping invalid kline data point for ${code}:`, item);
          return null; // 返回 null，后续过滤
        }

        // Corrected return object without the misplaced log
        return {
          date: item[0],
          open: parseFloat(item[1]),
          close: parseFloat(item[2]),
          high: parseFloat(item[3]),
          low: parseFloat(item[4]),
          volume: parseInt(item[5], 10),
        };
      }).filter((p): p is KlinePoint => p !== null && !!p.date && !isNaN(p.open) && !isNaN(p.close) && !isNaN(p.high) && !isNaN(p.low) && !isNaN(p.volume)); // 过滤掉无效的数据点 + TYPE GUARD

      // 如果提供了 startDate 或 endDate，在这里进行过滤
      // 注意：腾讯返回的数据通常是从近到远排序，过滤前确认顺序或排序
      // 假设返回的是从远到近排序，如果不是，需要先排序
      // klinePoints.sort((a, b) => a.date.localeCompare(b.date)); // 如果需要按日期升序排序

      console.log(`[fetchKline] Parsed ${klinePoints.length} kline points initially for ${code}.`); // 打印解析数量

      let filteredPoints = klinePoints;

      if (startDate) {
        filteredPoints = filteredPoints.filter(p => p?.date >= startDate);
      }

      if (endDate) {
        filteredPoints = filteredPoints.filter(p => p?.date <= endDate);
      }

      console.log(`[fetchKline] Successfully fetched and parsed ${klinePoints.length} kline points for ${code}, filtered to ${filteredPoints.length} points.`);

      // REMOVED: console.log(`[fetchKline EXIT] Returning ${filteredPoints.length} points for ${code}`);
      return filteredPoints as KlinePoint[];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[fetchKline] Axios error fetching kline for ${code}:`, error.message, error.config?.url);
        if (error.response) {
          console.error('[fetchKline] Error response status:', error.response.status);
          console.error('[fetchKline] Error response data:', error.response.data); // K线接口通常返回JSON，直接打印
        } else if (error.request) {
          console.error('[fetchKline] No response received for kline request:', error.request);
        }
      } else {
        console.error(`[fetchKline] Generic error fetching kline for ${code}:`, error);
      }

      // 增加重试计数
      retryCount++;

      if (retryCount <= maxRetries) {
        console.log(`[fetchKline] Retrying (${retryCount}/${maxRetries}) after pause...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // 递增延迟
        continue;
      }

      // REMOVED: console.error(`[fetchKline EXIT] Failed to fetch data for ${code} after ${maxRetries} retries.`);
      return []; // 达到最大重试次数后返回空数组
    }
  } // End of while loop

  // Should not be reached if loop logic is correct, but satisfies TS compiler
  console.error(`[fetchKline EXIT] Unexpected exit after retry loop for ${code}.`);
  return [];
}
