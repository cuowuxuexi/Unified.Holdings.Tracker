# Proposal: 组合风险预警中心

## Change ID
`add-portfolio-risk-alerts`

## Summary
在现有“注意信息”模块基础上拓展一个组合风险预警中心：统一计算杠杆利用率、组合/单资产回撤等关键指标，一旦触发阈值即通过桌面提醒和应用内提示引导用户及时止损或调仓。后端提供标准化 API 与历史记录，前端展示实时预警列表、提醒上下文以及处理动作。

## Why Now
- 杠杆融资和跨市场资产导致风险暴露提升，需要比手工检查更及时的提醒。
- 目前“注意信息”仅能展示静态提醒，缺少自动化监控和历史追踪，难以满足 Stage 3 上线要求。
- 近期多份文档（如《注意信息模块优化步骤预案》）要求构建规范化预警流程，本提案对齐该方向。

## Goals
1. 定义杠杆利用率、组合最大回撤、单资产跌幅三类预警的默认阈值与触发逻辑。
2. 后端每 5 分钟评估一遍所有组合，产出实时预警并存档最近 30 天的历史记录。
3. Electron/前端拉取 `/api/alerts` 数据并在“注意信息”模块内以时间倒序展示，支持手动确认/忽略。
4. 通过系统托盘或原生通知渠道，使严重预警（如杠杆>90%）即时弹出提醒。

## Non-goals
- 不涉及自动平仓或下单执行。
- 不在本提案中实现自定义通知渠道（短信、邮件等）。
- 不支持用户自定义阈值；仅提供预设值和常量定义。

## User Impact
- 风险暴露更透明：用户打开桌面端即可看到最近触发的风险点。
- 决策效率提升：预警正文包含关键指标与建议动作，减少反复跳转。
- 审计可追溯：历史列表记录全部触发与解除事件，便于复盘。

## Implementation Notes
### Backend
- 新增 `portfolio_alerts` 表：`id`、`portfolio_id`、`type`、`severity`、`message`、`metrics(json)`、`status`、`triggered_at`、`resolved_at`。
- 复用现有行情/汇率缓存，添加 `riskMonitorService`，每 5 分钟聚合：
  - 杠杆利用率：`used_leverage / total_leverage`；80% 以上 warning，90% 以上 critical。
  - 组合回撤：`(peak_value - current_value) / peak_value`，≥10% warning，≥20% critical。
  - 单资产当日跌幅：`(open_price - last_price) / open_price`，≥8% warning。
- 暴露 REST API：`GET /api/alerts?portfolioId=...`、`POST /api/alerts/:id/ack`、`GET /api/alerts/history`。

### Frontend / Electron
- 在“注意信息”模块新增 `RiskAlertPanel`：按照 severity 颜色分组，默认折叠已确认项目。
- 采用 React Query 轮询（默认 60s），当返回存在 critical 且未确认的预警时触发 Electron `Notification`。
- 支持用户点击“已处理” → 调用 ack API；界面即时刷新。

### Observability
- Pino 日志新增 `alert_type`、`alert_status` 字段，方便定位误报。
- 在 `test-risk-monitor.js`（新增）覆盖阈值判断、去重逻辑。

## Risks & Mitigations
- **误报/漏报**：通过单元测试覆盖极端值，并在 metrics 字段记录原始计算数据，便于复盘。
- **性能压力**：评估循环走缓存数据，不直接对外部 API 做 N+1 调用，必要时限制每轮计算批次数量。
- **通知噪音**：同类预警在 30 分钟内只创建一次，避免刷屏；前端支持折叠/过滤。

## Success Metrics
- 预警计算周期稳定在 <3s/组合，日志无超时。
- 关键预警（杠杆、回撤）在触发后 1 分钟内可见并可点击确认。
- QA 手动制造 3 种风险场景全部命中对应预警，历史列表可检索到记录。
