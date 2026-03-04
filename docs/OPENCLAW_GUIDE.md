# OpenClaw 操作手册 — UHT 快照与报表系统

> 本文档面向 OpenClaw（AI 助手），说明 UHT 系统的快照采集、报表生成机制，以及你在日常运维中需要执行的操作。

---

## 一、系统变更概述

### 本次更新内容

| 变更项   | 旧行为                             | 新行为                                                                                 |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| 快照内容 | 仅存组合级汇总（净资产、总盈亏等） | **新增个股级快照**：每只股票的收盘价、持仓量、CNY 市值                                 |
| 采集时间 | A 股 15:35 + 美股 05:30，每天两次  | **每天 06:30 统一采集一次**（周二到周六），覆盖 A 股/港股/美股前一交易日               |
| 校验机制 | 无                                 | **08:00 自动复测**，若 06:30 数据缺失则自动补采 + 发送告警                             |
| 告警渠道 | 仅控制台日志                       | **Webhook 推送**，失败事件会 POST 到配置的 URL                                         |
| 报表能力 | 仅有周报，且数据不准确             | **通用期间报表 API**，支持任意时间段（日/周/月/季/年），支持 JSON 和 Markdown 两种格式 |

### 新数据库表

```
PositionSnapshot (个股快照)
├── portfolioId   — 组合 ID
├── date          — 快照日期（YYYY-MM-DD）
├── assetCode     — 股票代码（如 sh600519、hk00700、usPDD）
├── quantity      — 持仓数量
├── currentPrice  — 收盘价（原币种）
└── marketValue   — 市值（CNY，已含汇率转换）
```

---

## 二、定时任务时间表

以下时间均为 **北京时间（Asia/Shanghai）**，周二至周六执行：

| 时间  | 任务     | 说明                                                   |
| ----- | -------- | ------------------------------------------------------ |
| 06:30 | 定量采集 | 抓取所有组合的组合级 + 个股级快照，日期记为**前一天**  |
| 08:00 | 复测校验 | 检查前一天是否已有快照数据；若缺失则重试采集并触发告警 |

> **为什么是周二到周六？** 因为采集的是"前一天"的数据。周二采集周一，周六采集周五。周日和周一不执行（对应周六和周日没有交易）。

---

## 三、API 接口说明

服务器地址：`http://<HOST>:3001`（生产环境以实际部署为准）

### 3.1 手动触发快照

```
POST /api/portfolio/:id/snapshots/trigger
```

- **用途**：手动为指定组合采集一次快照（包括组合级和个股级）
- **快照日期**：自动设为前一天
- **参数**：无需请求体
- **响应**：`{ "message": "Snapshot triggered successfully." }`
- **使用场景**：当你需要补采某个组合的快照时

### 3.2 查询组合快照

```
GET /api/portfolio/:id/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
```

- **用途**：查看指定日期范围内的组合级快照历史
- **响应**：`SnapshotRecord[]`（包括 totalMarketValue、netAssets、totalPnl、dailyPnl、cash）

### 3.3 期间报表（核心接口）⭐

```
GET /api/portfolio/:id/period-report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|markdown
```

- **用途**：生成任意时间段的投资组合报表
- **参数**：
  - `from`（必填）：起始日期
  - `to`（必填）：结束日期
  - `format`（可选）：`json`（默认）或 `markdown`
- **返回内容**：
  - 组合概览（期初/期末净资产、期间盈亏、收益率）
  - 费用汇总（手续费总计、融资利息总计）
  - 个股明细（按 A 股/港股/美股分组，含期初价、期末价、涨跌幅、期间盈亏）
  - 盈亏贡献排名
  - 已清仓股票标注

#### 使用示例

**日报**（某一天的快照数据）：

```
GET /api/portfolio/{id}/period-report?from=2026-03-03&to=2026-03-03&format=markdown
```

**周报**（上周一到上周日）：

```
GET /api/portfolio/{id}/period-report?from=2026-02-24&to=2026-03-02&format=markdown
```

**月报**（上月完整月份）：

```
GET /api/portfolio/{id}/period-report?from=2026-02-01&to=2026-02-28&format=markdown
```

**年报**（完整年度）：

```
GET /api/portfolio/{id}/period-report?from=2025-01-01&to=2025-12-31&format=markdown
```

### 3.4 获取所有组合列表

```
GET /api/portfolio
```

- **用途**：获取全部组合的 ID 和名称
- **响应**：`[{ "id": "...", "name": "2025投资组合", "cash": 2998 }, ...]`

---

## 四、当前组合清单

| 组合 ID                                | 名称         |
| -------------------------------------- | ------------ |
| `e5e2a241-b51e-4cf4-8f01-ee20e24e0dd2` | 2025投资组合 |
| `746fa857-52f3-4bf7-ba68-47a08d8cda8a` | 2026投资组合 |
| `6c8d5514-0113-4f11-9429-301257380b71` | 2026投资组合 |

> 如果新增或删除了组合，请通过 `GET /api/portfolio` 更新此清单。

---

## 五、Webhook 告警格式

当快照采集失败或复测发现数据缺失时，系统会向环境变量 `SNAPSHOT_ALERT_WEBHOOK` 配置的地址发送 POST 请求：

```json
{
  "event": "snapshot_failure",
  "message": "06:30 快照未找到数据（2026-03-03），正在自动补采",
  "timestamp": "2026-03-04T00:00:00.000Z",
  "source": "uht-snapshot-service"
}
```

**你收到此告警后的建议动作：**

1. 记录告警时间和内容
2. 等待 5 分钟后，调用 `GET /api/portfolio/:id/snapshots?from=<date>&to=<date>` 确认补采是否成功
3. 如果仍然没有数据，提醒用户手动检查服务器状态

---

## 六、你的日常工作流程

### 每日上午（建议 08:30 后执行）

```
1. 调用 GET /api/portfolio 获取组合列表
2. 对每个组合，调用：
   GET /api/portfolio/{id}/period-report?from={昨日日期}&to={昨日日期}&format=markdown
3. 将生成的 Markdown 报表推送给用户
```

### 每周一上午

```
1. 计算上周日期范围（上周一 ~ 上周日）
2. 对每个组合，调用：
   GET /api/portfolio/{id}/period-report?from={上周一}&to={上周日}&format=markdown
3. 推送周报
```

### 每月 1 日上午

```
1. 计算上月日期范围
2. 对每个组合，调用：
   GET /api/portfolio/{id}/period-report?from={上月1日}&to={上月末日}&format=markdown
3. 推送月报
```

### 每年 1 月 1 日

```
1. 对每个组合，调用：
   GET /api/portfolio/{id}/period-report?from={去年1月1日}&to={去年12月31日}&format=markdown
2. 推送年报
```

---

## 七、报表输出样例

### Markdown 格式（`format=markdown`）

系统直出的 Markdown 报表包含以下板块：

```
# 📊 投资组合期间报表
> 期间：2026-03-03 ~ 2026-03-03

## 一、组合概览
| 指标           | 数值           |
|----------------|---------------:|
| 期初净资产     | ¥777,848.10    |
| 期末净资产     | ¥777,848.10    |
| 期间盈亏       | +¥0.00         |
| 期间收益率     | +0.00%         |

## 二、费用
| 项目     | 金额     |
|----------|--------:|
| 手续费   | ¥120.50 |
| 融资利息 | ¥450.00 |
| 合计     | ¥570.50 |

## 三、A 股持仓
| 股票 | 期初价 | 期末价 | 涨跌幅 | 持仓 | 期初市值 | 期末市值 | 期间盈亏 |
|------|--------|--------|--------|------|----------|----------|----------|
| ...  |  ...   |  ...   |  ...   | ...  |   ...    |   ...    |   ...    |

## 四、港股持仓
（同上格式）

## 五、美股持仓
（同上格式）

## 六、盈亏贡献排名
| # | 市场 | 股票     | 期间盈亏   | 状态 |
|---|------|----------|----------|------|
| 1 | CN   | 中国平安 | +¥1,200  | 在持 |
| 2 | HK   | 腾讯     | -¥800    | 在持 |
```

### JSON 格式（`format=json` 或不带 format 参数）

```json
{
  "portfolioId": "...",
  "period": { "from": "2026-03-03", "to": "2026-03-03" },
  "portfolio": {
    "startNetAssets": 777848.1,
    "endNetAssets": 777848.1,
    "netAssetsChange": 0,
    "periodReturn": 0
  },
  "costs": {
    "commission": 120.5,
    "leverageInterest": 450.0,
    "total": 570.5
  },
  "exchangeRates": [],
  "positions": [
    {
      "assetCode": "sh601318",
      "name": "中国平安",
      "market": "CN",
      "start": { "quantity": 1000, "price": 52.3, "marketValue": 52300 },
      "end": { "quantity": 1000, "price": 53.5, "marketValue": 53500 },
      "periodPnl": 1200,
      "priceReturn": 2.29,
      "isCleared": false
    }
  ],
  "meta": {
    "snapshotAvailable": true,
    "startSnapshotDate": "2026-03-03",
    "endSnapshotDate": "2026-03-03"
  }
}
```

---

## 八、部署注意事项

### 环境变量

在 `.env` 文件中新增（可选）：

```env
SNAPSHOT_ALERT_WEBHOOK=https://your-webhook-endpoint.com
```

### 数据库迁移

**无需手动操作**。服务器启动时会自动检测并创建缺失的 `PositionSnapshot` 表。

### 重新部署后

1. 确认服务启动日志中出现：
   ```
   ✓ Table ensured: PositionSnapshot
   ✅ Snapshot scheduler started.
     Schedule: "30 6 * * 2-6" (Tue-Sat 06:30 Asia/Shanghai)
     Verify:   "0 8 * * 2-6"  (Tue-Sat 08:00 Asia/Shanghai)
   ```
2. 手动触发一次快照验证数据链路：
   ```
   POST /api/portfolio/{id}/snapshots/trigger
   ```
3. 调用期间报表接口确认报表数据完整性：
   ```
   GET /api/portfolio/{id}/period-report?from={昨日}&to={昨日}&format=markdown
   ```

---

## 九、已知限制

1. **汇率影响**：`exchangeRates` 字段目前返回空数组，日后接入独立汇率服务后会补充
2. **节假日**：系统不排除法定节假日，仅按工作日触发（周二~周六）。节假日数据由 upsert 幂等机制保证不会出错
3. **历史数据**：`PositionSnapshot` 表是新增的，首次部署后之前的日期没有个股快照数据，期间报表中这些日期将显示为空

---

**最后更新**：2026-03-04
