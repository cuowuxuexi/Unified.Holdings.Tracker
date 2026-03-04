# 任务：重新设计投资组合存档功能（备份与恢复）

## 任务背景

当前已实现的存档功能是按"年份"存档，但这不符合用户需求。用户需要的是一个**数据备份与恢复**功能：

- **创建存档**：导出当前投资组合的完整数据库记录到JSON文件
- **读取存档（恢复）**：从JSON文件恢复投资组合数据

这是一个"完整数据库备份"的功能，用于在项目重建后恢复所有数据。

---

## 功能需求

### 1. 创建存档（备份）

**触发方式**：点击"创建存档"按钮，直接保存

**存档内容**：当前投资组合的完整数据库记录

- Portfolio 表数据（账户设置：initialCash, cash, leverageEnabled, leverageRatio等）
- Asset 表数据（资产信息：股票代码、名称、市场等）
- Transaction 表数据（交易记录：交易时间、类型、价格、数量、useLeverage等）

**不包括**：

- QuoteSnapshot（行情快照）- 用户已有快照功能
- 计算出的统计数据（盈亏等）

**文件命名**：以当前日期命名，如 `backup-2026-01-05.json`

**存储位置**：`data/backups/` 目录

### 2. 读取存档（恢复）

**触发方式**：点击"读取存档"按钮，选择一个历史存档

**恢复行为**：用存档数据**覆盖**当前投资组合的数据

- 删除当前投资组合的所有 Transaction 和 Asset 记录
- 更新 Portfolio 表的账户设置
- 导入存档中的 Asset 和 Transaction 记录

**使用场景**：

1. 当前项目数据可能损坏或丢失
2. 重新建立项目后，需要从存档恢复所有数据

---

## 技术实现

### 需要修改的文件

#### 后端

1. **类型定义**：`apps/backend/src/types/archive.ts`
   - 重新定义备份数据结构 `PortfolioBackup`
   - 定义 `BackupMetadata`（备份元数据）

2. **备份服务**：`apps/backend/src/services/backupService.ts`（新建或重命名）
   - `createBackup(portfolioId)` - 创建备份
   - `listBackups(portfolioId)` - 列出备份
   - `restoreBackup(portfolioId, backupId)` - 恢复备份
   - `deleteBackup(backupId)` - 删除备份

3. **路由**：`apps/backend/src/routes/archive.ts`（修改）
   - `POST /api/portfolio/:id/backup` - 创建备份
   - `GET /api/portfolio/:id/backups` - 列出备份
   - `POST /api/portfolio/:id/restore/:backupId` - 恢复备份
   - `DELETE /api/backup/:backupId` - 删除备份

#### 前端

1. **API服务**：`frontend/src/services/api.ts`
   - 更新API方法名和参数

2. **创建存档对话框**：`frontend/src/components/CreateArchiveModal.tsx`
   - 简化为直接创建（无需选择年份）
   - 显示确认信息

3. **读取存档对话框**：`frontend/src/components/ViewArchivesModal.tsx`
   - 改为"读取存档"功能
   - 选择存档后确认恢复
   - 添加恢复警告提示

4. **根布局**：`frontend/src/app/routes/RootLayout.tsx`
   - 将"创建年度存档"改为"创建存档"
   - 将"查看历史存档"改为"读取存档"

---

## 数据结构设计

### PortfolioBackup

```typescript
interface PortfolioBackup {
  metadata: {
    backupId: string; // 备份唯一ID
    portfolioId: string; // 投资组合ID
    portfolioName: string; // 投资组合名称
    createdAt: string; // 备份创建时间 (ISO 8601)
    transactionCount: number; // 交易记录数量
    assetCount: number; // 资产数量
  };
  portfolio: {
    id: string;
    name: string;
    initialCash: number;
    cash: number;
    leverageEnabled: boolean;
    leverageRatio: number;
    leverageInterestRate: number;
    // ... 其他 Portfolio 字段
  };
  assets: Array<{
    id: string;
    code: string;
    name: string;
    market: string;
    portfolioId: string;
    // ... 其他 Asset 字段
  }>;
  transactions: Array<{
    id: string;
    portfolioId: string;
    assetId: string;
    type: string;
    date: string;
    quantity: number;
    price: number;
    amount: number;
    commission: number;
    useLeverage: boolean;
    leverageUsed: number | null;
    notes: string | null;
    // ... 其他 Transaction 字段
  }>;
}
```

### 文件存储结构

```
data/backups/
├── index.json                     # 备份索引
└── {portfolioId}/
    └── backup-2026-01-05-{shortId}.json
```

---

## API 端点设计

| 方法   | 端点                                   | 说明         |
| ------ | -------------------------------------- | ------------ |
| POST   | `/api/portfolio/:id/backup`            | 创建备份     |
| GET    | `/api/portfolio/:id/backups`           | 列出备份     |
| POST   | `/api/portfolio/:id/restore/:backupId` | 恢复备份     |
| GET    | `/api/backup/:backupId`                | 下载备份文件 |
| DELETE | `/api/backup/:backupId`                | 删除备份     |

---

## 实现步骤

### 步骤 1：更新后端类型定义

修改 `apps/backend/src/types/archive.ts`，将原有的年度存档类型改为备份类型。

### 步骤 2：创建备份服务

创建 `apps/backend/src/services/backupService.ts`：

- 实现 `createBackup()` - 从数据库导出完整数据
- 实现 `listBackups()` - 列出所有备份
- 实现 `restoreBackup()` - 删除现有数据并导入备份
- 实现 `deleteBackup()` - 删除备份文件

### 步骤 3：更新路由

修改 `apps/backend/src/routes/archive.ts`：

- 更新API端点
- 添加恢复功能
- 恢复时需要在事务中执行（删除+插入）

### 步骤 4：更新前端API

修改 `frontend/src/services/api.ts`：

- 更新方法名和参数
- 添加 `restoreBackup()` 方法

### 步骤 5：更新前端组件

修改 `frontend/src/components/CreateArchiveModal.tsx`：

- 移除年份选择
- 直接创建当前日期的备份

修改 `frontend/src/components/ViewArchivesModal.tsx`：

- 改为"读取存档"对话框
- 添加恢复确认对话框
- 显示恢复警告

### 步骤 6：更新菜单

修改 `frontend/src/app/routes/RootLayout.tsx`：

- 更新菜单项文本

---

## 注意事项

1. **恢复是危险操作**：恢复时会覆盖现有数据，需要二次确认
2. **事务处理**：恢复操作需要在数据库事务中执行
3. **ID处理**：恢复时保持原有ID还是生成新ID需要考虑
4. **备份文件独立**：备份文件应该可以在项目重建后使用

---

## 参考文件

- 现有类型定义：[`apps/backend/src/types/archive.ts`](apps/backend/src/types/archive.ts)
- 现有存档服务：[`apps/backend/src/services/archiveService.ts`](apps/backend/src/services/archiveService.ts)
- 现有存储服务：[`apps/backend/src/services/archiveStorageService.ts`](apps/backend/src/services/archiveStorageService.ts)
- 现有路由：[`apps/backend/src/routes/archive.ts`](apps/backend/src/routes/archive.ts)
- Prisma Schema：[`apps/backend/prisma/schema.prisma`](apps/backend/prisma/schema.prisma)
- 前端API：[`frontend/src/services/api.ts`](frontend/src/services/api.ts)
- 前端组件：[`frontend/src/components/CreateArchiveModal.tsx`](frontend/src/components/CreateArchiveModal.tsx)
- 前端组件：[`frontend/src/components/ViewArchivesModal.tsx`](frontend/src/components/ViewArchivesModal.tsx)

---

## 已创建的存档文件

注意：之前按年份创建的存档文件位于 `apps/backend/data/archives/` 目录，可以考虑迁移或删除：

- `apps/backend/data/archives/e5e2a241-b51e-4cf4-8f01-ee20e24e0dd2/2025/` - 2025投资组合的2025年存档
- `apps/backend/data/archives/746fa857-52f3-4bf7-ba68-47a08d8cda8a/2026/` - 2026投资组合的2026年存档
