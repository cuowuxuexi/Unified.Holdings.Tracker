# 实现任务清单

## 1. 后端实现
- [ ] 1.1 创建 `exportService.ts` 服务
  - [ ] 1.1.1 实现 `exportTransactionsToCSV()` 方法
  - [ ] 1.1.2 实现 `exportTransactionsToExcel()` 方法
  - [ ] 1.1.3 添加日期范围和类型筛选逻辑
- [ ] 1.2 在 `portfolio.ts` 路由添加导出端点
  - [ ] 1.2.1 `GET /api/portfolio/:id/transactions/export` 端点
  - [ ] 1.2.2 支持 query 参数: `format`, `startDate`, `endDate`, `types`
  - [ ] 1.2.3 设置正确的 Content-Type 和 Content-Disposition headers
- [ ] 1.3 添加类型定义
  - [ ] 1.3.1 `ExportFormat` 枚举 (CSV, EXCEL)
  - [ ] 1.3.2 `ExportOptions` 接口
- [ ] 1.4 更新 OpenAPI 文档定义

## 2. 前端实现
- [ ] 2.1 创建 `ExportDialog.tsx` 组件
  - [ ] 2.1.1 格式选择器（CSV/Excel）
  - [ ] 2.1.2 日期范围选择器
  - [ ] 2.1.3 交易类型多选框
  - [ ] 2.1.4 导出按钮和加载状态
- [ ] 2.2 更新 `TransactionList.tsx`
  - [ ] 2.2.1 添加"导出"按钮到工具栏
  - [ ] 2.2.2 集成 ExportDialog 组件
  - [ ] 2.2.3 处理导出 API 调用和文件下载
- [ ] 2.3 生成更新的 API 客户端
  - [ ] 2.3.1 运行 `npm run generate:api -w frontend`

## 3. 测试
- [ ] 3.1 后端单元测试
  - [ ] 3.1.1 测试 CSV 导出格式正确性
  - [ ] 3.1.2 测试 Excel 导出格式正确性
  - [ ] 3.1.3 测试日期范围筛选
  - [ ] 3.1.4 测试交易类型筛选
  - [ ] 3.1.5 测试空数据情况
- [ ] 3.2 前端组件测试
  - [ ] 3.2.1 测试 ExportDialog 交互
  - [ ] 3.2.2 测试文件下载触发

## 4. 文档
- [ ] 4.1 更新用户文档
  - [ ] 4.1.1 在 `docs/` 添加导出功能使用说明
  - [ ] 4.1.2 更新 README.md 功能列表
- [ ] 4.2 更新 API 文档（OpenAPI 自动生成）

## 5. 验收测试
- [ ] 5.1 导出 CSV 文件，用 Excel 打开验证格式
- [ ] 5.2 导出 Excel 文件，验证所有字段完整
- [ ] 5.3 测试日期筛选功能
- [ ] 5.4 测试交易类型筛选功能
- [ ] 5.5 测试文件名包含组合名称和时间戳
- [ ] 5.6 测试大数据量导出（1000+ 条记录）

