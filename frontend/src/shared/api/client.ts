import { client } from '../../generated/api';

// 配置 API 客户端
client.setConfig({
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
});

export { client };
export * from '../../generated/api';

