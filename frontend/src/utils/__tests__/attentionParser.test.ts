import { parseAttentionInfo, serializeAttentionInfo } from '../attentionParser';

describe('attentionParser', () => {
  test('解析空字符串', () => {
    expect(parseAttentionInfo('')).toEqual([]);
    expect(parseAttentionInfo(undefined)).toEqual([]);
  });

  test('解析旧格式（纯文本）', () => {
    const result = parseAttentionInfo('这是一条旧的注意信息');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('这是一条旧的注意信息');
    expect(result[0].icon).toBe('📝');
  });

  test('解析新格式（JSON）', () => {
    const json = JSON.stringify({
      items: [
        { id: '1', icon: '💰', title: '测试', content: '内容', createdAt: '2025-01-01', updatedAt: '2025-01-01' }
      ]
    });
    const result = parseAttentionInfo(json);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('测试');
  });

  test('序列化空列表', () => {
    expect(serializeAttentionInfo([])).toBe('');
  });

  test('序列化非空列表', () => {
    const items = [
      { id: '1', icon: '💰', title: '测试', content: '内容', createdAt: '2025-01-01', updatedAt: '2025-01-01' }
    ];
    const result = serializeAttentionInfo(items);
    const parsed = JSON.parse(result);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe('测试');
  });
});
