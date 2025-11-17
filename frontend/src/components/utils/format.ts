// 百分比格式化工具函数
export function formatPercent(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null || isNaN(value)) return 'N/A';
  return `${value.toFixed(digits)}%`;
} 