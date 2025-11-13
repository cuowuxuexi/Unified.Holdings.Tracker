import { frontendEnv } from './env';

// ?????API??????
export const API_BASE_URL = frontendEnv.apiBaseUrl;

// ?????????????
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
