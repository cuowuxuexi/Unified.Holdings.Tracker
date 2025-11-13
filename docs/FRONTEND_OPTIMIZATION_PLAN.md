# 前端架构优化预案

> **目标**：完成《REFACTOR_PLAN.md》第 3 阶段剩余任务，为 Electron 打包和测试建立稳固基础

---

## 📊 当前状态评估

### ✅ 已完成
- [x] 目录结构重排（`src/app`, `src/features`, `src/shared`）
- [x] `App.tsx` 简化为壳与路由
- [x] 引入 TanStack Query（已安装并部分使用）
- [x] Vitest 配置完成，已有 5 个测试文件

### ⚠️ 存在问题
- [ ] **组件重复**：`components/` 和 `features/` 中存在同名组件
- [ ] **API 调用混乱**：axios 和 fetch 混用，缺乏统一 SDK
- [ ] **localStorage 泛滥**：38+ 处直接调用，无统一管理
- [ ] **巨石组件**：4 个超大组件（20KB+）未拆分
- [ ] **状态管理冲突**：Zustand 和 TanStack Query 职责不清

---

## 🎯 优化优先级

按**依赖关系**和**影响范围**排序：

```
P0 (阻塞性) → 组件重复清理、API 统一
P1 (关键)   → localStorage 规范化、状态管理分离
P2 (重要)   → 巨石组件拆分
P3 (提升)   → 类型安全增强、错误处理
```

---

## 🔧 优化任务清单

### P0: 组件重复清理（预计 2 小时）

**问题描述：**
- 存在两套相同的组件：
  ```
  components/PortfolioList.tsx        (旧, 23KB, 使用 Zustand)
  features/portfolio/components/PortfolioList.tsx  (新, 使用 TanStack Query)
  
  components/PortfolioDetailView.tsx
  features/portfolio/components/PortfolioDetailView.tsx
  
  components/AddTransactionForm.tsx
  features/transaction/components/AddTransactionForm.tsx
  
  components/CreatePortfolioForm.tsx
  features/portfolio/components/CreatePortfolioForm.tsx
  
  components/TransactionList.tsx
  features/transaction/components/TransactionList.tsx
  
  components/PositionsTable.tsx
  features/portfolio/components/PositionsTable.tsx
  ```

**影响：**
- 维护双倍代码，修改 bug 需要改两处
- 不同组件使用不同数据层（Zustand vs TanStack Query）
- 路由可能指向错误的组件版本

**解决方案：**

1. **确定保留版本**：
   - ✅ 保留：`features/` 下的组件（使用 TanStack Query，符合新架构）
   - ❌ 废弃：`components/` 下的旧组件

2. **迁移步骤**：
   ```bash
   # 步骤 1: 检查旧组件是否仍在使用
   grep -r "from.*components/PortfolioList" src/
   
   # 步骤 2: 将所有引用改为 features/ 版本
   # 步骤 3: 将旧组件移至 components/legacy/ (保留一周备份)
   # 步骤 4: 验证应用正常运行后删除
   ```

3. **保留组件**（无重复的，保留在 `components/`）：
   - `MarketIndices.tsx` (25KB, 待拆分)
   - `MarketAssetsPanel.tsx` (24KB, 待拆分)
   - `PortfolioSummary.tsx` (17KB, 待拆分)
   - `StockQuote.tsx`
   - `LeverageCostCard.tsx`
   - `AttentionItemsCard.tsx`

**验收标准：**
- [ ] `components/` 中仅保留无重复的通用组件
- [ ] 所有业务组件统一在 `features/` 目录
- [ ] `npm run build` 成功，无 import 错误

---

### P0: API 调用统一（预计 3 小时）

**问题描述：**
- **混用情况**：
  ```typescript
  // services/api.ts - 使用 axios
  const response = await axios.get(`${API_BASE_URL}/api/portfolio`);
  
  // shared/hooks/usePortfolios.ts - 使用 fetch
  const response = await fetch(`${baseUrl}/portfolio`);  // 注释：临时使用
  ```
- **问题**：
  - 两种 HTTP 客户端，配置不一致
  - 错误处理逻辑分散
  - 类型安全缺失

**解决方案：**

#### 方案 A：统一使用 axios（推荐）

**优势**：
- 已有 `services/api.ts` 实现了大部分接口
- 拦截器、错误处理已配置
- 与现有 Zustand store 兼容

**实施步骤**：

1. **增强 `services/api.ts`**：
   ```typescript
   // 添加类型安全的响应包装
   import { z } from 'zod';
   
   // 统一错误处理
   axios.interceptors.response.use(
     (response) => response,
     (error) => {
       // 统一错误格式
       throw new ApiError(error.response?.status, error.message);
     }
   );
   ```

2. **重构 TanStack Query hooks**：
   ```typescript
   // shared/hooks/usePortfolios.ts
   import apiClient from '@/services/api';
   
   export function usePortfolios() {
     return useQuery({
       queryKey: ['portfolios'],
       queryFn: () => apiClient.fetchPortfolios(), // 复用 apiClient
     });
   }
   ```

3. **移除 fetch 调用**：
   - 搜索所有 `fetch(` 并替换为 `apiClient` 方法

#### 方案 B：使用 OpenAPI 生成的客户端

**优势**：
- 类型自动生成，100% 类型安全
- 与后端 API 定义同步

**劣势**：
- 需要重写所有 API 调用
- 学习曲线（`@hey-api/client-fetch`）

**当前状态**：
- `package.json` 中已配置 `"generate:api": "openapi-ts"`
- `generated/` 目录存在，但未广泛使用

**决策**：建议先用**方案 A**（短期），等架构稳定后考虑**方案 B**（长期）

**验收标准：**
- [ ] 所有 API 调用统一使用 `services/api.ts`
- [ ] 移除所有 `fetch()` 直接调用
- [ ] 错误处理统一（`try-catch` 或 `onError` 回调）

---

### P1: localStorage 规范化（预计 4 小时）

**问题描述：**
- **泛滥程度**：
  - `store/index.ts`: 25 处直接调用
  - `PortfolioList.tsx`: 13 处直接调用
- **存储内容混乱**：
  ```typescript
  // 旧数据格式迁移代码仍在生产环境
  const migrateStringArrayToSelectedIndexItem = (arr: string[]) => { ... }
  const migrateTypeToCategory = (items: any[]) => { ... }
  
  // 多个存储键名，命名不一致
  'marketIndicesOrderV2'
  'marketConfigsV1'
  'indexCategoriesV1'
  'portfolioQuotes'
  'mainQuoteRnd'
  'otherQuotesRnd'
  ```

**影响：**
- 难以追踪数据来源和版本
- 数据迁移逻辑污染业务代码
- SSR 不友好（`typeof localStorage`检查散落各处）

**解决方案：**

#### 1. 创建统一存储服务

```typescript
// shared/services/localStorage.service.ts
import { z } from 'zod';

// 类型安全的存储键定义
const STORAGE_KEYS = {
  MARKET_INDICES: 'app:market:indices:v2',
  MARKET_CONFIGS: 'app:market:configs:v1',
  INDEX_CATEGORIES: 'app:index:categories:v1',
  PORTFOLIO_QUOTES: 'app:portfolio:quotes:v1',
  MAIN_QUOTE_RND: 'app:ui:mainQuoteRnd:v1',
  OTHER_QUOTES_RND: 'app:ui:otherQuotesRnd:v1',
} as const;

// Schema 定义
const SelectedIndexItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  visible: z.boolean(),
  categoryId: z.string(),
});

class LocalStorageService {
  private isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  // 类型安全的读取
  get<T>(key: string, schema: z.ZodSchema<T>, fallback: T): T {
    if (!this.isAvailable()) return fallback;
    
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      
      const parsed = JSON.parse(raw);
      return schema.parse(parsed);
    } catch (error) {
      console.error(`Error parsing localStorage key "${key}":`, error);
      return fallback;
    }
  }

  // 批量写入（节流）
  private writeQueue = new Map<string, any>();
  private writeTimer: NodeJS.Timeout | null = null;

  set<T>(key: string, value: T): void {
    if (!this.isAvailable()) return;
    
    this.writeQueue.set(key, value);
    
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 300);
  }

  private flush(): void {
    this.writeQueue.forEach((value, key) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.error(`Error writing localStorage key "${key}":`, error);
      }
    });
    this.writeQueue.clear();
  }

  remove(key: string): void {
    if (!this.isAvailable()) return;
    localStorage.removeItem(key);
  }

  clear(): void {
    if (!this.isAvailable()) return;
    localStorage.clear();
  }
}

export const storageService = new LocalStorageService();
export { STORAGE_KEYS };
```

#### 2. 迁移 Zustand store

```typescript
// store/index.ts
import { storageService, STORAGE_KEYS } from '@/shared/services/localStorage.service';

const useAppStore = create<AppState>((set, get) => ({
  selectedIndices: storageService.get(
    STORAGE_KEYS.MARKET_INDICES,
    z.array(SelectedIndexItemSchema),
    DEFAULT_INDICES
  ),
  
  setSelectedIndices: (indices: SelectedIndexItem[]) => {
    set({ selectedIndices: indices });
    storageService.set(STORAGE_KEYS.MARKET_INDICES, indices);
  },
  // ... 其他状态同理
}));
```

#### 3. 清理旧数据迁移代码

- 将迁移逻辑移到独立的 `migrations/` 目录
- 仅在应用初始化时执行一次
- 生产环境可选择性移除（发布 3 个版本后）

**验收标准：**
- [ ] 所有 `localStorage` 调用通过 `storageService`
- [ ] Schema 验证覆盖所有存储数据
- [ ] 迁移代码独立，不污染业务逻辑
- [ ] 控制台无 localStorage 错误

---

### P1: 状态管理职责分离（预计 3 小时）

**问题描述：**
- **Zustand** 和 **TanStack Query** 职责重叠：
  ```typescript
  // Zustand 中管理服务端数据（不推荐）
  portfolios: [],
  fetchPortfolios: async () => { ... }
  
  // TanStack Query 也在管理同样的数据
  usePortfolios() {
    return useQuery({ queryKey: ['portfolios'], ... });
  }
  ```
- **结果**：
  - 两个数据源，可能不同步
  - 缓存策略冲突
  - 组件不知道该用哪个

**解决方案：**

#### 职责划分原则

| 数据类型 | 管理工具 | 示例 |
|---------|---------|------|
| **服务端数据** | TanStack Query | 投资组合列表、交易记录、持仓数据 |
| **UI 状态** | Zustand | 选中的组合 ID、Modal 开关、主题设置 |
| **表单状态** | React Hook Form | 表单输入、验证状态 |
| **持久化 UI 配置** | Zustand + localStorage | 指数顺序、市场配置、布局设置 |

#### 重构步骤

1. **从 Zustand 移除服务端数据**：
   ```typescript
   // ❌ 移除这些
   portfolios: [],
   selectedPortfolioDetail: null,
   fetchPortfolios: async () => { ... }
   
   // ✅ 保留这些
   selectedPortfolioId: null,  // UI 状态：当前选中哪个组合
   marketIndicesOrder: [],     // UI 配置：用户自定义的指数顺序
   ```

2. **组件改用 TanStack Query**：
   ```typescript
   // ❌ 旧方式
   const portfolios = useAppStore(state => state.portfolios);
   const fetchPortfolios = useAppStore(state => state.fetchPortfolios);
   
   useEffect(() => {
     fetchPortfolios();
   }, []);
   
   // ✅ 新方式
   const { data: portfolios, isLoading, error } = usePortfolios();
   const selectedId = useAppStore(state => state.selectedPortfolioId);
   ```

3. **清理 Zustand store**：
   - 移除所有 `fetch*` 方法
   - 移除所有 `isLoading*` 状态（TanStack Query 自带）
   - 移除服务端数据缓存（`portfolios`, `stockQuotes` 等）

**验收标准：**
- [ ] Zustand 仅管理 UI 状态和配置
- [ ] 所有服务端数据通过 TanStack Query 获取
- [ ] 无数据同步问题

---

### P2: 巨石组件拆分（预计 6 小时）

**问题清单：**

| 文件 | 大小 | 问题 | 优先级 |
|------|------|------|--------|
| `PortfolioList.tsx` | 23KB | 混合列表、Modal、拖拽、语录管理 | 高 |
| `MarketIndices.tsx` | 25KB | 混合数据展示、拖拽、分类管理 | 高 |
| `MarketAssetsPanel.tsx` | 24KB | 多个子面板，逻辑复杂 | 中 |
| `PortfolioSummary.tsx` | 17KB | 图表 + 表格 + 统计 | 中 |

#### 拆分原则

**容器组件 vs 展示组件**：
```
PortfolioList (容器)
├── PortfolioSelector (展示)
├── QuoteManagementModal (展示)
├── CreatePortfolioModal (展示)
└── DraggableQuoteCard (展示)
```

#### 示例：拆分 `PortfolioList.tsx`

**当前结构**（684 行）：
```typescript
// 混合了太多职责
- 投资组合选择器
- 创建投资组合 Modal
- 语录管理 (CRUD)
- 语录拖拽/缩放
- localStorage 操作
```

**拆分后**：
```
features/portfolio/components/
├── PortfolioList.tsx              (容器, 100 行)
├── PortfolioSelector.tsx          (展示, 50 行)
├── CreatePortfolioModal.tsx       (独立, 80 行)
└── quote/                         (独立模块)
    ├── QuoteManager.tsx           (容器, 120 行)
    ├── QuoteCard.tsx              (展示, 60 行)
    ├── QuoteEditModal.tsx         (展示, 80 行)
    └── useQuoteStorage.ts         (Hook, 50 行)
```

#### 拆分检查清单

每个组件拆分完成后检查：
- [ ] 单个文件 < 300 行
- [ ] 职责单一（只做一件事）
- [ ] Props 类型完整
- [ ] 可独立测试
- [ ] 可复用性

**验收标准：**
- [ ] 所有组件 < 400 行
- [ ] 核心业务组件 < 300 行
- [ ] 展示组件可独立 Storybook 展示

---

### P3: 类型安全与错误处理（预计 2 小时）

#### 1. 统一错误类型

```typescript
// shared/types/error.ts
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

#### 2. 统一错误处理 Hook

```typescript
// shared/hooks/useErrorHandler.ts
import { message } from 'antd';

export function useErrorHandler() {
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.statusCode === 404) {
        message.error('资源不存在');
      } else if (error.statusCode >= 500) {
        message.error('服务器错误，请稍后重试');
      } else {
        message.error(error.message);
      }
    } else {
      message.error('未知错误');
      console.error(error);
    }
  };
}
```

#### 3. TanStack Query 全局错误处理

```typescript
// app/providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      onError: (error) => {
        // 全局错误提示
        console.error('Query error:', error);
      },
      retry: (failureCount, error) => {
        // 5xx 错误重试，4xx 不重试
        if (error instanceof ApiError && error.statusCode < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});
```

---

## 📋 实施计划

### 第 1 周：基础架构清理

**Day 1-2: P0 任务**
- [ ] 组件重复清理（2h）
  - 识别所有重复组件
  - 统一引用到 `features/`
  - 移除旧组件
- [ ] API 统一（3h）
  - 统一使用 axios
  - 重构 TanStack Query hooks
  - 移除 fetch 调用

**Day 3-4: P1 任务（第一部分）**
- [ ] localStorage 规范化（4h）
  - 创建 `storageService`
  - 迁移 Zustand store
  - 清理旧迁移代码
- [ ] 状态管理分离（3h）
  - 从 Zustand 移除服务端数据
  - 组件改用 TanStack Query
  - 验证数据同步

**Day 5: 验证与测试**
- [ ] 运行现有测试
- [ ] 手动回归测试核心流程
- [ ] 修复发现的问题

### 第 2 周：组件拆分与质量提升

**Day 1-3: P2 任务**
- [ ] 拆分 `PortfolioList.tsx`（2h）
- [ ] 拆分 `MarketIndices.tsx`（2h）
- [ ] 拆分 `MarketAssetsPanel.tsx`（1.5h）
- [ ] 拆分 `PortfolioSummary.tsx`（1.5h）

**Day 4: P3 任务**
- [ ] 统一错误处理（2h）
- [ ] 类型安全增强（1h）

**Day 5: 回归测试**
- [ ] 完整功能测试
- [ ] 性能检查
- [ ] 文档更新

---

## ✅ 验收标准

### 架构健康度指标

| 指标 | 目标 | 当前 |
|------|------|------|
| 组件重复率 | 0% | ~30% |
| 单文件最大行数 | < 400 | 684 |
| API 调用方式 | 统一 | 混乱 |
| localStorage 直接调用 | 0 | 38+ |
| 服务端数据管理 | TanStack Query | 混用 |
| 类型覆盖率 | > 90% | ~70% |

### 功能验收

完成后必须能：
- [ ] 创建投资组合
- [ ] 添加交易记录
- [ ] 查看持仓和收益
- [ ] 批量导入数据
- [ ] 导出 Markdown 报表
- [ ] 市场指数自定义
- [ ] 所有配置持久化

### 技术验收

- [ ] `npm run build` 成功
- [ ] `npm run test` 全部通过
- [ ] `npm run lint` 无错误
- [ ] 浏览器控制台无 Error（Warning 可接受）
- [ ] 热更新正常工作

---

## 🚨 风险与应对

### 风险 1：重构破坏现有功能

**应对**：
- 每完成一个任务立即测试
- 使用 Git 分支，便于回滚
- 保留旧组件在 `legacy/` 1-2 周

### 风险 2：工作量超预期

**应对**：
- P0 任务必须完成（阻塞 Electron 打包）
- P1 任务优先核心功能
- P2 任务可按组件优先级拆分

### 风险 3：数据迁移失败

**应对**：
- localStorage 迁移保留兼容代码
- 提供手动清理选项
- 发布前完整测试数据加载

---

## 📚 参考资料

- [TanStack Query 最佳实践](https://tanstack.com/query/latest/docs/react/guides/queries)
- [Zustand 状态切片](https://docs.pmnd.rs/zustand/guides/slices-pattern)
- [React 组件拆分原则](https://kentcdodds.com/blog/colocation)
- [LocalStorage 最佳实践](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)

---

## 🎯 下一步：编写测试

完成本优化预案后，进入：
1. **Vitest 单元测试**（3-5 天）
2. **考虑 Storybook**（可选）
3. **进入第 4 阶段：Electron 集成**

---

> **更新日期**：2025-01-11  
> **预计完成时间**：2 周（按 P0→P1→P2 顺序，P3 可选）  
> **责任人**：开发者本人  
