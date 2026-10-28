import axios from 'axios';
import { fetchIntraday, TENCENT_KLINE_BASE_URLS } from '../tencentApi';

jest.mock('axios');

jest.mock('@uht/infra/cache/cache-service', () => ({
  cacheService: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('fetchIntraday', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.isAxiosError.mockReturnValue(true);
  });

  it('解析 A 股分时行并转换日期与时间格式', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          sh600519: {
            data: {
              date: '20261028',
              data: [
                '0930 1354.98 1537 208260426.00',
                '0931 1353.00 3186 430459525.34',
                'bad line',
              ],
            },
          },
        },
      },
    });

    const result = await fetchIntraday('sh600519');

    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      `${TENCENT_KLINE_BASE_URLS[0]}/minute/query`
    );
    expect(result).toEqual({
      code: 'sh600519',
      date: '2026-10-28',
      points: [
        { time: '09:30', price: 1354.98, cumulativeVolume: 1537 },
        { time: '09:31', price: 1353.0, cumulativeVolume: 3186 },
      ],
    });
  });

  it('美股指数走 UsMinute 并映射为 us.DJI', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          'us.DJI': {
            data: { date: '20261027', data: ['0930 52452.62 0'] },
          },
        },
      },
    });

    const result = await fetchIntraday('usDJI');

    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      `${TENCENT_KLINE_BASE_URLS[0]}/UsMinute/query`
    );
    expect(mockedAxios.get.mock.calls[0][1]?.params).toEqual({
      code: 'us.DJI',
    });
    expect(result.points).toHaveLength(1);
    expect(result.date).toBe('2026-10-27');
  });

  it('首个主机失败时换下一个主机，全部失败返回空', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error('Request failed with status code 501'))
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            hk00700: {
              data: { date: '20261028', data: ['0930 384.000 510600'] },
            },
          },
        },
      });

    const ok = await fetchIntraday('hk00700');
    expect(ok.points[0]).toEqual({
      time: '09:30',
      price: 384,
      cumulativeVolume: 510600,
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);

    mockedAxios.get.mockReset();
    mockedAxios.get.mockRejectedValue(new Error('network down'));
    const failed = await fetchIntraday('hk00700');
    expect(failed).toEqual({ code: 'hk00700', date: null, points: [] });
    expect(mockedAxios.get).toHaveBeenCalledTimes(
      TENCENT_KLINE_BASE_URLS.length
    );
  });
});
