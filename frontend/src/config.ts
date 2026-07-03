import { frontendEnv } from './env';

// API 基础地址（默认相对路径 /api，适配 nginx 反代；Electron/本地开发通过 VITE_API_BASE_URL 覆盖）
export const API_BASE_URL = frontendEnv.apiBaseUrl;

// 检查后端服务是否可达
export async function checkBackendConnection() {
  try {
    const healthCheckUrl = API_BASE_URL.replace(/\/api\/?$/, '/');
    const response = await fetch(healthCheckUrl);
    return response.ok;
  } catch (error) {
    console.error('Backend connection error:', error);
    return false;
  }
}
