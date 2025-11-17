# Tasks - add-portfolio-risk-alerts

## 1. 产品 & 数据准备
- [ ] 1.1 与业务确认阈值、严重级别文案（warning/critical）
- [ ] 1.2 审查 `注意信息` 现有 UI，输出交互草图并达成一致

## 2. 后端实现
- [ ] 2.1 使用 Prisma 创建 `portfolio_alerts` 表及关联模型，生成/迁移数据库
- [ ] 2.2 实现 `riskMonitorService`：聚合行情、杠杆、回撤，写入/更新预警记录
- [ ] 2.3 新增 API：`GET /api/alerts`（实时）、`GET /api/alerts/history`、`POST /api/alerts/:id/ack`
- [ ] 2.4 覆盖服务与 API 的 Jest 单元/集成测试

## 3. 前端 & Electron
- [ ] 3.1 基于 React Query 编写 `useRiskAlerts` hook，支持 60s 轮询与手动刷新
- [ ] 3.2 在“注意信息”模块嵌入 `RiskAlertPanel`，实现 severity 分段与确认按钮
- [ ] 3.3 暴露 Electron preload IPC，用于在 critical 预警出现时触发系统通知
- [ ] 3.4 添加 Vitest/UI 测试，验证状态渲染与 ack 流程

## 4. 稳定性与交付
- [ ] 4.1 增加 `test-risk-monitor.js` 脚本，覆盖三种风险场景
- [ ] 4.2 更新文档（README、注意信息模块预案、openspec specs）
- [ ] 4.3 运行 `openspec validate add-portfolio-risk-alerts --strict` 并附结果
