import axios from 'axios';
import {
  A_SHARE_FQKLINE_PATH,
  A_SHARE_PLAIN_KLINE_PATH,
  fetchKline,
  resetAShareKlinePathState,
  TENCENT_KLINE_BASE_URLS,
} from '../tencentApi';

jest.mock('axios');

jest.mock('@uht/infra/cache/cache-service', () => ({
  cacheService: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const waf501 = Object.assign(new Error('Request failed with status code 501'), {
  response: { status: 501, data: '<!DOCTYPE html>waf' },
});

describe('fetchKline - 主机轮换', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedAxios.get.mockReset();
    mockedAxios.isAxiosError.mockReturnValue(true);
    resetAShareKlinePathState();
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
      `${TENCENT_KLINE_BASE_URLS[0]}${A_SHARE_FQKLINE_PATH}`,
      expect.anything()
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      `${TENCENT_KLINE_BASE_URLS[1]}${A_SHARE_FQKLINE_PATH}`,
      expect.anything()
    );
  });

  it('A股复权接口全主机 501 时改走不复权 kline 拿到数据', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(waf501)
      .mockRejectedValueOnce(waf501)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            sh600519: {
              week: [
                ['2026-10-16', '1262.95', '1329.00', '1329.88', '1261.00', '1'],
                ['2026-10-23', '1322.50', '1335.00', '1348.00', '1320.00', '1'],
              ],
            },
          },
        },
      });

    const points = await fetchKline(
      'sh600519',
      'weekly',
      undefined,
      undefined,
      'qfq',
      2
    );

    expect(points).toHaveLength(2);
    expect(points[1]).toMatchObject({ date: '2026-10-23', close: 1335 });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      `${TENCENT_KLINE_BASE_URLS[0]}${A_SHARE_FQKLINE_PATH}`,
      expect.anything()
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      3,
      `${TENCENT_KLINE_BASE_URLS[0]}${A_SHARE_PLAIN_KLINE_PATH}`,
      expect.anything()
    );
  });

  it('A股复权被 WAF 记住后，下一次直接打不复权 kline', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(waf501)
      .mockRejectedValueOnce(waf501)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            sh600519: {
              week: [
                ['2026-10-16', '1262.95', '1329.00', '1329.88', '1261.00', '1'],
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            sh000001: {
              week: [['2026-10-16', '3800', '3810', '3820', '3790', '1']],
            },
          },
        },
      });

    await fetchKline('sh600519', 'weekly', undefined, undefined, 'qfq', 2);
    mockedAxios.get.mockClear();
    const points = await fetchKline(
      'sh000001',
      'weekly',
      undefined,
      undefined,
      'qfq',
      2
    );

    expect(points[0]?.close).toBe(3810);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${TENCENT_KLINE_BASE_URLS[0]}${A_SHARE_PLAIN_KLINE_PATH}`,
      expect.anything()
    );
  });

  it('全部主机都 501 时立刻返回空数组，不带暂停连打', async () => {
    mockedAxios.get.mockRejectedValue(waf501);

    const points = await fetchKline(
      'sz000858',
      'daily',
      '2026-09-01',
      '2026-09-01',
      'none',
      30
    );

    expect(points).toEqual([]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(
      TENCENT_KLINE_BASE_URLS.length * 2
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      3,
      `${TENCENT_KLINE_BASE_URLS[0]}${A_SHARE_PLAIN_KLINE_PATH}`,
      expect.anything()
    );
  });
});
