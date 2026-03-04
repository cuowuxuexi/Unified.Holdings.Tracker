# 投资组合存档功能架构设计

> 创建日期：2026-01-05
> 版本：1.0

## 1. 概述

本文档定义投资组合存档功能的完整架构设计，包括数据结构、API 设计、服务层接口和文件存储方案。

### 1.1 功能目标

- 支持按年份创建投资组合历史数据存档
- 存档包含完整的交易记录、持仓快照和统计信息
- 提供存档的创建、列表查询和下载功能
- 支持可选的存档恢复/导入功能

### 1.2 技术约束

- 后端：Express.js + Prisma ORM + SQLite
- 存储：JSON 文件格式，存储在 `data/archives/` 目录
- 复用现有服务：`portfolioStatsService`、`dataService`

---

## 2. 存档数据结构

### 2.1 TypeScript 接口定义

```typescript
// 存档元数据
interface ArchiveMetadata {
  id: string; // 存档唯一标识 (UUID)
  portfolioId: string; // 投资组合 ID
  portfolioName: string; // 投资组合名称
  year: number; // 存档年份
  createdAt: string; // 创建时间 (ISO 8601)
  version: string; // 存档格式版本号
  transactionCount: number; // 交易记录数量
  positionCount: number; // 持仓数量
  dateRange: {
    start: string; // 数据起始日期 (YYYY-MM-DD)
    end: string; // 数据结束日期 (YYYY-MM-DD)
  };
}

// 存档中的交易记录（保持与现有 Transaction 类型一致）
interface ArchivedTransaction {
  id: string;
  date: string; // ISO 8601 格式
  type: TransactionType;
  assetCode?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  leverageUsed?: number;
  currency: string;
  exchangeRate?: number;
  notes?: string;
}

// 存档中的持仓快照
interface ArchivedPosition {
  assetCode: string;
  assetName: string;
  market: 'CN' | 'HK' | 'US';
  quantity: number;
  costPrice: number; // 成本价 (CNY)
  costPriceLocal: number; // 成本价 (原币种)
  totalCost: number; // 总成本 (CNY)
  totalCostLocal: number; // 总成本 (原币种)
  dilutedPrice: number; // 摊薄价 (CNY)
  dilutedPriceLocal: number; // 摊薄价 (原币种)
  totalDividend: number; // 累计股息 (CNY)
  totalDividendLocal: number; // 累计股息 (原币种)
  currency: string;
  // 快照时的市值（如果可用）
  snapshotPrice?: number; // 快照时价格
  snapshotMarketValue?: number; // 快照时市值
  snapshotDate?: string; // 快照日期
}

// 存档中的统计信息快照
interface ArchivedStats {
  snapshotDate: string; // 统计快照日期
  totalMarketValue: number; // 总市值
  totalAssets: number; // 总资产
  netAssets: number; // 净资产
  cash: number; // 现金余额
  leverageUsed: number; // 已用杠杆
  leverageAvailable: number; // 可用杠杆
  // 盈亏信息
  totalPnl: number; // 总盈亏
  realizedPnl: number; // 已实现盈亏
  unrealizedPnl: number; // 未实现盈亏
  // 年度统计
  yearlyDeposit: number; // 年度入金
  yearlyWithdraw: number; // 年度出金
  yearlyDividend: number; // 年度股息
  yearlyCommission: number; // 年度手续费
  yearlyLeverageCost: number; // 年度融资成本
  // 收益率
  yearlyReturnPercent?: number; // 年度收益率
}

// 完整存档数据结构
interface PortfolioArchive {
  metadata: ArchiveMetadata;
  portfolio: {
    id: string;
    name: string;
    initialCash: number;
    cash: number;
    leverage: {
      totalAmount: number;
      usedAmount: number;
      availableAmount: number;
      costRate: number;
    };
    attentionInfo?: string;
  };
  transactions: ArchivedTransaction[];
  positions: ArchivedPosition[];
  stats: ArchivedStats;
}
```

### 2.2 按年份分割逻辑

```typescript
// 年份分割规则
interface YearSplitConfig {
  // 年度边界：每年1月1日 00:00:00 UTC+8
  yearStart: (year: number) => Date; // new Date(year, 0, 1)
  yearEnd: (year: number) => Date; // new Date(year, 11, 31, 23, 59, 59)

  // 交易记录筛选
  filterTransactionsByYear: (
    transactions: Transaction[],
    year: number
  ) => Transaction[];
}
```

---

## 3. API 端点设计

### 3.1 创建存档

```
POST /api/portfolio/:id/archive
```

**请求参数**：

```typescript
interface CreateArchiveRequest {
  year: number; // 存档年份（必需）
  includePositionSnapshot?: boolean; // 是否包含持仓快照，默认 true
  includeStats?: boolean; // 是否包含统计信息，默认 true
}
```

**响应**：

```typescript
interface CreateArchiveResponse {
  success: boolean;
  archive: {
    id: string;
    filename: string;
    path: string;
    metadata: ArchiveMetadata;
  };
  message: string;
}
```

**HTTP 状态码**：

- `201 Created` - 存档创建成功
- `400 Bad Request` - 参数无效（如年份格式错误）
- `404 Not Found` - 投资组合不存在
- `409 Conflict` - 该年份存档已存在

---

### 3.2 列出存档

```
GET /api/portfolio/:id/archives
```

**查询参数**：

```typescript
interface ListArchivesQuery {
  year?: number; // 按年份筛选
  limit?: number; // 返回数量限制，默认 50
  offset?: number; // 分页偏移
}
```

**响应**：

```typescript
interface ListArchivesResponse {
  archives: ArchiveMetadata[];
  total: number;
  limit: number;
  offset: number;
}
```

**HTTP 状态码**：

- `200 OK` - 成功
- `404 Not Found` - 投资组合不存在

---

### 3.3 下载存档

```
GET /api/archive/:archiveId
```

**查询参数**：

```typescript
interface DownloadArchiveQuery {
  format?: 'json' | 'download'; // 返回格式，默认 'download'
}
```

**响应**：

- `format=json`: 返回 JSON 对象
- `format=download`: 返回文件下载（Content-Disposition: attachment）

**HTTP 状态码**：

- `200 OK` - 成功
- `404 Not Found` - 存档不存在

---

### 3.4 删除存档（可选）

```
DELETE /api/archive/:archiveId
```

**响应**：

```typescript
interface DeleteArchiveResponse {
  success: boolean;
  message: string;
}
```

**HTTP 状态码**：

- `204 No Content` - 删除成功
- `404 Not Found` - 存档不存在

---

### 3.5 恢复/导入存档（可选，后续扩展）

```
POST /api/portfolio/:id/restore
```

**请求**：

```typescript
interface RestoreArchiveRequest {
  archiveId?: string; // 从已有存档恢复
  archiveData?: PortfolioArchive; // 直接上传存档数据
  mode: 'merge' | 'replace'; // 合并或替换
}
```

---

## 4. 服务层接口设计

### 4.1 ArchiveService 接口

```typescript
// apps/backend/src/services/archiveService.ts

interface IArchiveService {
  /**
   * 创建投资组合年度存档
   * @param portfolioId 投资组合 ID
   * @param year 存档年份
   * @param options 存档选项
   */
  createArchive(
    portfolioId: string,
    year: number,
    options?: CreateArchiveOptions
  ): Promise<ArchiveResult>;

  /**
   * 列出投资组合的所有存档
   * @param portfolioId 投资组合 ID
   * @param filter 筛选条件
   */
  listArchives(
    portfolioId: string,
    filter?: ArchiveFilter
  ): Promise<ArchiveMetadata[]>;

  /**
   * 获取存档详情
   * @param archiveId 存档 ID
   */
  getArchive(archiveId: string): Promise<PortfolioArchive | null>;

  /**
   * 获取存档文件路径
   * @param archiveId 存档 ID
   */
  getArchiveFilePath(archiveId: string): Promise<string | null>;

  /**
   * 删除存档
   * @param archiveId 存档 ID
   */
  deleteArchive(archiveId: string): Promise<boolean>;

  /**
   * 检查存档是否存在
   * @param portfolioId 投资组合 ID
   * @param year 年份
   */
  archiveExists(portfolioId: string, year: number): Promise<boolean>;
}

interface CreateArchiveOptions {
  includePositionSnapshot?: boolean;
  includeStats?: boolean;
  customMetadata?: Record<string, unknown>;
}

interface ArchiveResult {
  success: boolean;
  archiveId: string;
  filename: string;
  filePath: string;
  metadata: ArchiveMetadata;
  error?: string;
}

interface ArchiveFilter {
  year?: number;
  startDate?: string;
  endDate?: string;
}
```

### 4.2 服务依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                      Archive Routes                          │
│               (apps/backend/src/routes/archive.ts)           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     ArchiveService                           │
│            (apps/backend/src/services/archiveService.ts)     │
└────────┬──────────────────┬──────────────────┬──────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│ DataService     │ │ PortfolioStats  │ │ PortfolioRepository │
│ (文件存储)       │ │ Service (统计)  │ │ (数据库访问)         │
└─────────────────┘ └─────────────────┘ └─────────────────────┘
```

### 4.3 与现有服务的集成

```typescript
// 使用现有的 portfolioStatsService 计算统计信息
import { portfolioStatsService } from './portfolioStatsService';

// 使用现有的 dataService 进行文件操作
import { dataService } from '@uht/infra/data/data-service';

// 使用现有的 container 获取 repository
import { container } from '../container';
```

---

## 5. 文件存储方案

### 5.1 存储目录结构

```
data/
└── archives/
    ├── index.json                          # 存档索引文件
    ├── {portfolioId}/                      # 按投资组合分目录
    │   ├── 2024/
    │   │   └── archive-2024-{uuid}.json   # 年度存档文件
    │   ├── 2025/
    │   │   └── archive-2025-{uuid}.json
    │   └── ...
    └── ...
```

### 5.2 文件命名规范

```typescript
// 存档文件命名模式
const archiveFilename = (
  portfolioId: string,
  year: number,
  archiveId: string
) => {
  return `portfolio-${portfolioId.slice(0, 8)}-${year}-${archiveId.slice(0, 8)}.json`;
};

// 示例
// portfolio-e5e2a241-2024-abc12345.json
```

### 5.3 索引文件结构

```typescript
// data/archives/index.json
interface ArchiveIndex {
  version: string; // 索引版本
  lastUpdated: string; // 最后更新时间
  archives: {
    [archiveId: string]: {
      portfolioId: string;
      year: number;
      filename: string;
      relativePath: string; // 相对于 archives/ 的路径
      createdAt: string;
      fileSize: number; // 文件大小（字节）
    };
  };
}
```

### 5.4 文件操作示例

```typescript
class ArchiveStorageService {
  private readonly archivesDir = 'archives';
  private readonly indexFile = 'archives/index.json';

  async saveArchive(archive: PortfolioArchive): Promise<string> {
    const { portfolioId, year } = archive.metadata;
    const archiveId = archive.metadata.id;

    // 构建存储路径
    const relativePath = `${portfolioId}/${year}`;
    const filename = this.generateFilename(portfolioId, year, archiveId);
    const fullPath = `${this.archivesDir}/${relativePath}/${filename}`;

    // 使用 dataService 写入
    const success = dataService.writeJsonFile(fullPath, archive);
    if (!success) {
      throw new Error(`Failed to save archive: ${fullPath}`);
    }

    // 更新索引
    await this.updateIndex(archiveId, {
      portfolioId,
      year,
      filename,
      relativePath: `${relativePath}/${filename}`,
      createdAt: archive.metadata.createdAt,
      fileSize: JSON.stringify(archive).length,
    });

    return fullPath;
  }

  async loadArchive(archiveId: string): Promise<PortfolioArchive | null> {
    const index = this.getIndex();
    const entry = index.archives[archiveId];
    if (!entry) return null;

    const fullPath = `${this.archivesDir}/${entry.relativePath}`;
    return dataService.readJsonFile<PortfolioArchive>(fullPath, null);
  }

  async deleteArchive(archiveId: string): Promise<boolean> {
    const index = this.getIndex();
    const entry = index.archives[archiveId];
    if (!entry) return false;

    const fullPath = `${this.archivesDir}/${entry.relativePath}`;
    const success = dataService.deleteFile(fullPath);

    if (success) {
      delete index.archives[archiveId];
      await this.saveIndex(index);
    }

    return success;
  }
}
```

---

## 6. 实现步骤建议

### 6.1 第一阶段：基础架构

1. **创建类型定义文件**
   - 文件：`apps/backend/src/types/archive.ts`
   - 内容：定义 `ArchiveMetadata`、`PortfolioArchive` 等接口

2. **创建存储服务**
   - 文件：`apps/backend/src/services/archive/archiveStorageService.ts`
   - 功能：文件读写、索引管理

3. **创建存档服务**
   - 文件：`apps/backend/src/services/archive/archiveService.ts`
   - 功能：存档创建、查询、删除的业务逻辑

### 6.2 第二阶段：API 实现

4. **创建路由文件**
   - 文件：`apps/backend/src/routes/archive.ts`
   - 内容：实现 `POST /archive`、`GET /archives`、`GET /archive/:id` 等端点

5. **注册路由**
   - 修改：`apps/backend/src/server.ts`
   - 添加：`app.use('/api', archiveRouter);`

### 6.3 第三阶段：测试与优化

6. **单元测试**
   - 文件：`apps/backend/src/services/archive/__tests__/archiveService.test.ts`
   - 覆盖：存档创建、年份筛选、文件操作

7. **集成测试**
   - 文件：`apps/backend/src/routes/__tests__/archive.test.ts`
   - 覆盖：API 端点的完整流程

### 6.4 第四阶段：前端集成（可选）

8. **前端 API 调用**
   - 添加存档管理页面
   - 实现存档下载功能

---

## 7. 核心实现代码示例

### 7.1 ArchiveService 核心实现

```typescript
// apps/backend/src/services/archive/archiveService.ts

import { v4 as uuidv4 } from 'uuid';
import { container } from '../../container';
import { portfolioStatsService } from '../portfolioStatsService';
import { dataService } from '@uht/infra/data/data-service';
import { Portfolio, Transaction } from '../../types';
import {
  PortfolioArchive,
  ArchiveMetadata,
  ArchivedTransaction,
  ArchivedPosition,
  ArchivedStats,
  CreateArchiveOptions,
  ArchiveResult,
} from '../../types/archive';

const ARCHIVE_VERSION = '1.0.0';

export class ArchiveService {
  private readonly archivesDir = 'archives';

  async createArchive(
    portfolioId: string,
    year: number,
    options: CreateArchiveOptions = {}
  ): Promise<ArchiveResult> {
    const { includePositionSnapshot = true, includeStats = true } = options;

    // 1. 获取投资组合
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) {
      return {
        success: false,
        archiveId: '',
        filename: '',
        filePath: '',
        metadata: {} as ArchiveMetadata,
        error: 'Portfolio not found',
      };
    }

    // 2. 筛选指定年份的交易记录
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    const yearTransactions = portfolio.transactions.filter((tx) => {
      const txDate = new Date(tx.date);
      return txDate >= yearStart && txDate <= yearEnd;
    });

    // 3. 计算持仓快照（如果需要）
    let positions: ArchivedPosition[] = [];
    let stats: ArchivedStats | undefined;

    if (includePositionSnapshot || includeStats) {
      const fullStats = await portfolioStatsService.getFullStats(portfolio, {
        includePeriods: ['yearly'],
        includeQuotes: true,
      });

      if (includePositionSnapshot) {
        positions = fullStats.positions.map((pos) => ({
          assetCode: pos.asset.code,
          assetName: pos.asset.name,
          market: pos.asset.market,
          quantity: pos.quantity,
          costPrice: pos.costPrice,
          costPriceLocal: pos.costPriceLocal ?? pos.costPrice,
          totalCost: pos.totalCost,
          totalCostLocal: pos.totalCostLocal ?? pos.totalCost,
          dilutedPrice: pos.dilutedPrice ?? pos.costPrice,
          dilutedPriceLocal: pos.dilutedPriceLocal ?? pos.costPrice,
          totalDividend: pos.totalDividend ?? 0,
          totalDividendLocal: pos.totalDividendLocal ?? 0,
          currency: pos.currency ?? 'CNY',
          snapshotPrice: pos.currentPrice,
          snapshotMarketValue: pos.marketValue,
          snapshotDate: new Date().toISOString().split('T')[0],
        }));
      }

      if (includeStats) {
        stats = this.buildStats(fullStats, yearTransactions, year);
      }
    }

    // 4. 构建存档数据
    const archiveId = uuidv4();
    const now = new Date().toISOString();

    const metadata: ArchiveMetadata = {
      id: archiveId,
      portfolioId,
      portfolioName: portfolio.name,
      year,
      createdAt: now,
      version: ARCHIVE_VERSION,
      transactionCount: yearTransactions.length,
      positionCount: positions.length,
      dateRange: {
        start:
          yearTransactions.length > 0
            ? new Date(
                Math.min(
                  ...yearTransactions.map((t) => new Date(t.date).getTime())
                )
              )
                .toISOString()
                .split('T')[0]
            : `${year}-01-01`,
        end:
          yearTransactions.length > 0
            ? new Date(
                Math.max(
                  ...yearTransactions.map((t) => new Date(t.date).getTime())
                )
              )
                .toISOString()
                .split('T')[0]
            : `${year}-12-31`,
      },
    };

    const archive: PortfolioArchive = {
      metadata,
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        initialCash: portfolio.initialCash,
        cash: portfolio.cash,
        leverage: portfolio.leverage,
        attentionInfo: portfolio.attentionInfo,
      },
      transactions: yearTransactions.map((tx) => ({
        id: tx.id,
        date: tx.date,
        type: tx.type,
        assetCode: tx.assetCode,
        quantity: tx.quantity,
        price: tx.price,
        amount: tx.amount,
        commission: tx.commission,
        leverageUsed: tx.leverageUsed,
        currency: tx.currency ?? 'CNY',
        exchangeRate: tx.exchangeRate,
        notes: tx.notes,
      })),
      positions,
      stats: stats!,
    };

    // 5. 保存存档文件
    const filename = `portfolio-${portfolioId.slice(0, 8)}-${year}-${archiveId.slice(0, 8)}.json`;
    const relativePath = `${this.archivesDir}/${portfolioId}/${year}/${filename}`;

    const success = dataService.writeJsonFile(relativePath, archive);
    if (!success) {
      return {
        success: false,
        archiveId,
        filename,
        filePath: relativePath,
        metadata,
        error: 'Failed to write archive file',
      };
    }

    // 6. 更新索引
    await this.updateIndex(archiveId, {
      portfolioId,
      year,
      filename,
      relativePath,
      createdAt: now,
    });

    return {
      success: true,
      archiveId,
      filename,
      filePath: relativePath,
      metadata,
    };
  }

  private buildStats(
    fullStats: any,
    yearTransactions: Transaction[],
    year: number
  ): ArchivedStats {
    // 计算年度统计
    const yearlyDeposit = yearTransactions
      .filter((tx) => tx.type === 'DEPOSIT')
      .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);

    const yearlyWithdraw = yearTransactions
      .filter((tx) => tx.type === 'WITHDRAW')
      .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);

    const yearlyDividend = yearTransactions
      .filter((tx) => tx.type === 'DIVIDEND')
      .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);

    const yearlyCommission = yearTransactions.reduce(
      (sum, tx) => sum + (tx.commission ?? 0),
      0
    );

    const yearlyLeverageCost = yearTransactions
      .filter((tx) => tx.type === 'LEVERAGE_COST')
      .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);

    return {
      snapshotDate: new Date().toISOString().split('T')[0],
      totalMarketValue: fullStats.totalMarketValue,
      totalAssets: fullStats.totalAssets,
      netAssets: fullStats.netAssets,
      cash: fullStats.cash,
      leverageUsed: fullStats.leverage?.usedAmount ?? 0,
      leverageAvailable: fullStats.leverage?.availableAmount ?? 0,
      totalPnl: fullStats.totalPnl,
      realizedPnl: fullStats.realizedPnl,
      unrealizedPnl: fullStats.unrealizedPnl,
      yearlyDeposit,
      yearlyWithdraw,
      yearlyDividend,
      yearlyCommission,
      yearlyLeverageCost,
      yearlyReturnPercent: fullStats.yearlyStats?.periodReturnPercent,
    };
  }

  // ... 其他方法实现
}

export const archiveService = new ArchiveService();
```

---

## 8. 安全与性能考虑

### 8.1 安全措施

- **路径验证**：防止路径遍历攻击，验证 portfolioId 和 archiveId 格式
- **文件大小限制**：设置单个存档文件的最大大小（建议 50MB）
- **访问控制**：确保用户只能访问自己的投资组合存档

### 8.2 性能优化

- **分页查询**：列出存档时支持分页，避免一次返回过多数据
- **异步处理**：大型存档创建可考虑异步处理，返回任务 ID
- **文件压缩**：可选支持 gzip 压缩存档文件

### 8.3 错误处理

```typescript
// 定义存档相关的错误类型
enum ArchiveErrorCode {
  PORTFOLIO_NOT_FOUND = 'PORTFOLIO_NOT_FOUND',
  ARCHIVE_NOT_FOUND = 'ARCHIVE_NOT_FOUND',
  ARCHIVE_ALREADY_EXISTS = 'ARCHIVE_ALREADY_EXISTS',
  INVALID_YEAR = 'INVALID_YEAR',
  WRITE_FAILED = 'WRITE_FAILED',
  READ_FAILED = 'READ_FAILED',
}

class ArchiveError extends Error {
  constructor(
    public code: ArchiveErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}
```

---

## 9. 扩展功能（后续版本）

1. **增量存档**：只存储新增的交易记录，减少存储空间
2. **自动存档**：配置定时任务，每年自动创建上一年的存档
3. **存档比较**：比较不同时间点的存档，分析投资组合变化
4. **导出格式**：支持导出为 CSV、Excel 等格式
5. **云存储**：支持将存档上传到云存储服务

---

## 10. 相关文件清单

| 文件路径                                                     | 说明         | 状态       |
| ------------------------------------------------------------ | ------------ | ---------- |
| `apps/backend/src/types/archive.ts`                          | 存档类型定义 | 待创建     |
| `apps/backend/src/services/archive/archiveService.ts`        | 存档服务     | 待创建     |
| `apps/backend/src/services/archive/archiveStorageService.ts` | 存储服务     | 待创建     |
| `apps/backend/src/routes/archive.ts`                         | 路由定义     | 待创建     |
| `apps/backend/src/services/archive/index.ts`                 | 服务导出     | 待创建     |
| `data/archives/index.json`                                   | 存档索引     | 运行时创建 |

---

_文档结束_
