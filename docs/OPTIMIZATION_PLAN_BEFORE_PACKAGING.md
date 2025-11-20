# 打包前项目优化清单与实施步骤

> **状态**：待实施
> **目标**：在实施 Electron 托管后端架构之前，解决代码一致性、性能和健壮性问题，确保打包后的应用稳定且高效。

## 1. 🏗️ 架构一致性：统一类型定义 (Type Unification)

**问题**：`apps/backend` 重复定义了核心实体（Transaction, Portfolio, Position），未复用 `packages/domain` 中的定义，导致维护成本高且容易产生数据结构不一致。

**实施步骤**：

1.  **建立依赖**：确保 `apps/backend` 的 `package.json` 依赖了 `@uht/domain`。
2.  **替换 Transaction 定义**：
    - 修改 `apps/backend/src/types/index.ts`，删除 `Transaction` 接口。
    - 引入 `import { Transaction, TransactionType } from '@uht/domain'`.
    - 修复因字段差异（如有）导致的编译错误。
3.  **替换 Portfolio/Position 定义**：
    - 同样替换 `Portfolio` 和 `Position` 接口。
    - _注意_：后端可能有特定的 DTO（Data Transfer Object）需求，如果差异过大，应定义 `PortfolioDto extends Portfolio` 而不是完全重写。
4.  **清理冗余代码**：删除 `apps/backend/src/types` 中不再使用的代码。

## 2. ⚡ 前端性能优化 (Frontend Performance)

**问题**：ECharts 全量引入导致 bundle 体积过大；React Query 默认配置可能在 Electron 本地环境中造成不必要的计算压力。

**实施步骤**：

1.  **ECharts 按需加载**：
    - 创建 `frontend/src/lib/echarts.ts`。
    - 仅引入 `use(LineChart, BarChart, PieChart, GridComponent, TooltipComponent, ...)`。
    - 修改组件引用方式，使用按需加载后的实例。
2.  **React Query 策略调整**：
    - 修改 `frontend/src/main.tsx` 或 `queryClient` 配置。
    - 设置 `defaultOptions.queries.staleTime` 为 30000 (30秒) 或更长。在本地单用户环境下，数据不会频繁由他人修改，无需频繁重新验证。
    - 设置 `refetchOnWindowFocus: false`，避免用户切换窗口时触发重计算（Electron 用户可能频繁切换）。

## 3. 🛡️ 后端健壮性优化 (Backend Robustness)

**问题**：后端设计为独立服务，作为 Electron 子进程运行时，可能出现端口冲突、僵尸进程（主进程关闭后后端仍在运行）等问题。

**实施步骤**：

1.  **实现“父进程存活检测” (Zombie Killer)**：
    - 在 `apps/backend/src/server.ts` 启动时检查环境变量（如 `ELECTRON_RUN_AS_NODE` 或自定义 `PARENT_PID`）。
    - 如果作为子进程运行，启动定时器检查父进程是否存在。若父进程消失，自动 `process.exit(0)`。
2.  **支持动态配置**：
    - 修改配置加载逻辑，优先读取环境变量中的配置：
      - `PORT`: 允许设为 0（随机端口），避免硬编码 3001 冲突。
      - `LOG_PATH`: 支持将日志写入 Electron 的 `userData` 目录，而不是项目根目录。
      - `DATABASE_URL`: 确保能正确读取打包后 Prisma 数据库路径。

## 4. 🚀 构建流程优化 (Build Process)

**问题**：当前的构建脚本串行执行，速度较慢；且缺乏针对 Electron 的构建验证。

**实施步骤**：

1.  **并行构建**：
    - 修改根目录 `package.json`。
    - 优化 `build` 脚本：`npm run build:packages && concurrently "npm run build:backend" "npm run build:frontend"`。
2.  **清理脚本**：
    - 确保 `clean` 脚本能彻底清除 `dist` 和缓存，防止旧文件残留导致打包诡异问题。

---

## ✅ 建议执行顺序

1.  **Type Unification** (风险最低，代码质量收益高)
2.  **Backend Robustness** (为打包做准备的基础设施)
3.  **Frontend Performance** (独立优化，随时可做)
4.  **Build Optimization** (最后调整脚本)
