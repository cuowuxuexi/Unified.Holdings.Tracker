# Alerts Capability - Delta

## ADDED Requirements

### Requirement: 杠杆利用率预警
系统 SHALL 自动计算每个投资组合的杠杆利用率并在超过阈值时创建预警记录。

#### Scenario: 超过预警阈值
- **GIVEN** 组合的杠杆利用率达到或超过 80%
- **WHEN** 风险监控任务运行
- **THEN** 系统创建 severity=`warning` 的 `leverage-usage` 预警
- **AND** 预警正文包含当前利用率、已用额度、总额度
- **AND** 若 30 分钟内已有相同组合与类型的未解决预警，则复用原记录并更新时间

#### Scenario: 超过严重阈值
- **GIVEN** 组合杠杆利用率达到或超过 90%
- **WHEN** 风险监控任务运行
- **THEN** 系统创建或升级为 severity=`critical` 的预警
- **AND** 触发 Electron 原生通知

#### Scenario: 恢复到安全区
- **GIVEN** 组合杠杆利用率已低于 70%
- **AND** 存在未解决的 `leverage-usage` 预警
- **WHEN** 风险监控任务运行
- **THEN** 系统将该预警标记为 `resolved`
- **AND** 写入 `resolved_at` 时间戳

### Requirement: 最大回撤与单日跌幅预警
系统 SHALL 跟踪组合最大回撤与单资产单日跌幅并触发预警。

#### Scenario: 组合最大回撤超阈
- **GIVEN** 组合累计最大回撤达到 10% 及以上
- **WHEN** 风险监控任务运行
- **THEN** 系统创建 severity=`warning` 的 `portfolio-drawdown` 预警
- **AND** metrics 字段记录 `peakValue` 与 `currentValue`

#### Scenario: 单资产单日暴跌
- **GIVEN** 某资产当日跌幅 >= 8%
- **AND** 该资产在组合中的权重 >= 5%
- **WHEN** 风险监控任务运行
- **THEN** 系统创建 `asset-drop` 预警，正文包含代码、当日跌幅、持仓成本

### Requirement: 注意信息模块展示与交互
系统 SHALL 在桌面端“注意信息”模块展示实时预警并允许用户确认。

#### Scenario: 展示与分组
- **WHEN** 客户端调用 `GET /api/alerts?portfolioId={id}`
- **THEN** 服务端返回按 `severity` 排序的预警列表（critical → warning → info）
- **AND** 每条预警包含 `message`、`metrics`、`status`、`triggeredAt`

#### Scenario: 用户确认
- **WHEN** 用户在 UI 中点击“已处理”
- **AND** 应用调用 `POST /api/alerts/{id}/ack`
- **THEN** 服务端将预警状态置为 `acknowledged`
- **AND** 返回更新后的记录
- **AND** 前端从列表中折叠该预警

#### Scenario: Critical 提醒
- **WHEN** API 返回存在 severity=`critical` 且 status=`active` 的预警
- **THEN** 前端触发 Electron Notification
- **AND** 弹窗包含组合名称与指标摘要

### Requirement: 预警历史与查询 API
系统 SHALL 保存最近 30 天的预警历史并提供查询接口。

#### Scenario: 历史查询
- **WHEN** 客户端调用 `GET /api/alerts/history?portfolioId={id}&type=leverage-usage`
- **THEN** 响应返回最近 30 天内所有匹配记录
- **AND** 每条记录包含 `status`、`triggeredAt`、`resolvedAt`
- **AND** 结果按 `triggeredAt` 倒序

#### Scenario: 留存策略
- **WHEN** 清理任务每日运行
- **THEN** 系统删除 30 天前的已解决预警
- **AND** 保留未解决记录供追踪
