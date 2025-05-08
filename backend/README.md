# 后端服务架构说明

## 简介

本项目后端服务是一个基于 Node.js 和 Express 构建的 API 服务器，主要负责处理投资组合管理、交易记录、市场数据获取和相关计算逻辑。它为前端应用（如 Electron 应用）提供数据支持和业务功能。

## 技术栈

*   **运行时**: Node.js
*   **Web 框架**: Express 5+
*   **语言**: TypeScript
*   **主要依赖**:
    *   `axios`: 用于发送 HTTP 请求（例如，访问腾讯行情 API）。
    *   `cors`: 处理跨域资源共享。
    *   `date-fns`: 提供日期时间处理功能。
    *   `iconv-lite`: 处理字符编码（可能用于外部 API 数据）。
    *   `node-cache`: 用于实现内存缓存。
*   **开发与构建**:
    *   `typescript`: TypeScript 编译器。
    *   `ts-node-dev`: 开发时运行 TypeScript 代码并自动重启。
    *   `pkg`: 将 Node.js 项目打包成可执行文件。
*   **测试**:
    *   `jest`: JavaScript 测试框架。
    *   `ts-jest`: Jest 的 TypeScript 预处理器。

## 项目结构

```
backend/
├── data/             # 应用数据存储目录 (JSON 文件等)
│   ├── logs/         # (推测) 日志文件
│   ├── market/       # (推测) 市场相关数据
│   ├── portfolios/   # 投资组合数据
│   ├── settings/     # (推测) 应用设置
│   └── transactions/ # (推测) 交易记录备份或缓存
├── dist/             # TypeScript 编译后的 JavaScript 输出目录
├── node_modules/     # 项目依赖包
├── src/              # 源代码目录 (TypeScript)
│   ├── routes/       # API 路由定义
│   │   ├── portfolio.ts    # 处理投资组合相关 API (/api/portfolio/*)
│   │   └── marketData.ts   # 处理市场数据相关 API (/api/market/*)
│   ├── services/     # 业务逻辑层
│   │   ├── storage.ts            # 数据持久化服务 (读写 data/ 目录下的 JSON 文件)
│   │   ├── calculationService.ts # 核心计算逻辑 (盈亏、统计、成本等)
│   │   ├── tencentApi.ts         # 与腾讯行情 API 交互的服务
│   │   ├── currencyService.ts    # 汇率获取与货币转换服务
│   │   ├── cacheService.ts       # (推测) 缓存管理服务
│   │   ├── cacheValidationService.ts # (推测) 缓存验证服务
│   │   ├── dataService.ts        # (推测) 通用数据处理或访问服务
│   │   └── __tests__/          # 服务的单元测试
│   ├── types/        # TypeScript 类型定义 (接口、枚举等)
│   │   └── index.ts
│   └── server.ts     # Express 应用入口，服务器启动和中间件配置
├── jest.config.js    # Jest 测试框架配置文件
├── package-lock.json # 精确锁定依赖版本
├── package.json      # 项目清单 (依赖、脚本、pkg 配置等)
└── tsconfig.json     # TypeScript 编译器配置文件
```

## 主要流程

1.  **启动**: `server.ts` 启动 Express 应用，加载中间件（如 CORS, body-parser），并挂载 `routes/` 目录中定义的路由。
2.  **API 请求**: 前端或其他客户端向后端发送 API 请求（例如 `GET /api/portfolio/:id`）。
3.  **路由处理**: Express 根据请求路径将请求分发到 `routes/` 中对应的路由处理函数（例如 `portfolio.ts` 中的处理函数）。
4.  **业务逻辑**: 路由处理函数调用 `services/` 中的一个或多个服务来处理业务逻辑。
    *   例如，获取投资组合详情可能需要调用 `storage.ts` 读取数据，调用 `calculationService.ts` 计算统计信息，调用 `currencyService.ts` 处理汇率。
    *   获取市场数据可能需要调用 `tencentApi.ts`。
5.  **数据持久化**: `storage.ts` 负责从 `data/` 目录读取数据或将更新后的数据写回 JSON 文件。
6.  **响应**: 路由处理函数将处理结果（通常是 JSON 格式）返回给客户端。

## 运行与构建

*   **开发模式**:
    ```bash
    cd backend
    npm run dev
    ```
    这将使用 `ts-node-dev` 启动服务器，并在代码更改时自动重启。服务通常监听在 `http://localhost:3001` (具体端口在 `server.ts` 中配置)。

*   **构建生产版本**:
    ```bash
    cd backend
    npm run build
    ```
    这将使用 `tsc` 将 `src/` 目录下的 TypeScript 代码编译到 `dist/` 目录。

*   **运行生产版本**:
    ```bash
    cd backend
    npm start
    # 或者直接运行 node dist/server.js
    ```

*   **打包成可执行文件**:
    ```bash
    cd backend
    # 确保已运行 npm run build
    npx pkg .
    ```
    这会根据 `package.json` 中的 `pkg` 配置，将应用打包成 `.exe` 文件，并输出到 `release/backend` 目录。

## 测试

*   运行所有单元测试:
    ```bash
    cd backend
    npm run test
    ```
    Jest 会根据 `jest.config.js` 的配置查找并运行 `src/services/__tests__` 目录下的测试文件。
