import { App as AntdApp } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

/**
 * Returns Ant Design's message API bound to the nearest <App> provider.
 */
const useMessageApi = (): MessageInstance => {
  const { message } = AntdApp.useApp();
  return message;
};

export default useMessageApi;
