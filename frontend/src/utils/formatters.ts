import dayjs from 'dayjs';

/**
 * 格式化日期字符串
 * @param dateString ISO 8601 格式日期字符串
 * @param format 输出格式，默认为 'YYYY-MM-DD HH:mm:ss'
 * @returns 格式化后的日期字符串，如果输入无效则返回 'N/A'
 */
export const formatDate = (dateString: string | undefined | null, format: string = 'YYYY-MM-DD HH:mm:ss'): string => {
  if (!dateString) return 'N/A';
  try {
    const date = dayjs(dateString);
    return date.isValid() ? date.format(format) : 'N/A';
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'N/A';
  }
};

/**
 * 格式化数字为本地化字符串，带千位分隔符
 * @param num 输入数字
 * @param decimals 保留小数位数，默认为 2
 * @returns 格式化后的数字字符串，如果输入无效则返回 'N/A'
 */
export const formatNumber = (num: number | undefined | null, decimals: number = 2): string => {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  try {
    return num.toLocaleString(undefined, { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
  } catch (error) {
    console.error('Error formatting number:', error);
    return 'N/A'; // Fallback
  }
};

/**
 * 格式化数字为百分比字符串
 * @param num 输入数字 (例如 0.1 表示 10%)
 * @param decimals 保留小数位数，默认为 2
 * @returns 格式化后的百分比字符串，如果输入无效则返回 'N/A'
 */
export const formatPercent = (num: number | undefined | null, decimals: number = 2): string => {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  try {
    return (num * 100).toLocaleString(undefined, { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    }) + '%';
  } catch (error) {
    console.error('Error formatting percent:', error);
    return 'N/A'; // Fallback
  }
}; 