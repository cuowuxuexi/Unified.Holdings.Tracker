import { AttentionItem } from '../store/types';

/**
 * 解析 attentionInfo 字符串
 * @param attentionInfoStr - 来自后端的 attentionInfo 字段
 * @returns 注意信息列表
 */
export function parseAttentionInfo(attentionInfoStr?: string): AttentionItem[] {
  if (!attentionInfoStr || attentionInfoStr.trim() === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(attentionInfoStr);
    if (parsed.items && Array.isArray(parsed.items)) {
      return parsed.items;
    }
    // 兼容旧格式：纯文本转换为一条默认注意事项
    return [{
      id: generateId(),
      icon: '📝',
      title: '注意信息',
      content: attentionInfoStr,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
  } catch {
    // JSON解析失败，视为旧格式
    return [{
      id: generateId(),
      icon: '📝',
      title: '注意信息',
      content: attentionInfoStr,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
  }
}

/**
 * 序列化注意信息列表为字符串
 */
export function serializeAttentionInfo(items: AttentionItem[]): string {
  if (items.length === 0) return '';
  return JSON.stringify({ items });
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return `attention-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
