# 设计文档：交易记录导出功能

## Context

当前系统已实现批量导入功能（CSV），但缺少对应的导出功能。用户需要能够将交易数据导出用于备份、分析和外部工具集成。

**相关代码**:
- 现有批量导入: `apps/backend/src/services/batchImportService.ts`
- 现有 xlsx 依赖: 已在 `apps/backend/package.json` 中

## Goals / Non-Goals

### Goals
- 支持 CSV 和 Excel 两种导出格式
- 提供灵活的筛选选项（日期范围、交易类型）
- 导出文件包含所有交易字段，格式与导入模板一致
- 文件名清晰标识（组合名称 + 时间戳）
- 良好的用户体验（对话框、加载状态、错误提示）

### Non-Goals
- 不支持自定义字段选择（导出所有字段）
- 不支持批量导出多个投资组合（一次导出一个）
- 不支持定时自动导出
- 不支持云存储直接上传

## Decisions

### 1. 导出格式选择

**决策**: 支持 CSV 和 Excel (.xlsx) 两种格式

**理由**:
- CSV: 简单、通用、易于程序处理
- Excel: 更好的可读性、支持格式化、用户友好
- 使用已有的 `xlsx` 库，无需新增依赖

**替代方案**:
- 仅支持 CSV: 过于简单，用户体验不佳
- 支持 JSON: 不适合非技术用户

### 2. API 设计

**决策**: 使用 GET 请求，通过 query 参数传递筛选条件

```
GET /api/portfolio/:portfolioId/transactions/export?format=csv&startDate=2025-01-01&endDate=2025-12-31&types=BUY,SELL
```

**Query 参数**:
- `format`: `csv` | `excel` (默认 `csv`)
- `startDate`: ISO 8601 日期（可选）
- `endDate`: ISO 8601 日期（可选）
- `types`: 逗号分隔的交易类型列表（可选）

**响应**:
- Content-Type: `text/csv` 或 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="组合名称_交易记录_20251110.csv"`

**理由**:
- GET 请求语义正确（读取操作）
- 浏览器可直接触发文件下载
- Query 参数简单直观

**替代方案**:
- POST 请求: 不符合 RESTful 语义（导出不是创建操作）
- 分页导出: 增加复杂度，当前数据量不需要

### 3. 字段映射

**决策**: 导出字段与导入模板保持一致

CSV/Excel 列：
```
日期,类型,资产代码,资产名称,数量,价格,金额,手续费,融资额度,货币,汇率,备注
```

**理由**:
- 用户熟悉（与导入模板一致）
- 支持"导出-修改-导入"工作流
- 包含所有必要信息

### 4. 前端实现

**决策**: 使用 Modal 对话框 + 筛选表单

**组件结构**:
```tsx
<TransactionList>
  <Button onClick={showExportDialog}>导出</Button>
  <ExportDialog
    visible={visible}
    portfolioId={portfolioId}
    onExport={handleExport}
    onCancel={handleCancel}
  />
</TransactionList>
```

**ExportDialog 包含**:
- 格式选择（Radio: CSV / Excel）
- 日期范围选择（DatePicker.RangePicker）
- 交易类型多选（Checkbox.Group）
- 导出按钮（带 loading 状态）

**理由**:
- Ant Design Modal 提供良好的 UX
- 筛选选项集中在一个对话框，清晰直观
- 可复用组件设计

### 5. 文件下载实现

**决策**: 使用浏览器原生下载机制

```typescript
const response = await fetch(url);
const blob = await response.blob();
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = filename;
link.click();
URL.revokeObjectURL(link.href);
```

**理由**:
- 简单可靠
- 浏览器自动处理文件保存
- 无需第三方库

**替代方案**:
- 使用 `file-saver` 库: 增加依赖，原生方法已足够

## Risks / Trade-offs

### 风险 1: 大数据量导出性能
**风险**: 如果交易记录超过 10,000 条，导出可能较慢

**缓解措施**:
- 当前系统主要用于个人投资组合，数据量通常 < 5,000 条
- 如果未来需要，可添加分页导出或后台任务

### 风险 2: 内存占用
**风险**: 在内存中生成大文件可能导致内存压力

**缓解措施**:
- 使用流式写入（xlsx 库支持）
- 设置合理的数据量上限（如 50,000 条）

### 风险 3: 编码问题
**风险**: CSV 文件在 Excel 中可能出现中文乱码

**缓解措施**:
- 输出 UTF-8 BOM 头（`\uFEFF`）
- 在文档中说明 Excel 打开方式

## Migration Plan

无需迁移，纯新增功能。

**部署步骤**:
1. 部署后端代码（新增路由和服务）
2. 部署前端代码（新增组件）
3. 更新用户文档

**回滚方案**:
- 如有问题，可直接移除导出按钮，不影响现有功能

## Open Questions

- [ ] 是否需要支持导出所有投资组合的汇总数据？
  - **决策**: 暂不支持，可在未来版本添加
  
- [ ] 是否需要记录导出历史？
  - **决策**: 暂不需要，导出是只读操作

- [ ] 是否需要支持自定义列顺序？
  - **决策**: 暂不支持，保持与导入模板一致

