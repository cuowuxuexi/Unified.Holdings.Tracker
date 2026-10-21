import { EastmoneyEconomicValueResponse } from '../types';

// 2026-10-21 从 guonei 实测 RPT_ECONOMICVALUE_USA / EMG00002790 截取（按 REPORT_DATE 倒序）
export const eastmoneyIsmPmiFixture: EastmoneyEconomicValueResponse = {
  success: true,
  message: 'ok',
  result: {
    data: [
      {
        INDICATOR_ID: 'EMG00002790',
        REPORT_DATE: '2026-10-01 00:00:00',
        PUBLISH_DATE: '2026-11-02 00:00:00',
        VALUE: null,
      },
      {
        INDICATOR_ID: 'EMG00002790',
        REPORT_DATE: '2026-09-01 00:00:00',
        PUBLISH_DATE: '2026-10-01 00:00:00',
        VALUE: 54.5,
      },
      {
        INDICATOR_ID: 'EMG00002790',
        REPORT_DATE: '2026-08-01 00:00:00',
        PUBLISH_DATE: '2026-09-01 00:00:00',
        VALUE: 54.6,
      },
      {
        INDICATOR_ID: 'EMG00002790',
        REPORT_DATE: '2026-07-01 00:00:00',
        PUBLISH_DATE: '2026-08-03 00:00:00',
        VALUE: 55.6,
      },
      {
        INDICATOR_ID: 'EMG00002790',
        REPORT_DATE: '2026-06-01 00:00:00',
        PUBLISH_DATE: '2026-07-01 00:00:00',
        VALUE: null,
      },
    ],
  },
};

export const eastmoneyEmptyFixture: EastmoneyEconomicValueResponse = {
  success: false,
  message: '返回数据为空',
  result: null,
};
