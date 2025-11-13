# 交易备注与注意信息可编辑功能实现文档

## 概述

本文档描述了交易备注与投资组合注意信息可编辑并持久化功能的完整实现。

**实施日期**: 2025-11-09

## 功能特性

### 1. 交易备注可编辑
- ✅ 用户可以在交易列表的备注列直接编辑文本
- ✅ 输入内容自动保存（800ms 防抖）
- ✅ 保存过程中显示"保存中..."提示
- ✅ 页面刷新后数据持久化

### 2. 注意信息可编辑
- ✅ 投资组合页面顶部显示注意信息文本框
- ✅ 支持多行输入，自动调整高度
- ✅ 输入内容自动保存（1000ms 防抖）
- ✅ 保存过程中显示"保存中..."提示
- ✅ 页面刷新后数据持久化

## 技术实现

### 数据库层

#### Prisma Schema 变更
```prisma
model Portfolio {
  id                       String        @id @default(uuid())
  name                     String
  // ... 其他字段
  attentionInfo            String?       // 新增字段
  transactions             Transaction[]
  createdAt                DateTime      @default(now())
  updatedAt                DateTime      @updatedAt
}

model Transaction {
  // ... 其他字段
  notes         String?  // 已有字段，用于备注
}
```

#### 数据库迁移
使用 `prisma db push` 直接推送了 schema 变更到数据库。

### 后端实现

#### 1. 仓储层 (`packages/infra/src/storage/storage.prisma.ts`)

新增两个函数：

**updateTransactionNotes**
- 更新交易记录的 `notes` 字段
- 清除相关缓存
- 返回更新后的交易对象

**updatePortfolioAttention**
- 更新投资组合的 `attentionInfo` 字段
- 更新缓存
- 返回完整的投资组合对象

#### 2. Use Case 层 (`packages/application/src/use-cases/`)

**update-transaction-notes.use-case.ts**
- 验证投资组合和交易是否存在
- 调用仓储更新备注

**update-portfolio-attention.use-case.ts**
- 验证投资组合是否存在
- 调用仓储更新注意信息

#### 3. HTTP 路由 (`apps/backend/src/routes/portfolio.ts`)

**PATCH /api/portfolio/:id/transactions/:txId/notes**
- 请求体: `{ notes: string }`
- 响应: 更新后的交易对象
- 错误处理: 404（投资组合或交易不存在）

**PATCH /api/portfolio/:id/attention**
- 请求体: `{ attentionInfo: string }`
- 响应: `{ id: string, attentionInfo?: string }`
- 错误处理: 404（投资组合不存在）

### 前端实现

#### 1. API 客户端 (`frontend/src/services/api.ts`)

新增两个方法：
- `updateTransactionNotes(portfolioId, transactionId, notes)`
- `updatePortfolioAttention(portfolioId, attentionInfo)`

#### 2. Zustand Store (`frontend/src/store/index.ts`)

新增两个 actions：

**updateTransactionNotes**
- 调用 API 更新备注
- 更新本地 `selectedPortfolioDetail` 状态中的交易列表
- 错误处理并抛出异常

**updateAttentionInfo**
- 调用 API 更新注意信息
- 更新本地 `selectedPortfolioDetail.attentionInfo`
- 错误处理并抛出异常

#### 3. TransactionList 组件 (`frontend/src/components/TransactionList.tsx`)

**实现细节:**
- 使用 `useState` 维护本地备注状态（即时显示用户输入）
- 使用 `useState` 跟踪正在保存的交易ID
- 使用 lodash 的 `debounce` 实现防抖保存（800ms）
- 备注列渲染为 `Input` 组件，支持直接编辑
- 保存中显示"保存中..."后缀提示

**用户体验:**
- 输入即时响应，无延迟
- 自动保存，无需手动点击保存按钮
- 保存失败时显示错误提示
- 保存成功静默处理

#### 4. PortfolioSummary 组件 (`frontend/src/components/PortfolioSummary.tsx`)

**实现细节:**
- 使用 `useState` 维护本地注意信息状态
- 使用 `useEffect` 同步 portfolio 的 `attentionInfo` 到本地状态
- 使用 lodash 的 `debounce` 实现防抖保存（1000ms）
- TextArea 为受控组件，绑定到本地状态
- 保存中显示"保存中..."标签并降低透明度

**用户体验:**
- 支持多行文本输入
- 自动调整高度（3-6行）
- 自动保存
- 保存状态可视化
- 页面切换回来时显示最新内容

### 类型定义同步

更新了以下文件中的类型定义：
- `apps/backend/src/types/index.ts` - Portfolio 接口
- `packages/domain/src/entities/portfolio.ts` - Portfolio 接口
- `frontend/src/store/types.ts` - Portfolio 和 Transaction 接口
- `packages/domain/src/repositories/portfolio-repository.ts` - 仓储接口

### 依赖项

新增前端依赖：
```json
{
  "lodash": "^4.17.21",
  "@types/lodash": "^4.17.13"
}
```

## API 接口文档

### 更新交易备注

**端点**: `PATCH /api/portfolio/:id/transactions/:txId/notes`

**参数**:
- `id` (路径参数): 投资组合 ID
- `txId` (路径参数): 交易 ID

**请求体**:
```json
{
  "notes": "这是备注内容"
}
```

**响应** (200):
```json
{
  "id": "transaction-uuid",
  "date": "2025-11-09T10:00:00.000Z",
  "type": "BUY",
  "assetCode": "sh600519",
  "quantity": 100,
  "price": 1850.50,
  "amount": 185050,
  "commission": 50,
  "notes": "这是备注内容"
}
```

**错误响应**:
- 400: 缺少 notes 字段
- 404: 投资组合或交易不存在

### 更新投资组合注意信息

**端点**: `PATCH /api/portfolio/:id/attention`

**参数**:
- `id` (路径参数): 投资组合 ID

**请求体**:
```json
{
  "attentionInfo": "本月需要关注的事项：\n1. 股息发放日期\n2. 财报公布时间"
}
```

**响应** (200):
```json
{
  "id": "portfolio-uuid",
  "attentionInfo": "本月需要关注的事项：\n1. 股息发放日期\n2. 财报公布时间"
}
```

**错误响应**:
- 400: 缺少 attentionInfo 字段
- 404: 投资组合不存在

## 数据兼容性

- 旧数据中 `attentionInfo` 为 `null` 时，前端显示为空字符串
- 旧交易记录中 `notes` 为 `null` 时，前端显示为空字符串
- 允许保存空字符串（清空内容）

## 缓存策略

### 后端缓存
- 更新交易备注后清除相关投资组合缓存
- 更新注意信息后更新投资组合缓存
- 使用 5 分钟 TTL

### 前端状态管理
- 更新成功后同步更新 Zustand store 中的本地状态
- 避免不必要的全量数据重新获取
- 保持 UI 响应性

## 性能优化

1. **防抖处理**: 避免频繁 API 调用
   - 交易备注: 800ms
   - 注意信息: 1000ms

2. **本地状态优先**: 用户输入立即反映在 UI，无延迟

3. **智能缓存**: 更新后只刷新相关缓存，不影响其他数据

4. **批量操作**: 使用 Prisma 事务确保数据一致性

## 测试建议

### 功能测试
1. ✅ 编辑交易备注并刷新页面验证持久化
2. ✅ 编辑注意信息并刷新页面验证持久化
3. ✅ 快速输入多次，验证防抖生效
4. ✅ 网络错误时错误提示显示正常
5. ✅ 切换不同投资组合，验证数据隔离

### 边界测试
1. 输入超长文本
2. 输入特殊字符（换行符、表情符号等）
3. 并发编辑多个交易备注
4. 快速切换投资组合

### 性能测试
1. 大量交易记录的列表渲染性能
2. 防抖期间快速输入的响应性
3. 缓存命中率

## 已知限制

1. **离线支持**: 目前不支持离线编辑，需要网络连接
2. **冲突解决**: 多用户同时编辑时以最后保存为准（Last Write Wins）
3. **历史记录**: 不保留备注和注意信息的编辑历史

## 后续改进方向

1. **版本控制**: 记录备注和注意信息的修改历史
2. **富文本编辑**: 支持格式化文本（加粗、列表等）
3. **协作编辑**: 实时同步多用户编辑
4. **离线支持**: 使用 Service Worker 和 IndexedDB 支持离线编辑
5. **撤销/重做**: 实现编辑操作的撤销重做功能

## 文件变更清单

### 新增文件
- `packages/application/src/use-cases/update-transaction-notes.use-case.ts`
- `packages/application/src/use-cases/update-portfolio-attention.use-case.ts`
- `docs/EDITABLE_NOTES_AND_ATTENTION_IMPLEMENTATION.md` (本文档)

### 修改文件

**后端**:
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/types/index.ts`
- `apps/backend/src/container.ts`
- `apps/backend/src/routes/portfolio.ts`
- `packages/domain/src/entities/portfolio.ts`
- `packages/domain/src/repositories/portfolio-repository.ts`
- `packages/infra/src/storage/storage.prisma.ts`
- `packages/infra/src/storage/prisma-portfolio.repository.ts`
- `packages/application/src/index.ts`

**前端**:
- `frontend/package.json`
- `frontend/src/store/types.ts`
- `frontend/src/store/index.ts`
- `frontend/src/services/api.ts`
- `frontend/src/components/TransactionList.tsx`
- `frontend/src/components/PortfolioSummary.tsx`

## 总结

本次实现成功为投资组合跟踪系统添加了交易备注和注意信息的可编辑及持久化功能。通过合理的架构设计、防抖优化和缓存策略，确保了良好的用户体验和系统性能。所有变更都遵循了现有的架构模式，保持了代码的一致性和可维护性。

