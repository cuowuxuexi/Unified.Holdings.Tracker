# Transaction Management Specification - Delta

## ADDED Requirements

### Requirement: 交易记录导出

系统 SHALL 提供交易记录导出功能，允许用户将投资组合的交易记录导出为 CSV 或 Excel 文件。

#### Scenario: 导出 CSV 格式
- **WHEN** 用户选择导出格式为 CSV
- **AND** 点击导出按钮
- **THEN** 系统生成 CSV 文件
- **AND** 文件包含所有交易记录字段（日期、类型、资产代码、资产名称、数量、价格、金额、手续费、融资额度、货币、汇率、备注）
- **AND** 文件名格式为 `{组合名称}_交易记录_{YYYYMMDD}.csv`
- **AND** 浏览器自动下载文件

#### Scenario: 导出 Excel 格式
- **WHEN** 用户选择导出格式为 Excel
- **AND** 点击导出按钮
- **THEN** 系统生成 Excel (.xlsx) 文件
- **AND** 文件包含所有交易记录字段
- **AND** 文件名格式为 `{组合名称}_交易记录_{YYYYMMDD}.xlsx`
- **AND** 浏览器自动下载文件

#### Scenario: 按日期范围筛选导出
- **WHEN** 用户指定开始日期和结束日期
- **AND** 点击导出按钮
- **THEN** 系统仅导出该日期范围内的交易记录
- **AND** 日期范围包含开始日期和结束日期（闭区间）

#### Scenario: 按交易类型筛选导出
- **WHEN** 用户选择一个或多个交易类型（如 BUY, SELL）
- **AND** 点击导出按钮
- **THEN** 系统仅导出选中类型的交易记录

#### Scenario: 组合筛选条件导出
- **WHEN** 用户同时指定日期范围和交易类型
- **AND** 点击导出按钮
- **THEN** 系统导出同时满足两个条件的交易记录

#### Scenario: 导出空数据
- **WHEN** 筛选条件下没有交易记录
- **AND** 点击导出按钮
- **THEN** 系统生成仅包含表头的文件
- **AND** 显示提示信息"当前筛选条件下无交易记录"

#### Scenario: 导出失败处理
- **WHEN** 导出过程中发生错误（如网络错误、服务器错误）
- **THEN** 系统显示错误提示信息
- **AND** 不生成文件
- **AND** 用户可以重试导出操作

### Requirement: 导出数据格式一致性

导出的 CSV/Excel 文件格式 SHALL 与批量导入模板保持一致，以支持"导出-修改-导入"工作流。

#### Scenario: CSV 格式一致性
- **WHEN** 用户导出 CSV 文件
- **THEN** CSV 列顺序和列名与导入模板完全一致
- **AND** 日期格式为 ISO 8601 (YYYY-MM-DD)
- **AND** 数值字段不包含千分位分隔符
- **AND** 文件编码为 UTF-8 with BOM（确保 Excel 正确显示中文）

#### Scenario: Excel 格式一致性
- **WHEN** 用户导出 Excel 文件
- **THEN** Excel 列顺序和列名与导入模板完全一致
- **AND** 日期格式为 ISO 8601 (YYYY-MM-DD)
- **AND** 数值字段为数字类型（非文本）

### Requirement: 导出 API 端点

系统 SHALL 提供 RESTful API 端点用于导出交易记录。

#### Scenario: API 请求成功
- **WHEN** 客户端发送 GET 请求到 `/api/portfolio/:portfolioId/transactions/export`
- **AND** 提供有效的 portfolioId
- **AND** 提供可选的 query 参数（format, startDate, endDate, types）
- **THEN** 服务器返回 200 状态码
- **AND** 响应 Content-Type 为 `text/csv` 或 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **AND** 响应包含 Content-Disposition header 指定文件名
- **AND** 响应 body 为文件内容

#### Scenario: 投资组合不存在
- **WHEN** 客户端请求导出不存在的投资组合
- **THEN** 服务器返回 404 状态码
- **AND** 响应包含错误信息 "Portfolio not found"

#### Scenario: 无效的日期范围
- **WHEN** 客户端提供的 startDate 晚于 endDate
- **THEN** 服务器返回 400 状态码
- **AND** 响应包含错误信息 "Invalid date range: startDate must be before or equal to endDate"

#### Scenario: 无效的交易类型
- **WHEN** 客户端提供的 types 参数包含不支持的交易类型
- **THEN** 服务器返回 400 状态码
- **AND** 响应包含错误信息列出有效的交易类型

