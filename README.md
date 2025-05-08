# Unified Holdings Tracker - 桌面应用

一个使用 Electron、React 和 Node.js 构建的桌面应用程序，用于跟踪和管理投资组合。
![image](https://github.com/user-attachments/assets/db707842-b0b7-43b0-abce-ea84b506356d)
![投资组合快照_20250508025358](https://github.com/user-attachments/assets/af5e6b92-470f-46d3-a463-6c39cd83e6f1)
记录每年杠杆用了多少钱，刚按比例，分红多少钱，手续费花了多少钱。仓位的整体年化等等。
## 主要功能

*   投资组合概览与统计
*   持仓明细查看
*   交易记录管理
*   市场指数展示
*   （可能包含更多功能，请根据实际情况补充）

## 技术栈

*   **桌面框架**: Electron
*   **前端**: React, TypeScript, Vite, Ant Design (可能用于 UI)
*   **后端**: Node.js, Express, TypeScript
*   **打包**: Electron Forge, Inno Setup (`setup.iss`)

## 项目结构

```
.
├── backend/         # 后端 Node.js/Express 服务
│   ├── src/
│   ├── data/        # 后端数据存储 (JSON)
│   ├── package.json
│   └── ...
├── frontend/        # 前端 React 应用
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
├── electron/        # Electron 主进程、渲染进程配置和打包脚本
│   ├── main.ts      # 主进程入口
│   ├── renderer/    # 渲染进程相关文件 (可能由 Vite 构建输出)
│   ├── assets/      # 图标等资源
│   ├── launcher/    # 应用启动器脚本
│   ├── package.json
│   └── forge.config.js
├── 打包方案/        # 项目打包相关文档
├── setup.iss        # Inno Setup 安装程序脚本
├── package.json     # 根项目或工作区配置 (如果使用 monorepo)
└── README.md        # 本文件
```

## 安装 (Release 版本)

1.  访问项目的 [Releases 页面](https://github.com/cuowuxuexi/Unified.Holdings.Tracker/releases) (如果存在) 或从其他指定位置下载最新的 `Unified.Holdings.Tracker.exe` 安装程序。
2.  运行下载的 `.exe` 文件并按照安装向导完成安装。
3.  安装完成后，您可以从开始菜单或桌面快捷方式启动应用程序。启动器会自动运行所需的后端服务和前端界面。

*注意：此版本捆绑了运行所需的所有组件。*

## 开始使用 (开发模式)

### 环境要求

*   Node.js (建议使用 LTS 版本)
*   npm 或 yarn

### 安装与运行

1.  **克隆仓库**:
    ```bash
    git clone https://github.com/cuowuxuexi/Unified.Holdings.Tracker.git
    cd Unified.Holdings.Tracker
    ```

2.  **安装后端依赖**:
    ```bash
    cd backend
    npm install
    cd ..
    ```

3.  **安装前端依赖**:
    ```bash
    cd frontend
    npm install
    cd ..
    ```

4.  **安装 Electron 依赖**:
    ```bash
    cd electron
    npm install
    cd ..
    ```

5.  **启动后端服务** (需要根据 `backend/package.json` 中的脚本调整):
    ```bash
    cd backend
    npm run dev # 或者 npm start
    cd ..
    ```

6.  **启动前端开发服务器** (需要根据 `frontend/package.json` 中的脚本调整):
    ```bash
    cd frontend
    npm run dev
    cd ..
    ```

7.  **启动 Electron 应用** (需要根据 `electron/package.json` 中的脚本调整):
    ```bash
    cd electron
    npm start # 或者 npm run dev
    ```
    *注意：可能需要配置 Electron 加载前端开发服务器的 URL。*

### 打包与安装 (生产模式构建)

*   项目似乎使用 Electron Forge 进行打包，并使用 Inno Setup (`setup.iss`) 创建 Windows 安装程序。
*   具体的打包命令请参考 `electron/package.json` 和根目录的打包相关脚本或文档。
*   打包后会生成可执行文件或安装程序（如 `setup.iss` 生成的安装包）。

## 贡献

欢迎提出问题和贡献代码。请遵循标准的 GitHub Flow。

## 许可证

（请在此处添加您的项目许可证信息，例如 MIT, Apache 2.0 等）
