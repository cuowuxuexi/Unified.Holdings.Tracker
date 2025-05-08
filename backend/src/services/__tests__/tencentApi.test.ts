import axios from 'axios';
import iconv from 'iconv-lite';
import { fetchQuotes, fetchKline } from '../tencentApi'; // Adjust path if needed
import { Quote, KlinePoint, Market } from '../../types'; // Adjust path if needed

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock iconv-lite (optional, only if direct decoding is needed in tests)
// jest.mock('iconv-lite');
// const mockedIconv = iconv as jest.Mocked<typeof iconv>;

describe('Tencent API Service', () => {
  // Reset mocks before each test
  beforeEach(() => {
    mockedAxios.get.mockReset();
    // mockedIconv.decode.mockReset(); // Reset if iconv is mocked
  });

  describe('fetchQuotes', () => {
    it('should fetch and parse quotes for A-share stocks', async () => {
      // Arrange: Mock GBK encoded response for A-shares
      const mockResponseData = `v_sh600519="1~贵州茅台~600519~1668.00~-12.00~-0.71~12345~1234567890~...";`;
      const mockBuffer = iconv.encode(mockResponseData, 'gbk');
      mockedAxios.get.mockResolvedValue({ data: mockBuffer });

      // Act
      const quotes = await fetchQuotes(['sh600519']);

      // Assert
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('list=sh600519'), { responseType: 'arraybuffer' });
      expect(quotes).toHaveLength(1);
      expect(quotes[0]).toEqual(expect.objectContaining({
        code: 'sh600519',
        name: '贵州茅台',
        currentPrice: 1668.00,
        change: -12.00,
        changePercent: -0.71,
        market: Market.CN, // Corrected from SH to CN
      }));
    });

    it('should fetch and parse quotes for HK stocks', async () => {
        // Arrange: Mock GBK encoded response for HK stocks
        const mockResponseData = `v_hk00700="hk~腾讯控股~00700~380.00~-2.00~-0.52~54321~9876543210~...";`;
        const mockBuffer = iconv.encode(mockResponseData, 'gbk');
        mockedAxios.get.mockResolvedValue({ data: mockBuffer });

        // Act
        const quotes = await fetchQuotes(['hk00700']);

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('list=hk00700'), { responseType: 'arraybuffer' });
        expect(quotes).toHaveLength(1);
        expect(quotes[0]).toEqual(expect.objectContaining({
            code: 'hk00700',
            name: '腾讯控股',
            currentPrice: 380.00,
            change: -2.00,
            changePercent: -0.52,
            market: Market.HK,
        }));
    });

     it('should fetch and parse quotes for US stocks', async () => {
        // Arrange: Mock GBK encoded response for US stocks
        const mockResponseData = `v_usAAPL="us~苹果~AAPL~170.00~1.50~0.89~...~";`;
        const mockBuffer = iconv.encode(mockResponseData, 'gbk');
        mockedAxios.get.mockResolvedValue({ data: mockBuffer });

        // Act
        const quotes = await fetchQuotes(['usAAPL']);

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('list=usAAPL'), { responseType: 'arraybuffer' });
        expect(quotes).toHaveLength(1);
        expect(quotes[0]).toEqual(expect.objectContaining({
            code: 'usAAPL',
            name: '苹果',
            currentPrice: 170.00,
            change: 1.50,
            changePercent: 0.89,
            market: Market.US,
        }));
    });

    it('should handle mixed market quotes', async () => {
        // Arrange: Mock GBK encoded response for mixed markets
        const mockResponseData = `v_sh600519="1~贵州茅台~600519~1668.00~...";\nv_hk00700="hk~腾讯控股~00700~380.00~...";\nv_usAAPL="us~苹果~AAPL~170.00~...";`;
        const mockBuffer = iconv.encode(mockResponseData, 'gbk');
        mockedAxios.get.mockResolvedValue({ data: mockBuffer });

        // Act
        const quotes = await fetchQuotes(['sh600519', 'hk00700', 'usAAPL']);

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('list=sh600519,hk00700,usAAPL'), { responseType: 'arraybuffer' });
        expect(quotes).toHaveLength(3);
        expect(quotes).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'sh600519', name: '贵州茅台' }),
            expect.objectContaining({ code: 'hk00700', name: '腾讯控股' }),
            expect.objectContaining({ code: 'usAAPL', name: '苹果' }),
        ]));
    });

    it('should return an empty array for invalid codes or API errors', async () => {
      // Arrange: Simulate API error
      mockedAxios.get.mockRejectedValue(new Error('API Error'));

      // Act
      const quotes = await fetchQuotes(['invalidcode']);

      // Assert
      expect(quotes).toEqual([]);
    });

     it('should return an empty array if response data is empty or malformed', async () => {
        // Arrange: Mock empty/malformed response
        const mockResponseData = `v_sh600000="";`; // Malformed or empty data
        const mockBuffer = iconv.encode(mockResponseData, 'gbk');
        mockedAxios.get.mockResolvedValue({ data: mockBuffer });

        // Act
        const quotes = await fetchQuotes(['sh600000']);

        // Assert
        expect(quotes).toEqual([]);
    });
  });

  describe('fetchKline', () => {
    it('should fetch and parse daily kline data', async () => {
        // Arrange: Mock JSON response for kline
        const mockKlineData = {
            code: 0,
            msg: '',
            data: {
                sh600519: {
                    day: [
                        ['2024-04-15', '1670.00', '1680.00', '1660.00', '1668.00', '12345'],
                        ['2024-04-14', '1660.00', '1675.00', '1655.00', '1670.00', '11000'],
                    ],
                    // Add other periods if needed (qfq, hfq)
                }
            }
        };
        mockedAxios.get.mockResolvedValue({ data: mockKlineData });

        // Act
        const klinePoints = await fetchKline('sh600519', 'daily', 'qfq'); // Corrected 'day' to 'daily'

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('sh600519'), expect.any(Object)); // Check if called with correct code
        expect(klinePoints).toHaveLength(2);
        expect(klinePoints[0]).toEqual({
            date: '2024-04-15',
            open: 1670.00,
            high: 1680.00,
            low: 1660.00,
            close: 1668.00,
            volume: 12345,
        });
         expect(klinePoints[1]).toEqual({
            date: '2024-04-14',
            open: 1660.00,
            high: 1675.00,
            low: 1655.00,
            close: 1670.00,
            volume: 11000,
        });
    });

     it('should handle different periods (e.g., week)', async () => {
        // Arrange: Mock JSON response for weekly kline
        const mockKlineData = {
            code: 0, msg: '', data: { sh600519: {
                week: [['2024-04-15', '1650', '1700', '1640', '1668', '50000']]
            }}
        };
        mockedAxios.get.mockResolvedValue({ data: mockKlineData });

        // Act
        const klinePoints = await fetchKline('sh600519', 'weekly', 'qfq'); // Corrected 'week' to 'weekly'

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('period=weekly'), expect.any(Object)); // Corrected 'week' to 'weekly'
        expect(klinePoints).toHaveLength(1);
        expect(klinePoints[0].date).toBe('2024-04-15');
    });

     it('should handle different fq types (e.g., hfq)', async () => {
        // Arrange: Mock JSON response for hfq kline
        const mockKlineData = {
            code: 0, msg: '', data: { sh600519: {
                hfq_day: [['2024-04-15', '165', '170', '164', '166.8', '123450']] // Example adjusted prices
            }}
        };
        mockedAxios.get.mockResolvedValue({ data: mockKlineData });

        // Act
        const klinePoints = await fetchKline('sh600519', 'daily', 'hfq'); // Corrected 'day' to 'daily'

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('fqtype=hfq'), expect.any(Object));
        expect(klinePoints).toHaveLength(1);
        expect(klinePoints[0].close).toBe(166.8); // Check adjusted price
    });

    it('should handle date filtering', async () => {
        // Arrange: Mock JSON response
         const mockKlineData = {
            code: 0, msg: '', data: { sh600519: {
                day: [
                    ['2024-04-15', '1670', '1680', '1660', '1668', '12345'],
                    ['2024-04-14', '1660', '1675', '1655', '1670', '11000'],
                ]
            }}
        };
        mockedAxios.get.mockResolvedValue({ data: mockKlineData });

        // Act
        const klinePoints = await fetchKline('sh600519', 'daily', 'qfq', '2024-04-15'); // Corrected 'day' to 'daily'

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('begin_date=20240415'), expect.any(Object));
        // Note: The actual filtering happens in the API, the mock returns all data.
        // A more robust test might involve checking the URL params precisely.
        expect(klinePoints).toHaveLength(2); // Mock returns all, filtering is assumed by API call params
    });


    it('should return an empty array if API returns error code', async () => {
      // Arrange: Mock API response with error code
      mockedAxios.get.mockResolvedValue({ data: { code: 1, msg: 'Error fetching data' } });

      // Act
      const klinePoints = await fetchKline('sh600519');

      // Assert
      expect(klinePoints).toEqual([]);
    });

    it('should return an empty array if API response structure is invalid', async () => {
      // Arrange: Mock invalid response structure
      mockedAxios.get.mockResolvedValue({ data: { code: 0, msg: '', data: {} } }); // Missing stock code key

      // Act
      const klinePoints = await fetchKline('sh600519');

      // Assert
      expect(klinePoints).toEqual([]);
    });

     it('should return an empty array if API call fails', async () => {
      // Arrange: Simulate API error
      mockedAxios.get.mockRejectedValue(new Error('Network Error'));

      // Act
      const klinePoints = await fetchKline('sh600519');

      // Assert
      expect(klinePoints).toEqual([]);
    });
  });
});