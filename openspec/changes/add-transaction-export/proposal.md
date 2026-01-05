# Change: 添加交易记录导出功能

## Why

目前系统支持通过 CSV 批量导入交易记录，但缺少导出功能。用户需要能够将投资组合的交易记录导出为 CSV 或 Excel 文件，用于：
- 数据备份和归档
- 外部分析和报表制作
- 与其他投资管理工具集成
- 税务申报和财务审计

## What Changes

- 添加交易记录导出 API 端点（支持 CSV 和 Excel 格式）
- 在前端交易列表页面添加"导出"按钮
- 支持按日期范围、交易类型筛选导出数据
- 导出文件包含所有交易字段（日期、类型、资产、数量、价格、金额、手续费等）
- 文件名自动包含投资组合名称和导出时间戳

## Impact

### Affected specs
- `transaction-management` (新增导出功能)

### Affected code
- **后端**:
  - `apps/backend/src/routes/portfolio.ts` - 添加导出路由
  - `apps/backend/src/services/exportService.ts` - 新增导出服务（CSV/Excel 生成）
  - `apps/backend/src/types/index.ts` - 添加导出相关类型定义
  
- **前端**:
  - `frontend/src/features/transaction/components/TransactionList.tsx` - 添加导出按钮和筛选器
  - `frontend/src/features/transaction/components/ExportDialog.tsx` - 新增导出对话框组件
  - `frontend/src/generated/api/` - 更新 API 客户端（从 OpenAPI 生成）

### Dependencies
- 后端已有 `xlsx` 包（用于批量导入），可复用于导出
- 无需新增外部依赖

