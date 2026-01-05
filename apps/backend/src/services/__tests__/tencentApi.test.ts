import axios from 'axios';
import iconv from 'iconv-lite';
import { fetchQuotes, fetchKline } from '../tencentApi';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const decodeSpy = jest.spyOn(iconv, 'decode');

beforeAll(() => {
  decodeSpy.mockImplementation((buffer) => buffer.toString());
});

afterAll(() => {
  decodeSpy.mockRestore();
});

const buildQuoteLine = (params: {
  code: string;
  name: string;
  price: number;
  changeAmount?: number;
  changePercent?: number;
  timestamp?: string;
}): string => {
  const {
    code,
    name,
    price,
    changeAmount = 1.23,
    changePercent = 0.45,
    timestamp = '20240101150000',
  } = params;
  const parts = new Array(60).fill('0');
  parts[1] = name;
  parts[3] = price.toFixed(2);
  parts[4] = (price - 5).toFixed(2);
  parts[5] = (price - 2).toFixed(2);
  parts[6] = '1000';
  parts[30] = timestamp;
  parts[31] = changeAmount.toFixed(2);
  parts[32] = changePercent.toFixed(2);
  parts[33] = (price + 10).toFixed(2);
  parts[34] = (price - 10).toFixed(2);
  parts[37] = '5000';
  parts[39] = '10';
  parts[45] = '1000000';
  return `v_${code}="${parts.join('~')}";`;
};

describe('Tencent API Service', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  afterEach(() => {
    // 清理未完成的异步操作和定时器
    jest.clearAllTimers();
    jest.useRealTimers();
    mockedAxios.get.mockReset();
  });

  describe('fetchQuotes', () => {
    it('should parse multiple market quotes from the mocked payload', async () => {
      const payload = [
        buildQuoteLine({ code: 'sh600519', name: '贵州茅台', price: 1668 }),
        buildQuoteLine({
          code: 'hk00700',
          name: '腾讯控股',
          price: 380,
          timestamp: '2024/01/01 15:00:00',
        }),
        buildQuoteLine({
          code: 'usAAPL',
          name: '苹果',
          price: 170,
          timestamp: '2024-01-01 15:00:00',
        }),
      ].join('\n');

      mockedAxios.get.mockResolvedValue({
        data: Buffer.from(payload, 'utf-8'),
      });

      const quotes = await fetchQuotes(['sh600519', 'hk00700', 'usAAPL']);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://qt.gtimg.cn/q=sh600519,hk00700,usAAPL',
        expect.objectContaining({
          responseType: 'arraybuffer',
          headers: expect.any(Object),
        })
      );

      expect(quotes).toHaveLength(3);
      expect(quotes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'sh600519',
            name: '贵州茅台',
            currentPrice: 1668,
          }),
          expect.objectContaining({
            code: 'hk00700',
            name: '腾讯控股',
            currentPrice: 380,
          }),
          expect.objectContaining({
            code: 'usAAPL',
            name: '苹果',
            currentPrice: 170,
          }),
        ])
      );
    });

    it('should return an empty array when axios throws', async () => {
      mockedAxios.get.mockRejectedValue(new Error('network'));
      const quotes = await fetchQuotes(['invalid']);
      expect(quotes).toEqual([]);
    });
  });

  describe('fetchKline', () => {
    it('should parse daily kline data correctly', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          code: 0,
          msg: '',
          data: {
            sh600519: {
              day: [
                ['2024-04-15', '1670', '1668', '1680', '1660', '12345'],
                ['2024-04-14', '1660', '1670', '1675', '1655', '11000'],
              ],
            },
          },
        },
      });

      const points = await fetchKline('sh600519');

      const [, config] = mockedAxios.get.mock.calls[0];
      expect(config).toEqual(
        expect.objectContaining({
          params: expect.objectContaining({
            param: expect.stringContaining('sh600519,day'),
          }),
        })
      );

      expect(points).toEqual([
        {
          date: '2024-04-15',
          open: 1670,
          close: 1668,
          high: 1680,
          low: 1660,
          volume: 12345,
        },
        {
          date: '2024-04-14',
          open: 1660,
          close: 1670,
          high: 1675,
          low: 1655,
          volume: 11000,
        },
      ]);
    });

    it('should return an empty array when API reports error code', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { code: 1, msg: 'error' },
      });

      const points = await fetchKline('sh600519');
      expect(points).toEqual([]);
    });

    it('should return an empty array when payload structure is invalid', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { code: 0, msg: '', data: {} },
      });

      const points = await fetchKline('sh600519');
      expect(points).toEqual([]);
    });
  });
});
