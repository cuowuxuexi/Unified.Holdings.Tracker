[根目录](../CLAUDE.md) > **frontend**

---

# Frontend 模块文档

> 最后更新：2025-11-16 08:55:50

## 变更记录 (Changelog)

### 2025-11-16
- 初始化模块文档

---

## 模块职责

Frontend 是基于 React 19 + Vite + TypeScript 构建的单页应用（SPA），负责：

- **用户界面**：投资组合管理、交易记录、市场数据展示
- **状态管理**：使用 Zustand 管理全局状态
- **API 调用**：通过 Axios 与后端 RESTful API 交互
- **数据可视化**：使用 ECharts 展示图表
- **UI 组件库**：基于 Ant Design 5 构建一致的用户体验

---

## 入口与启动

### 主入口
- **文件**：`src/main.tsx`
- **根组件**：`src/App.tsx`
- **路由配置**：`src/app/routes/index.tsx`

### 启动流程
1. 加载 `index.html`
2. Vite 注入 `src/main.tsx`
3. 初始化 React 根节点
4. 配置 Ant Design 主题（`src/theme.ts`）
5. 渲染 `<App />` 组件
6. React Router 根据路由渲染页面

### 启动命令
```bash
# 开发模式（热更新）
npm run dev

# 生产构建
npm run build

# 预览构建产物
npm run preview
```

---

## 对外接口

### 核心页面与路由

#### 1. 投资组合列表页（Portfolio List）
- **路由**：`/`
- **组件**：`src/features/portfolio/pages/PortfolioListPage.tsx`
- **功能**：
  - 展示所有投资组合卡片
  - 创建新投资组合
  - 查看组合概览（总资产、收益率）

#### 2. 投资组合详情页（Portfolio Detail）
- **路由**：`/portfolio/:id`
- **组件**：`src/features/portfolio/pages/PortfolioDetailPage.tsx`
- **功能**：
  - 投资组合摘要（现金、杠杆、总资产）
  - 持仓明细表（成本、市值、盈亏）
  - 交易记录列表
  - 添加/删除交易
  - 编辑备注和关注信息

#### 3. 市场数据面板（Market Data）
- **组件**：`src/components/MarketIndices.tsx`
- **功能**：
  - 展示市场指数（沪深300、上证、恒指、纳指等）
  - 实时行情更新

### 核心功能模块

#### Portfolio Feature（投资组合）
- **目录**：`src/features/portfolio/`
- **组件**：
  - `PortfolioList.tsx` - 组合列表
  - `PortfolioDetailView.tsx` - 组合详情
  - `CreatePortfolioForm.tsx` - 创建表单
  - `PositionsTable.tsx` - 持仓表格

#### Transaction Feature（交易）
- **目录**：`src/features/transaction/`
- **组件**：
  - `AddTransactionForm.tsx` - 添加交易表单
  - `TransactionList.tsx` - 交易记录列表

---

## 关键依赖与配置

### 主要依赖
- **react** ^19.0.0 - UI 框架
- **react-dom** ^19.0.0 - DOM 渲染
- **react-router-dom** ^7.1.1 - 路由管理
- **antd** ^5.24.7 - UI 组件库
- **zustand** ^5.0.3 - 状态管理
- **@tanstack/react-query** ^5.62.15 - 数据获取和缓存
- **axios** ^1.8.4 - HTTP 客户端
- **echarts** ^5.6.0 - 图表库
- **dayjs** ^1.11.13 - 日期处理
- **zod** ^4.1.12 - 数据验证

### 开发依赖
- **vite** ^6.2.0 - 构建工具
- **typescript** ~5.7.2 - 类型检查
- **vitest** ^3.1.1 - 单元测试
- **@testing-library/react** ^16.3.0 - 组件测试

### 环境变量
在 `frontend/.env` 中配置：
```bash
VITE_API_BASE_URL=http://localhost:3001/api
```

### Vite 配置
- **文件**：`vite.config.ts`
- **关键配置**：
  - `base: './'` - 支持 file:// 协议（Electron）
  - `outDir: '../electron/renderer'` - 构建输出到 Electron 目录
  - 测试配置（Vitest + jsdom）

---

## 数据模型

### API 客户端
- **文件**：`src/shared/api/client.ts`
- **生成代码**：`src/generated/api/` (通过 OpenAPI 生成)
- **使用方式**：
  ```typescript
  import { client } from '@/shared/api/client';

  const portfolios = await client.GET('/api/portfolio');
  ```

### 状态管理（Zustand）
- **文件**：`src/store/index.ts`
- **Store 结构**：
  ```typescript
  interface AppState {
    portfolios: Portfolio[];
    selectedPortfolioId: string | null;
    setPortfolios: (portfolios: Portfolio[]) => void;
    selectPortfolio: (id: string) => void;
  }
  ```

### React Query Hooks
- **文件**：`src/shared/hooks/`
- **Hooks**：
  - `usePortfolios()` - 获取投资组合列表
  - `usePositions(portfolioId)` - 获取持仓
  - `useTransactions(portfolioId)` - 获取交易记录

---

## 测试与质量

### 测试框架
- **Vitest** + **React Testing Library**
- **配置**：`vite.config.ts` 中的 `test` 字段

### 测试文件
- `src/components/legacy/__tests__/` - 组件测试
- `src/utils/__tests__/` - 工具函数测试

### 运行测试
```bash
npm run test
```

### 代码检查
```bash
# ESLint
npm run lint

# Prettier
npm run format:check
```

---

## 常见问题 (FAQ)

### Q1: 如何添加新页面？
A:
1. 在 `src/features/` 创建功能模块
2. 在 `src/app/routes/index.tsx` 添加路由
3. 使用 Ant Design 组件保持 UI 一致性

### Q2: 如何调用后端 API？
A:
```typescript
import { client } from '@/shared/api/client';

const { data } = await client.GET('/api/portfolio/{id}', {
  params: { path: { id: portfolioId } }
});
```

### Q3: 如何更新 API 类型定义？
A:
1. 确保后端 OpenAPI 文档最新
2. 运行 `npm run generate:api`
3. 重新导入生成的类型

### Q4: 为什么构建输出到 `../electron/renderer`？
A: 为了与 Electron 集成，前端构建产物需要放在 Electron 的 renderer 目录。

---

## 相关文件清单

```
frontend/
├── src/
│   ├── app/
│   │   ├── providers/            # React Context 提供者
│   │   └── routes/               # 路由配置
│   ├── assets/                   # 静态资源（图片等）
│   ├── components/               # 通用 UI 组件
│   │   ├── legacy/               # 旧版组件（待重构）
│   │   └── utils/                # 组件工具函数
│   ├── features/
│   │   ├── portfolio/            # 投资组合功能模块
│   │   │   ├── components/       # 组合相关组件
│   │   │   └── pages/            # 组合页面
│   │   └── transaction/          # 交易功能模块
│   ├── generated/
│   │   └── api/                  # OpenAPI 生成的类型和客户端
│   ├── shared/
│   │   ├── api/                  # API 客户端配置
│   │   ├── hooks/                # 自定义 Hooks
│   │   └── utils/                # 工具函数
│   ├── store/                    # Zustand 状态管理
│   ├── App.tsx                   # 根组件
│   ├── main.tsx                  # 应用入口
│   ├── theme.ts                  # Ant Design 主题配置
│   └── index.css                 # 全局样式
├── public/                       # 静态资源（不经过构建）
├── index.html                    # HTML 入口
├── vite.config.ts                # Vite 配置
├── tsconfig.json                 # TypeScript 配置
├── eslint.config.js              # ESLint 配置
├── openapi-ts.config.ts          # OpenAPI 生成器配置
└── package.json
```

---

## 架构图

```
┌──────────────────────────────────────────┐
│         React Application                │
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐ │
│  │      Pages (页面)                  │ │
│  │  PortfolioListPage                 │ │
│  │  PortfolioDetailPage               │ │
│  └────────────┬───────────────────────┘ │
│               │                          │
│  ┌────────────▼───────────────────────┐ │
│  │   Features (功能模块)              │ │
│  │  Portfolio, Transaction            │ │
│  └────────────┬───────────────────────┘ │
│               │                          │
│  ┌────────────▼───────────────────────┐ │
│  │   Components (UI 组件)             │ │
│  │  Ant Design + Custom Components    │ │
│  └────────────┬───────────────────────┘ │
│               │                          │
│  ┌────────────▼───────────────────────┐ │
│  │   State Management (状态管理)      │ │
│  │  Zustand + React Query             │ │
│  └────────────┬───────────────────────┘ │
│               │                          │
│  ┌────────────▼───────────────────────┐ │
│  │   API Client (API 客户端)          │ │
│  │  Axios + OpenAPI Generated Types   │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼──────────────────────────┘
                │ HTTP
                ▼
┌──────────────────────────────────────────┐
│       Backend API (后端服务)             │
│       http://localhost:3001/api          │
└──────────────────────────────────────────┘
```

---

## 设计模式

### 功能模块化（Feature-based Structure）
- 按功能（Portfolio、Transaction）组织代码
- 每个功能包含自己的组件、页面、Hooks

### 容器/展示组件分离
- 容器组件：负责数据获取和状态管理
- 展示组件：纯 UI 渲染，接收 props

### 自定义 Hooks
- 封装数据获取逻辑（`usePortfolios`、`useTransactions`）
- 提高代码复用性

---

## 未来改进建议

1. **重构 legacy 组件**：迁移到新的功能模块结构
2. **补充单元测试**：提高组件测试覆盖率
3. **性能优化**：
   - 使用 React.memo 减少不必要的渲染
   - 虚拟滚动优化大列表
4. **国际化（i18n）**：支持多语言
5. **主题切换**：支持暗色模式
6. **错误边界**：添加全局错误处理
