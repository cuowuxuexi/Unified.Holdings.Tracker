import {
  fetchDividendEvents,
  isChinaExchangeFund,
  parseAShareDividendRows,
  parseFundDividendHtml,
  parseHkDividendRows,
  parseHkPlanExplain,
  parseUsDividendRows,
} from '../dividendSources';
import {
  aShareRows,
  fund159892Html,
  fund510050Html,
  hkRows,
  usRows,
} from './fixtures';

describe('dividendSources - A 股', () => {
  it('parses implemented cash dividends per share with ex date as pay date', () => {
    const { events } = parseAShareDividendRows(
      'sz000858',
      aShareRows['000858']
    );

    expect(events[0]).toEqual({
      assetCode: 'sz000858',
      market: 'CN',
      exDate: '2026-07-16',
      recordDate: '2026-07-15',
      payDate: '2026-07-16',
      cashPerShare: 2.5796852,
      currency: 'CNY',
      description: '10派25.796852元(含税,扣税后23.217167元)',
      bonusSharesPerShare: null,
      sourceId: 'eastmoney-dividend',
    });
    expect(events).toHaveLength(3);
  });

  it('keeps bonus-share ratios so they can be flagged for manual action', () => {
    const { events } = parseAShareDividendRows(
      'sh600276',
      aShareRows['600276']
    );
    const withBonus = events.find((event) => event.exDate === '2021-06-10');

    expect(withBonus).toEqual(
      expect.objectContaining({ cashPerShare: 0.2, bonusSharesPerShare: 0.2 })
    );
  });
});

describe('dividendSources - 场内基金', () => {
  it('parses fund F10 distribution rows', () => {
    const { events } = parseFundDividendHtml('sh510050', fund510050Html);

    expect(events[0]).toEqual(
      expect.objectContaining({
        exDate: '2025-12-17',
        recordDate: '2025-12-16',
        payDate: '2025-12-22',
        cashPerShare: 0.08,
        currency: 'CNY',
      })
    );
  });

  it('returns nothing for funds that never distributed', () => {
    expect(parseFundDividendHtml('sz159892', fund159892Html).events).toEqual(
      []
    );
  });

  it('routes exchange-traded funds to the fund source', () => {
    expect(isChinaExchangeFund('sz159892')).toBe(true);
    expect(isChinaExchangeFund('sh510050')).toBe(true);
    expect(isChinaExchangeFund('sh600276')).toBe(false);
    expect(isChinaExchangeFund('sz002415')).toBe(false);
  });
});

describe('dividendSources - 港股', () => {
  it.each([
    ['每股派港币5.3元', { cashPerShare: 5.3, currency: 'HKD' }],
    [
      '每股派美元0.5元(相当于港币3.909346元(计算值))',
      { cashPerShare: 3.909346, currency: 'HKD' },
    ],
    [
      '每股派人民币2.3817元(相当于港币2.7248元)',
      { cashPerShare: 2.7248, currency: 'HKD' },
    ],
    [
      '每股派港币0.6元,特别股息每股派港币1元',
      { cashPerShare: 1.6, currency: 'HKD' },
    ],
    ['每股派美元0.25元', { cashPerShare: 0.25, currency: 'USD' }],
  ])('parses plan text %s', (text, expected) => {
    const parsed = parseHkPlanExplain(text);
    expect(parsed?.currency).toBe(expected.currency);
    expect(parsed?.cashPerShare).toBeCloseTo(expected.cashPerShare, 9);
  });

  it('rejects mixed currencies instead of guessing', () => {
    expect(parseHkPlanExplain('每股派港币0.5元,特别股息美元0.1元')).toBeNull();
  });

  it('skips periods without a distribution and keeps ex/pay dates', () => {
    const { events, warnings } = parseHkDividendRows(
      'hk00700',
      hkRows['00700']
    );

    expect(events).toEqual([
      expect.objectContaining({
        exDate: '2026-05-15',
        payDate: '2026-06-01',
        cashPerShare: 5.3,
        currency: 'HKD',
      }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('warns when a declared distribution has no parsable plan text', () => {
    const { events, warnings } = parseHkDividendRows(
      'hk00005',
      hkRows['00005']
    );

    expect(events.map((event) => event.exDate)).toEqual([
      '2026-08-13',
      '2026-05-14',
      '2026-03-12',
    ]);
    // 三季度分配只有派息日、尚无除净日与方案：不入事件，也不报解析失败
    expect(warnings).toEqual([]);
  });

  it('returns no events for companies that never paid', () => {
    expect(parseHkDividendRows('hk03690', hkRows['03690']).events).toEqual([]);
  });
});

describe('dividendSources - 美股', () => {
  it('parses per-share and per-ADR plans', () => {
    const jd = parseUsDividendRows('usJD', usRows['JD']).events;
    const baba = parseUsDividendRows('usBABA', usRows['BABA']).events;

    expect(jd[0]).toEqual(
      expect.objectContaining({
        exDate: '2026-04-09',
        payDate: '2026-04-29',
        cashPerShare: 1,
        currency: 'USD',
      })
    );
    expect(baba[0]).toEqual(
      expect.objectContaining({ exDate: '2026-06-11', cashPerShare: 1.05 })
    );
  });
});

describe('fetchDividendEvents', () => {
  it('queries the market-specific report and treats empty responses as no dividends', async () => {
    const httpGet = jest.fn().mockResolvedValue(
      JSON.stringify({
        success: false,
        message: '返回数据为空',
        result: null,
      })
    );

    const result = await fetchDividendEvents('usPDD', httpGet);

    expect(result.events).toEqual([]);
    const url = new URL(httpGet.mock.calls[0][0]);
    expect(url.searchParams.get('reportName')).toBe('RPT_USF10_INFO_DIVIDEND');
    expect(url.searchParams.get('filter')).toBe('(SECURITY_CODE="PDD")');
  });

  it('uses fund F10 pages for exchange-traded funds', async () => {
    const httpGet = jest.fn().mockResolvedValue(fund510050Html);

    const result = await fetchDividendEvents('sh510050', httpGet);

    expect(httpGet).toHaveBeenCalledWith(
      'https://fundf10.eastmoney.com/fhsp_510050.html'
    );
    expect(result.events).toHaveLength(3);
  });
});
