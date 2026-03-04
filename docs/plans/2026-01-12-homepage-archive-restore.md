# 首页存档恢复功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在首页实现直接读取存档功能，无需先创建投资组合即可恢复数据

**Architecture:**

- 后端新增全局备份列表 API（GET /api/backups），不依赖特定 portfolioId
- 前端修改 ViewArchivesModal 支持全局模式
- 首页增加"读取存档"快速入口按钮
- 恢复逻辑：如果备份对应的组合不存在，自动创建同名组合后恢复

**Tech Stack:** Express, Prisma, React, Ant Design, TypeScript

---

## Task 1: 后端 - BackupService 新增全局列表方法

**Files:**

- Modify: `apps/backend/src/services/backupService.ts:285-307`

**Step 1: 添加 listAllBackups 方法**

在 `BackupService` 类中，在 `listBackups` 方法后添加新方法：

```typescript
/**
 * 列出所有备份（不限定投资组合）
 * @returns 所有备份列表
 */
async listAllBackups(): Promise<BackupIndexEntry[]> {
  const index = this.getIndex();
  const backups: BackupIndexEntry[] = Object.values(index.backups);

  // 按创建时间降序排序
  backups.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return backups;
}
```

**Step 2: 验证代码编译通过**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run build -w backend`
Expected: 编译成功，无错误

---

## Task 2: 后端 - BackupService 新增智能恢复方法

**Files:**

- Modify: `apps/backend/src/services/backupService.ts`

**Step 1: 添加 restoreBackupSmart 方法**

在 `restoreBackup` 方法后添加智能恢复方法：

```typescript
/**
 * 智能恢复备份
 * 如果目标组合不存在，自动创建同名组合后恢复
 * @param backupId 备份 ID
 * @returns 恢复结果，包含可能新创建的 portfolioId
 */
async restoreBackupSmart(
  backupId: string
): Promise<RestoreResult & { portfolioId?: string; isNewPortfolio?: boolean }> {
  console.log(`[BackupService] Smart restoring backup ${backupId}`);

  try {
    // 获取备份数据
    const backup = await this.getBackup(backupId);
    if (!backup) {
      return {
        success: false,
        message: 'Backup not found',
        error: 'Backup not found',
      };
    }

    const originalPortfolioId = backup.metadata.portfolioId;
    let targetPortfolioId = originalPortfolioId;
    let isNewPortfolio = false;

    // 检查原投资组合是否存在
    const existingPortfolio = await prisma.portfolio.findUnique({
      where: { id: originalPortfolioId },
    });

    if (!existingPortfolio) {
      // 创建新投资组合
      console.log(`[BackupService] Original portfolio not found, creating new one`);
      const newPortfolio = await prisma.portfolio.create({
        data: {
          id: originalPortfolioId, // 使用原始 ID 保持一致性
          name: backup.portfolio.name,
          initialCash: backup.portfolio.initialCash,
          cash: backup.portfolio.cash,
          leverageTotalAmount: backup.portfolio.leverageTotalAmount,
          leverageUsedAmount: backup.portfolio.leverageUsedAmount,
          leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
          leverageCostRate: backup.portfolio.leverageCostRate,
          attentionInfo: backup.portfolio.attentionInfo,
        },
      });
      targetPortfolioId = newPortfolio.id;
      isNewPortfolio = true;
      console.log(`[BackupService] Created new portfolio: ${targetPortfolioId}`);
    }

    // 使用事务执行恢复操作
    await prisma.$transaction(async (tx) => {
      // 1. 删除现有的交易记录（如果组合已存在）
      if (!isNewPortfolio) {
        await tx.transaction.deleteMany({
          where: { portfolioId: targetPortfolioId },
        });
        console.log(`[BackupService] Deleted existing transactions`);

        // 2. 更新投资组合设置
        await tx.portfolio.update({
          where: { id: targetPortfolioId },
          data: {
            initialCash: backup.portfolio.initialCash,
            cash: backup.portfolio.cash,
            leverageTotalAmount: backup.portfolio.leverageTotalAmount,
            leverageUsedAmount: backup.portfolio.leverageUsedAmount,
            leverageAvailableAmount: backup.portfolio.leverageAvailableAmount,
            leverageCostRate: backup.portfolio.leverageCostRate,
            attentionInfo: backup.portfolio.attentionInfo,
          },
        });
        console.log(`[BackupService] Updated portfolio settings`);
      }

      // 3. 确保资产存在（使用 upsert）
      for (const asset of backup.assets) {
        await tx.asset.upsert({
          where: { code: asset.code },
          update: {
            name: asset.name,
            market: asset.market,
          },
          create: {
            code: asset.code,
            name: asset.name,
            market: asset.market,
          },
        });
      }
      console.log(`[BackupService] Ensured ${backup.assets.length} assets`);

      // 4. 导入交易记录（使用新 ID 避免冲突）
      for (const transaction of backup.transactions) {
        await tx.transaction.create({
          data: {
            id: uuidv4(), // 生成新 ID
            portfolioId: targetPortfolioId,
            type: transaction.type,
            date: new Date(transaction.date),
            assetCode: transaction.assetCode,
            quantity: transaction.quantity,
            price: transaction.price,
            amount: transaction.amount,
            commission: transaction.commission,
            leverageUsed: transaction.leverageUsed,
            currency: transaction.currency,
            exchangeRate: transaction.exchangeRate,
            notes: transaction.notes,
          },
        });
      }
      console.log(
        `[BackupService] Imported ${backup.transactions.length} transactions`
      );
    });

    console.log(`[BackupService] Backup restored successfully`);

    return {
      success: true,
      message: isNewPortfolio
        ? `Backup restored to new portfolio "${backup.portfolio.name}"`
        : 'Backup restored successfully',
      restoredTransactionCount: backup.transactions.length,
      restoredAssetCount: backup.assets.length,
      portfolioId: targetPortfolioId,
      isNewPortfolio,
    };
  } catch (error) {
    console.error('[BackupService] Error restoring backup:', error);
    return {
      success: false,
      message: 'Failed to restore backup',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Step 2: 验证代码编译通过**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run build -w backend`
Expected: 编译成功，无错误

---

## Task 3: 后端 - 新增全局备份路由

**Files:**

- Modify: `apps/backend/src/routes/archive.ts:23-25`

**Step 1: 在备份 API 区域添加全局列表路由**

在 `// 备份/恢复 API（新功能）` 注释后，`router.post('/portfolio/:id/backup'` 之前添加：

```typescript
/**
 * GET /api/backups
 * 列出所有备份（全局，不限定投资组合）
 */
router.get(
  '/backups',
  asyncHandler(async (_req: Request, res: Response) => {
    const backups = await backupService.listAllBackups();

    res.json({
      backups,
      total: backups.length,
    });
  })
);

/**
 * POST /api/backup/:backupId/restore
 * 智能恢复备份（自动创建组合如果不存在）
 */
router.post(
  '/backup/:backupId/restore',
  asyncHandler(async (req: Request, res: Response) => {
    const { backupId } = req.params;

    // 执行智能恢复
    const result = await backupService.restoreBackupSmart(backupId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to restore backup',
      });
    }

    res.json({
      success: true,
      message: result.message,
      restoredTransactionCount: result.restoredTransactionCount,
      restoredAssetCount: result.restoredAssetCount,
      portfolioId: result.portfolioId,
      isNewPortfolio: result.isNewPortfolio,
    });
  })
);
```

**Step 2: 验证代码编译通过**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run build -w backend`
Expected: 编译成功，无错误

---

## Task 4: 前端 - API 客户端新增全局备份方法

**Files:**

- Modify: `frontend/src/services/api.ts:586-592`

**Step 1: 在 deleteBackup 方法后添加全局备份 API 方法**

```typescript
/**
 * 获取所有备份列表（全局）
 */
getAllBackups: async (): Promise<BackupListResponse> => {
  try {
    const response = await axios.get<BackupListResponse>(
      `${API_BASE_URL}/api/backups`
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching all backups:', error);
    throw error;
  }
},

/**
 * 智能恢复备份（自动创建组合如果不存在）
 */
restoreBackupSmart: async (
  backupId: string
): Promise<RestoreBackupResponse & { portfolioId?: string; isNewPortfolio?: boolean }> => {
  try {
    const response = await axios.post<
      RestoreBackupResponse & { portfolioId?: string; isNewPortfolio?: boolean }
    >(`${API_BASE_URL}/api/backup/${backupId}/restore`);
    return response.data;
  } catch (error) {
    console.error(`Error smart restoring backup ${backupId}:`, error);
    throw error;
  }
},
```

**Step 2: 验证前端编译**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run build -w frontend`
Expected: 编译成功，无错误

---

## Task 5: 前端 - 修改 ViewArchivesModal 支持全局模式

**Files:**

- Modify: `frontend/src/components/ViewArchivesModal.tsx`

**Step 1: 修改组件 Props 类型**

将 `portfolioId` 改为可选：

```typescript
interface ViewArchivesModalProps {
  open: boolean;
  portfolioId?: string | null; // 改为可选
  onClose: () => void;
  onRestoreSuccess?: (portfolioId?: string) => void; // 添加 portfolioId 参数
}
```

**Step 2: 修改 fetchBackups 函数**

```typescript
// 获取备份列表
const fetchBackups = useCallback(async () => {
  setLoading(true);
  try {
    // 根据是否有 portfolioId 决定调用哪个 API
    const response = portfolioId
      ? await apiClient.getBackups(portfolioId)
      : await apiClient.getAllBackups();
    setBackups(response.backups || []);
  } catch (error) {
    console.error('获取存档列表失败:', error);
    messageApi.error('获取存档列表失败');
  } finally {
    setLoading(false);
  }
}, [portfolioId, messageApi]);
```

**Step 3: 修改 useEffect 依赖**

```typescript
// 当对话框打开时获取数据
useEffect(() => {
  if (open) {
    fetchBackups();
  }
}, [open, fetchBackups]);
```

**Step 4: 修改 handleRestore 函数**

```typescript
// 恢复备份
const handleRestore = async (backup: BackupIndexEntry) => {
  setRestoringId(backup.backupId);
  try {
    let result;

    if (portfolioId) {
      // 有 portfolioId，使用原有的恢复逻辑
      result = await apiClient.restoreBackup(portfolioId, backup.backupId);
    } else {
      // 无 portfolioId，使用智能恢复
      result = await apiClient.restoreBackupSmart(backup.backupId);
    }

    if (result.success) {
      const countInfo = result.restoredTransactionCount
        ? `已恢复 ${result.restoredTransactionCount} 条交易记录`
        : '';
      const newPortfolioInfo = (result as any).isNewPortfolio
        ? '（已自动创建投资组合）'
        : '';
      messageApi.success(`存档恢复成功！${countInfo}${newPortfolioInfo}`);
      onRestoreSuccess?.((result as any).portfolioId);
      onClose();
    } else {
      messageApi.error(result.message || '恢复存档失败');
    }
  } catch (error) {
    console.error('恢复存档失败:', error);
    messageApi.error('恢复存档失败');
  } finally {
    setRestoringId(null);
  }
};
```

**Step 5: 在表格列定义中添加投资组合名称列（全局模式下显示）**

在 `columns` 定义中，在"创建时间"列后添加：

```typescript
{
  title: '投资组合',
  dataIndex: 'portfolioName',
  key: 'portfolioName',
  width: 150,
  render: (name: string) => <Text>{name}</Text>,
  // 只在全局模式下显示
  hidden: !!portfolioId,
},
```

**Step 6: 修改表格使用 columns filter**

```typescript
<Table
  columns={columns.filter(col => !col.hidden)}
  dataSource={backups}
  rowKey="backupId"
  size="small"
  pagination={false}
  scroll={{ x: 800 }}
/>
```

**Step 7: 验证前端编译**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run build -w frontend`
Expected: 编译成功，无错误

---

## Task 6: 前端 - 首页添加"读取存档"按钮

**Files:**

- Modify: `frontend/src/features/portfolio/pages/PortfolioListPage.tsx`
- Modify: `frontend/src/features/portfolio/pages/PortfolioListPage.module.css`

**Step 1: 导入所需组件和图标**

在文件顶部添加导入：

```typescript
import { HistoryOutlined } from '@ant-design/icons';
import { ViewArchivesModal } from '../../../components/ViewArchivesModal';
```

**Step 2: 添加状态变量**

在组件内部，`isAdvancedModalVisible` 状态后添加：

```typescript
const [isViewArchivesModalVisible, setIsViewArchivesModalVisible] =
  useState(false);
```

**Step 3: 添加恢复成功处理函数**

在 `handleAdvancedSuccess` 后添加：

```typescript
const handleRestoreSuccess = (portfolioId?: string) => {
  setCreationSuccessMessage('存档恢复成功！');
  setIsViewArchivesModalVisible(false);
  if (portfolioId) {
    // 跳转到恢复的投资组合
    navigate(`/portfolio/${portfolioId}`);
  }
};
```

**Step 4: 在左侧区域添加按钮**

在 `createCardContainer` div 内，`HeroCreateCard` 后添加：

```tsx
<Button
  icon={<HistoryOutlined />}
  onClick={() => setIsViewArchivesModalVisible(true)}
  size="large"
  className={styles.heroRestoreButton}
>
  读取存档
</Button>
```

**Step 5: 在组件底部添加 Modal**

在 `Modal` 组件后（closing `</div>` 之前）添加：

```tsx
<ViewArchivesModal
  open={isViewArchivesModalVisible}
  portfolioId={null}
  onClose={() => setIsViewArchivesModalVisible(false)}
  onRestoreSuccess={handleRestoreSuccess}
/>
```

**Step 6: 添加样式**

在 `PortfolioListPage.module.css` 中，`.heroCreateButton:hover` 规则后添加：

```css
.heroRestoreButton {
  background: transparent !important;
  border: 2px solid #121212 !important;
  border-radius: 10px !important;
  font-weight: 600 !important;
  font-size: 16px !important;
  height: 48px !important;
  padding: 0 24px !important;
  color: #121212 !important;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}

.heroRestoreButton:hover {
  background: rgba(18, 18, 18, 0.05) !important;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}
```

**Step 7: 修改 createCardContainer 布局**

更新 `.createCardContainer` 样式：

```css
.createCardContainer {
  display: flex;
  justify-content: flex-start;
  gap: 12px;
  padding: 0;
}
```

**Step 8: 验证前端编译**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run build -w frontend`
Expected: 编译成功，无错误

---

## Task 7: 集成测试

**Step 1: 启动后端服务**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run dev:backend`
Expected: 后端服务在 http://localhost:3001 启动

**Step 2: 启动前端服务**

Run: `cd D:\Unified.Holdings.Tracker-main && npm run dev:frontend`
Expected: 前端服务在 http://localhost:5173 启动

**Step 3: 测试全局备份 API**

Run: `curl http://localhost:3001/api/backups`
Expected: 返回包含所有备份的 JSON 响应

**Step 4: 手动测试**

1. 打开首页 http://localhost:5173
2. 点击"读取存档"按钮
3. 确认弹出存档列表对话框
4. 确认表格显示"投资组合"列
5. 尝试恢复一个存档
6. 确认恢复成功并跳转到投资组合详情页

---

## Task 8: 提交代码

**Step 1: 检查变更文件**

Run: `cd D:\Unified.Holdings.Tracker-main && git status`
Expected: 显示修改的文件列表

**Step 2: 添加文件到暂存区**

Run: `cd D:\Unified.Holdings.Tracker-main && git add apps/backend/src/services/backupService.ts apps/backend/src/routes/archive.ts frontend/src/services/api.ts frontend/src/components/ViewArchivesModal.tsx frontend/src/features/portfolio/pages/PortfolioListPage.tsx frontend/src/features/portfolio/pages/PortfolioListPage.module.css docs/plans/2026-01-12-homepage-archive-restore.md`

**Step 3: 创建提交**

```bash
git commit -m "$(cat <<'EOF'
feat: 首页直接读取存档功能

- 后端新增全局备份列表 API (GET /api/backups)
- 后端新增智能恢复 API (POST /api/backup/:id/restore)
- 前端 ViewArchivesModal 支持全局模式
- 首页添加"读取存档"快速入口按钮
- 恢复时自动创建不存在的投资组合

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## 文件变更摘要

| 文件                                                                 | 操作 | 变更内容                                                   |
| -------------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| `apps/backend/src/services/backupService.ts`                         | 修改 | 新增 `listAllBackups` 和 `restoreBackupSmart` 方法         |
| `apps/backend/src/routes/archive.ts`                                 | 修改 | 新增 GET /api/backups 和 POST /api/backup/:id/restore 路由 |
| `frontend/src/services/api.ts`                                       | 修改 | 新增 `getAllBackups` 和 `restoreBackupSmart` 方法          |
| `frontend/src/components/ViewArchivesModal.tsx`                      | 修改 | 支持全局模式（无 portfolioId）                             |
| `frontend/src/features/portfolio/pages/PortfolioListPage.tsx`        | 修改 | 添加"读取存档"按钮和 Modal                                 |
| `frontend/src/features/portfolio/pages/PortfolioListPage.module.css` | 修改 | 添加按钮样式                                               |
