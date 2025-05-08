// 后端API地址配置
export const API_BASE_URL = 'http://localhost:3001/api';

// 检查后端连接状态的函数
export async function checkBackendConnection() {
  try {
    const response = await fetch('http://localhost:3001/');
    return response.ok;
  } catch (error) {
    console.error('Backend connection error:', error);
    return false;
  }
}