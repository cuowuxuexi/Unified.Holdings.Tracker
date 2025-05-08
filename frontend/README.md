# 前端项目说明 (React + TypeScript + Vite)

本项目是使用 Vite 构建的 React 前端应用程序，采用 TypeScript 进行开发。

## 技术栈

*   **核心库**: React 19+, React DOM 19+
*   **状态管理**: Zustand 5+
*   **UI 库**: Ant Design (antd) 5+
*   **HTTP 请求**: Axios
*   **日期处理**: Dayjs
*   **图表**: ECharts, echarts-for-react
*   **拖拽**: @dnd-kit/core, @dnd-kit/sortable
*   **构建工具**: Vite 6+
*   **语言**: TypeScript 5+
*   **代码检查**: ESLint 9+, typescript-eslint 8+
*   **测试**: Vitest 3+, React Testing Library

## 项目结构概览

*   **`public/`**: 存放静态资源，构建时会直接复制到输出目录。
*   **`src/`**: 包含所有 React 组件、状态管理逻辑、服务、工具函数和主要的 CSS 样式。
    *   `main.tsx`: 应用的入口文件。
    *   `App.tsx`: 根组件。
    *   `index.css`: 全局基础样式。
    *   `components/`: UI 组件目录。
    *   `services/`: API 请求等服务。
    *   `store/`: Zustand 状态管理。
    *   `utils/`: 工具函数。
*   **`index.html`**: Vite 应用的 HTML 入口文件。
*   **`vite.config.ts`**: Vite 配置文件，包含插件、构建选项（输出到 `../electron/renderer` 以便 Electron 集成）和测试配置。
*   **`tsconfig.*.json`**: TypeScript 配置文件，分别用于应用代码 (`tsconfig.app.json`) 和 Node.js 环境代码 (`tsconfig.node.json`)。
*   **`eslint.config.js`**: ESLint 配置文件，用于代码风格和质量检查。
*   **`package.json`**: 项目依赖和脚本定义。
*   **`package-lock.json`**: 锁定依赖版本。

## 快速开始

1.  **安装依赖**:
    ```bash
    npm install
    # 或者 yarn install / pnpm install
    ```

2.  **启动开发服务器**:
    ```bash
    npm run dev
    # 或者 yarn dev / pnpm dev
    ```
    应用将在本地启动，并支持热模块替换 (HMR)。

3.  **构建生产版本**:
    ```bash
    npm run build
    # 或者 yarn build / pnpm build
    ```
    构建产物将输出到 `../electron/renderer` 目录。

4.  **运行代码检查**:
    ```bash
    npm run lint
    # 或者 yarn lint / pnpm lint
    ```

5.  **运行单元测试**:
    ```bash
    npm run test
    # 或者 yarn test / pnpm test
    ```

## 配置说明

*   **Vite**: 配置见 `vite.config.ts`。特别注意 `base: './'` 设置是为了确保在 `file://` 协议下（如 Electron）资源路径正确。构建输出目录已配置为与 Electron 项目集成。
*   **TypeScript**: 配置分为 `tsconfig.app.json` (用于 `src` 目录) 和 `tsconfig.node.json` (用于 `vite.config.ts` 等)。启用了严格模式和多项检查。
*   **ESLint**: 配置见 `eslint.config.js`。集成了 TypeScript、React Hooks 和 React Refresh 的规则。

# 后端汇率服务说明

*   本系统后端使用[Frankfurter API](https://www.frankfurter.app/)获取USD-CNY、HKD-CNY汇率。
*   汇率每日凌晨1点自动刷新，写入`backend/data/latest_rates.json`，所有业务均读取本地缓存。
*   若API调用失败，系统保留旧缓存并记录详细日志。
*   Frankfurter API为免费开放接口，无需API Key。
