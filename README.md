# Unified Holdings Tracker - 桌面应用

一个使�?Electron、React �?Node.js 构建的桌面应用程序，用于跟踪和管理投资组合�?
![image](https://github.com/user-attachments/assets/db707842-b0b7-43b0-abce-ea84b506356d)
![投资组合快照_20250508025358](https://github.com/user-attachments/assets/af5e6b92-470f-46d3-a463-6c39cd83e6f1)
记录每年杠杆用了多少钱，刚按比例，分红多少钱，手续费花了多少钱。仓位的整体年化等等�?
## 主要功能

*   投资组合概览与统�?
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
├── apps/
�?  └── backend/     # 后端 Node.js/Express 服务
�?      ├── src/
�?      ├── data/    # JSON 数据 / 迁移脚本输入
�?      └── package.json
├── packages/
�?  ├── domain/
�?  ├── application/
�?  └── infra/       # 三层占位目录，后续落地领�?应用/基础设施代码
├── frontend/        # ǰ�� React Ӧ��
�?  ├── src/
�?  ├── public/
�?  └── package.json
├── electron/        # Electron �����̺ʹ����ű�
�?  ├── main.ts      # ���������?
�?  ├── assets/      # ͼ������?
�?  └── launcher/    # Ӧ���������ű�
├── docs/
�?  ├── notes/       # ��ƻ����?ʵʩ��ϸ
�?  └── reports/     # Ͷ����ϱ���?���档
├── setup.iss        # Inno Setup ��װ����ű�?
├── package.json     # ����Ŀ���������� (���ʹ��?monorepo)
└── README.md        # ���ļ�
```

*Electron renderer 静态资源由 frontend build 时生成，实际打包流程会把 `frontend/dist` 拷贝�?Electron renderer 目录*

## 文档索引
- `docs/notes/`: 方案/迭代记录
- `docs/reports/`: 历史投资报告快照

## 开发脚本与 Monorepo

项目已切换到 npm workspace。常用命令如下：

```bash
# 安装所有依�?npm install

# 启动后端 / 前端
npm run dev:backend
npm run dev:frontend

# Electron TypeScript watch & 主进�?npm run watch:electron
npm run start:electron

# 独立构建
npm run build -w backend
npm run build -w frontend
npm run build:electron
```

（`npm run <script> -w <workspace>` 可对任意子项目执行自定义脚本。）

## ⚠️ Git 回退后的环境恢复

**如果你使用了 `git reset`、`git checkout` 或 `git revert` 回退代码**，请务必运行恢复脚本以重建开发环境！

### 为什么需要恢复？

Git 只恢复源代码，不会恢复：
- `node_modules/`（依赖包）
- `dist/`、`build/`（构建产物）
- `.env` 文件（配置文件）
- `portfolio.db`（数据库文件）
- `.prisma/`（Prisma 生成代码）

这会导致代码与运行环境不匹配，出现数据库错误、前端链接错误等问题。

### 快速恢复（推荐）

**Windows 用户**：
```batch
:: 双击运行或命令行执行
.\scripts\post-git-reset.bat
```

**Linux/Mac 用户**：
```bash
chmod +x scripts/post-git-reset.sh
./scripts/post-git-reset.sh
```

### 手动恢复步骤

如果自动脚本失败，可以手动执行：

```bash
# 1. 停止所有进程
taskkill /f /im node.exe     # Windows
pkill -9 node                # Linux/Mac

# 2. 清理缓存和构建产物
rm -rf node_modules/.prisma
rm -rf apps/backend/dist
rm -rf frontend/dist
rm -rf electron/renderer

# 3. 重新安装依赖
npm install

# 4. 重新生成 Prisma Client
npm run prisma:generate -w backend

# 5. 同步数据库结构
npm run db:push -w backend

# 6. 重新构建
npm run build -w backend
npm run build -w frontend
```

### 详细文档

遇到问题？查看完整的故障排查指南：
📖 **[docs/修复数据库问题.md](docs/修复数据库问题.md)**

---

## 环境变量

根目录提�?`.env.example`，前端提�?`frontend/.env.example`。根据需要复制并修改�?
```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

- `.env` ���� `PORT`��`FRONTEND_URL`��`API_BASE_PATH`��`DATABASE_URL`��Ĭ�� `file:./apps/backend/prisma/data/portfolio.db`���Ⱥ�� / Launcher ��Ϊ
- `frontend/.env` 通过 `VITE_API_BASE_URL` 决定前端调用的后端地址


### 数据指标

- 周度/月度收益：后端 `calculatePeriodStats` 在估算期末净值时会使用实时行情（当前报价），因此展示结果代表“截至当前时刻”的收益表现。

如需更改端口�?API 前缀，仅需修改上述文件并重新启动相关服务�?
## ���ݿ�

���Ĭ��ʹ�� SQLite��ͨ�� Prisma �����������ݿ��ļ�λ�� `apps/backend/prisma/data/portfolio.db`����ͨ�� `.env` �е� `DATABASE_URL` �Զ��壩��

�������
```bash
npm run prisma:generate -w backend   # ���� Prisma Client
npm run prisma:migrate -w backend    # �ڿ�����������/Ӧ��Ǩ��
npm run db:push -w backend           # �� schema ���͵����� SQLite
npm run migrate:json -w backend      # �� JSON ���ݵ��� SQLite
```

## 安装 (Release 版本)

1.  访问项目�?[Releases 页面](https://github.com/cuowuxuexi/Unified.Holdings.Tracker/releases) (如果存在) 或从其他指定位置下载最新的 `Unified.Holdings.Tracker.exe` 安装程序�?
2.  运行下载�?`.exe` 文件并按照安装向导完成安装�?
3.  安装完成后，您可以从开始菜单或桌面快捷方式启动应用程序。启动器会自动运行所需的后端服务和前端界面�?

*注意：此版本捆绑了运行所需的所有组件�?

## 开始使�?(开发模�?

### 环境要求

*   Node.js (建议使用 LTS 版本)
*   npm �?yarn

### 安装与运�?

1.  **克隆仓库**:
    ```bash
    git clone https://github.com/cuowuxuexi/Unified.Holdings.Tracker.git
    cd Unified.Holdings.Tracker
    ```

2.  **安装所有依赖（workspace�?*:
    ```bash
    npm install
    ```

3.  **启动后端服务**:
    ```bash
    npm run dev:backend
    ```

4.  **启动前端开发服务器**:
    ```bash
    npm run dev:frontend
    ```

5.  **Electron 调试（可选）**:
    ```bash
    npm run watch:electron   # TypeScript watch
    npm run start:electron   # 启动主进�?    ```
    *注意：开发阶�?Electron 会连接前�?dev server，生产模式需先执�?`npm run build -w frontend`�?

### 打包与安�?(生产模式构建)

*   Packaging 之前请分别对 backend (`npm run build`) �?frontend (`npm run build`) 进行构建，以�?Electron Forge 自动复制 renderer/back-end 产物�?
*   项目似乎使用 Electron Forge 进行打包，并使用 Inno Setup (`setup.iss`) 创建 Windows 安装程序�?
*   具体的打包命令请参�?`electron/package.json` 和根目录的打包相关脚本或文档�?
*   打包后会生成可执行文件或安装程序（如 `setup.iss` 生成的安装包）�?

## 贡献

欢迎提出问题和贡献代码。请遵循标准�?GitHub Flow�?

## 许可�?

（请在此处添加您的项目许可证信息，例�?MIT, Apache 2.0 等）
