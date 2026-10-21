import axios from 'axios';
import { fetchKline, TENCENT_KLINE_BASE_URLS } from '../tencentApi';

jest.mock('axios');

jest.mock('@uht/infra/cache/cache-service', () => ({
  cacheService: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('fetchKline - 主机轮换', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedAxios.get.mockReset();
    mockedAxios.isAxiosError.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('首选主机被 WAF 拦截时换下一个主机拿到数据', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 501'), {
          response: { status: 501, data: '<!DOCTYPE html>waf' },
        })
      )
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            sz000858: {
              day: [['2026-09-01', '71.00', '71.50', '72.00', '70.80', '1000']],
            },
          },
        },
      });

    const pending = fetchKline(
      'sz000858',
      'daily',
      '2026-09-01',
      '2026-09-01',
      'none',
      30
    );
    await jest.runAllTimersAsync();
    const points = await pending;

    expect(points).toEqual([
      {
        date: '2026-09-01',
        open: 71,
        close: 71.5,
        high: 72,
        low: 70.8,
        volume: 1000,
      },
    ]);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      `${TENCENT_KLINE_BASE_URLS[0]}/fqkline/get`,
      expect.anything()
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      `${TENCENT_KLINE_BASE_URLS[1]}/fqkline/get`,
      expect.anything()
    );
  });
});
