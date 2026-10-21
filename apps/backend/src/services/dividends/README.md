# dividends — 现金分红自动结算

按除权（息）日前一交易日的持仓，从东方财富分红数据计算应得现金分红，在派息日把税后金额记为 `DIVIDEND` 交易。每个分红事件在 `DividendSettlement` 台账里只处理一次；用户删除的自动分红记为 `DISMISSED`，不会再自动建回；已有的手工分红记录会被关联（`MATCHED_MANUAL`）而不重复入账。

| 文件                           | 说明                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `types.ts`                     | 分红事件、应得、台账状态、告警类型                                                               |
| `dividendSources.ts`           | 东方财富 A 股 / 场内基金 / 港股 / 美股分红数据抓取与解析                                         |
| `dividendEntitlement.ts`       | 除权日前持仓、预扣税率（`UHT_DIVIDEND_TAX_CN/HK/US`）、应得金额与状态（纯计算）                  |
| `dividendSettlementService.ts` | 同步入账（含 dry-run）、台账读写、删除标记、每日 09:30 调度（`UHT_DIVIDEND_AUTO_SETTLE=0` 关闭） |
| `index.ts`                     | 对外导出                                                                                         |
| `__tests__/`                   | 以 2026-10-21 实测接口返回为夹具的解析、应得与入账测试                                           |

接口：`GET /api/portfolio/:id/dividends`（预览，不写库）、`POST /api/portfolio/:id/dividends/sync`（`includeHistory=true` 时补录自动窗口 30 天之前的历史分红）。

不处理：送转股/拆股的持仓数量调整（只告警）、A 股差别化红利税卖出时补扣。

最后更新：2026-10-21
