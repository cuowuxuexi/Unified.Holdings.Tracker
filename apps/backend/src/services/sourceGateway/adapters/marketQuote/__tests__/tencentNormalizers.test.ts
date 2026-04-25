import {
  normalizeTencentKlineResponse,
  parseTencentQuoteLine,
} from '../tencentNormalizers';
import { tencentQuoteLine } from './fixtures';

describe('Tencent market quote normalizers', () => {
  it('parses A-share Tencent quote lines', () => {
    const line = tencentQuoteLine('sh600519', {
      1: '贵州茅台',
      3: '1634.00',
      4: '1620.00',
      5: '1628.00',
      6: '12345',
      30: '20260424150000',
      31: '14.00',
      32: '0.86',
      33: '1640.00',
      34: '1610.00',
      37: '20000.00',
      39: '25.30',
      45: '20500.00',
    });

    const quote = parseTencentQuoteLine(line, () => 0);

    expect(quote).toMatchObject({
      code: 'sh600519',
      name: '贵州茅台',
      currentPrice: 1634,
      changeAmount: 14,
      changePercent: 0.86,
      highPrice: 1640,
      lowPrice: 1610,
      peRatio: 25.3,
      marketCap: 20500,
    });
  });

  it('parses HK Tencent quote lines', () => {
    const line = tencentQuoteLine('hk00700', {
      1: '腾讯控股',
      3: '372.40',
      4: '370.00',
      5: '371.00',
      6: '54321',
      11: '1234567.00',
      30: '2026/04/24 16:00:00',
      31: '2.40',
      32: '0.65',
      33: '375.00',
      34: '368.00',
      39: '18.20',
      44: '35000.00',
    });

    const quote = parseTencentQuoteLine(line, () => 0);

    expect(quote).toMatchObject({
      code: 'hk00700',
      name: '腾讯控股',
      currentPrice: 372.4,
      changeAmount: 2.4,
      changePercent: 0.65,
      turnover: 1234567,
    });
  });

  it('parses US Tencent quote lines', () => {
    const line = tencentQuoteLine('usAAPL', {
      1: '苹果',
      3: '202.52',
      4: '198.15',
      5: '211.44',
      6: '101352911',
      30: '2026-04-24 16:00:02',
      31: '4.37',
      32: '2.21',
      33: '212.94',
      34: '201.16',
      37: '20819141533',
      39: '32.15',
      45: '30405.56540',
    });

    const quote = parseTencentQuoteLine(line, () => 0);

    expect(quote).toMatchObject({
      code: 'usAAPL',
      name: '苹果',
      currentPrice: 202.52,
      changeAmount: 4.37,
      changePercent: 2.21,
      marketCap: 30405.5654,
    });
  });

  it('returns null for bad quote lines and empty kline arrays for empty source data', () => {
    expect(parseTencentQuoteLine('v_bad="";')).toBeNull();
    expect(
      normalizeTencentKlineResponse(
        { code: 0, data: { sh600519: {} } },
        'sh600519'
      )
    ).toEqual([]);
  });

  it('normalizes Tencent kline rows with qfq and fallback field names', () => {
    const points = normalizeTencentKlineResponse(
      {
        code: 0,
        data: {
          sh600519: {
            qfqday: [['2026-04-24', '1620', '1634', '1640', '1610', '12000']],
          },
        },
      },
      'sh600519',
      'daily',
      'qfq'
    );

    expect(points).toEqual([
      {
        date: '2026-04-24',
        open: 1620,
        close: 1634,
        high: 1640,
        low: 1610,
        volume: 12000,
      },
    ]);
  });
});
