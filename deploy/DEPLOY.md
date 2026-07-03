# UHT 云服务器部署说明书

> **Unified Holdings Tracker** — 投资组合追踪系统  
> 最后更新：2026-07-03

---

## 目录

- [架构概览](#架构概览)
- [环境要求](#环境要求)
- [一、服务器初始化](#一服务器初始化)
- [二、部署项目](#二部署项目)
- [三、配置 Nginx](#三配置-nginx)
- [四、启动服务](#四启动服务)
- [五、验证部署](#五验证部署)
- [六、日常运维](#六日常运维)
- [七、故障排查](#七故障排查)
- [附录](#附录)

---

## 架构概览

```
用户浏览器
    │
    ▼
┌─────────────────────────────────┐
│           Nginx (:80)           │
│  ┌───────────┬────────────────┐ │
│  │  / 静态文件 │  /api/ 反向代理 │ │
│  │ frontend/ │               │ │
│  │   dist/   │       │       │ │
│  └───────────┘       ▼       │ │
│              ┌──────────────┐│ │
│              │ Node.js 后端  ││ │
│              │  (:3001)     ││ │
│              │  Express 5   ││ │
│              └──────┬───────┘│ │
│                     │        │ │
│              ┌──────▼───────┐│ │
│              │   SQLite DB  ││ │
│              │ portfolio.db ││ │
│              └──────────────┘│ │
└─────────────────────────────────┘
```

| 组件     | 技术               | 端口 | 说明                 |
| -------- | ------------------ | ---- | -------------------- |
| 反向代理 | Nginx              | 80   | 静态文件 + API 代理  |
| 后端     | Express 5 + Prisma | 3001 | REST API             |
| 数据库   | SQLite             | —    | 文件级数据库，零配置 |
| 进程管理 | PM2                | —    | 守护进程 + 开机自启  |

---

## 环境要求

| 项目     | 最低要求                 | 推荐         |
| -------- | ------------------------ | ------------ |
| 操作系统 | Ubuntu 20.04 / Debian 11 | Ubuntu 22.04 |
| Node.js  | 18.x                     | 20.x LTS     |
| 内存     | 512 MB                   | 1 GB         |
| 磁盘     | 1 GB                     | 5 GB         |
| 网络     | 开放 80 端口             | 80 + 443     |

---

## 一、服务器初始化

### 1.1 更新系统

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 安装 Node.js

```bash
# 安装 Node.js 20.x（推荐）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node -v   # v20.x.x
npm -v    # 10.x.x
```

### 1.3 安装 Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

### 1.4 安装 PM2

```bash
sudo npm install -g pm2
```

### 1.5 安装 Git

```bash
sudo apt install -y git
```

---

## 二、部署项目

### 2.1 克隆代码

```bash
# 创建应用目录
sudo mkdir -p /opt/uht
sudo chown $USER:$USER /opt/uht

# 克隆 server 分支
git clone -b main https://github.com/cuowuxuexi/Unified.Holdings.Tracker.git /opt/uht
cd /opt/uht
```

### 2.2 安装依赖

```bash
npm install
```

### 2.3 配置环境变量

```bash
# 从模板创建后端环境配置
cp deploy/.env.production.example apps/backend/.env
```

编辑 `apps/backend/.env`，确认以下内容：

```env
NODE_ENV=production
PORT=3001
FRONTEND_URL=http://你的域名或IP
DATABASE_URL="file:./prisma/data/portfolio.db"
API_BASE_PATH=/api
```

> **说明**：如果使用 Nginx 同源代理（推荐方案），浏览器请求不跨域，`FRONTEND_URL` 的值不影响使用。生产环境 CORS 已收紧为白名单（`FRONTEND_URL` + `CORS_ORIGINS` 环境变量，逗号分隔），不再反射任意来源。

### 2.4 构建项目

```bash
npm run deploy:build
```

该命令会依次执行：

1. 清理旧的构建产物
2. 生成 Prisma Client
3. 构建共享包（domain → application → infra）
4. **并行**构建后端（esbuild → `apps/backend/dist/server-bundle.js`）和前端（Vite → `frontend/dist/`）

### 2.5 初始化数据库

```bash
# 确保数据目录存在
mkdir -p apps/backend/prisma/data

# 执行数据库迁移（创建所有表）
cd apps/backend
npx prisma migrate deploy --schema prisma/schema.prisma
cd /opt/uht
```

---

## 三、配置 Nginx

### 3.1 部署配置文件

```bash
# 复制 Nginx 配置
sudo cp deploy/nginx.conf /etc/nginx/sites-available/uht

# 启用站点
sudo ln -sf /etc/nginx/sites-available/uht /etc/nginx/sites-enabled/uht

# 移除默认站点（可选）
sudo rm -f /etc/nginx/sites-enabled/default
```

### 3.2 修改配置（按需）

编辑 `/etc/nginx/sites-available/uht`：

```nginx
server {
    listen 80;
    server_name _;  # ← 替换为你的域名，如: uht.example.com

    # 前端静态文件
    location / {
        root /opt/uht/frontend/dist;  # ← 确认路径正确
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
    }

    location ~ /\. {
        deny all;
    }
}
```

### 3.3 验证并重载

```bash
# 测试配置是否正确
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

---

## 四、启动服务

### 4.1 使用 PM2 启动后端

```bash
cd /opt/uht
pm2 start deploy/ecosystem.config.js
```

### 4.2 验证启动状态

```bash
pm2 status
```

应看到 `uht-backend` 状态为 `online`：

```
┌─────────────┬────┬──────┬────────┬─────────┐
│ App name    │ id │ mode │ status │ cpu     │
├─────────────┼────┼──────┼────────┼─────────┤
│ uht-backend │ 0  │ fork │ online │ 0%      │
└─────────────┴────┴──────┴────────┴─────────┘
```

### 4.3 设置开机自启

```bash
pm2 startup
# 按提示执行输出的 sudo 命令
pm2 save
```

---

## 五、验证部署

### 5.1 后端健康检查

```bash
curl http://localhost:3001/api/health
```

期望返回：

```json
{
  "status": "ok",
  "timestamp": "2026-02-24T...",
  "uptime": 5.123,
  "checks": { "database": "up" }
}
```

### 5.2 前端页面

```bash
curl -I http://localhost
```

期望返回 `200 OK`，`Content-Type: text/html`。

### 5.3 浏览器访问

打开 `http://你的服务器IP`，应看到 UHT 投资组合管理界面。

### 5.4 防火墙检查

如果无法从外部访问，检查防火墙：

```bash
# Ubuntu UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp  # 如果后续启用 HTTPS

# 或者确认云服务商安全组已开放 80 端口
```

---

## 六、日常运维

### 6.1 更新代码

```bash
cd /opt/uht
git pull origin main
npm install              # 如果依赖有变更
npm run deploy:build     # 重新构建
pm2 restart uht-backend  # 重启后端
```

### 6.2 查看日志

```bash
# PM2 实时日志
pm2 logs uht-backend

# 历史日志文件
cat /opt/uht/logs/pm2-out.log    # 标准输出
cat /opt/uht/logs/pm2-error.log  # 错误日志

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 6.3 数据库备份

**自动备份（内置）**：后端启动后每 24 小时通过 SQLite `VACUUM INTO` 做一次整库在线备份，产物保存在数据目录下的 `db-backups/`（Docker 部署时位于 tracker-data volume 内），自动保留最近 7 份。

```bash
# Docker 部署下查看自动备份
ls /var/lib/docker/volumes/tracker-data/_data/db-backups/

# 从备份恢复（先停后端，再覆盖主库文件）
docker compose stop backend
cp /var/lib/docker/volumes/tracker-data/_data/db-backups/portfolio-<时间戳>.db \
   /var/lib/docker/volumes/tracker-data/_data/portfolio.db
docker compose start backend
```

**异地备份（建议）**：volume 内备份不防磁盘/服务器故障，建议定期把 `db-backups/` 拷贝到服务器之外：

```bash
# 手动备份到本地（在自己电脑上执行）
scp 服务器:/var/lib/docker/volumes/tracker-data/_data/db-backups/*.db ./backup/
```

### 6.4 数据库迁移

当 schema 发生变化时：

```bash
cd /opt/uht/apps/backend
npx prisma migrate deploy --schema prisma/schema.prisma
cd /opt/uht
pm2 restart uht-backend
```

---

### 6.5 M8.4 market/index 日常补采 wrapper（示例，默认未启用）

`deploy/uht-source-data-scheduler.sh` 是生产 host 侧的一次性调度 wrapper，
用于把 M8.3 已验证的 market/index 补采命令固化为可审计流程。它不会改
crontab 或 live systemd 配置；只有在后续 M8.4 启用门通过后，才可以把
`*.service.example` / `*.timer.example` 复制到系统目录并启用。

安全门禁：

- 固定只执行 `market_quote,index`，不混入 FX / yield / macro。
- 固定使用 `docker compose run --rm --no-deps` 的 one-off backend 容器。
- 固定挂载 `tracker-data:/fact-write`，并设置
  `DATABASE_URL=file:/fact-write/portfolio.db`、
  `UHT_BACKFILL_ISOLATED_ROOT=/fact-write`、
  `--confirm-isolated-db portfolio.db`。
- 先 dry-run；只有 dry-run report 满足
  `countVerification.unchanged=true` 且 `changedTables=[]`，并且 wrapper 自己的
  宽表 count diff 为空，才会备份并进入 write。
- write 前备份
  `/var/lib/docker/volumes/tracker-data/_data/portfolio.db` 到 backup root。
- write 后 count guard 只允许 `SourceRun`、`SourceHealth`、`QuoteSnapshot`、
  `IndexSnapshot` 的 count 变化；`ExchangeRateSnapshot`、`YieldCurveSnapshot`、
  `MacroIndicatorSnapshot`、`Portfolio`、`PositionSnapshot`、`Transaction` 等表
  变化会 fail closed。
- 每次运行都会落盘 wrapper stdout/stderr、runner stdout/stderr、dry-run report、
  write report、pre/post counts 和 count diff。

默认配置：

| 环境变量                                            | 默认值                                         | 说明                                             |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `UHT_SCHEDULER_PORTFOLIO_ID`                        | `a3c29c28-7a1f-402d-a36d-ca85f5f8276a`         | 生产 2026 组合                                   |
| `UHT_SCHEDULER_LOOKBACK_DAYS`                       | `5`                                            | 默认最近 5 日；允许 3..5                         |
| `UHT_SCHEDULER_DATE_FROM` / `UHT_SCHEDULER_DATE_TO` | 空 / 昨天                                      | 显式覆盖日期窗口                                 |
| `UHT_SCHEDULER_MAX_ROWS`                            | `256`                                          | runner 行数安全上限                              |
| `UHT_SCHEDULER_LOG_ROOT`                            | `/root/tracker/uht-source-data-scheduler-logs` | 每次运行证据目录根                               |
| `UHT_SCHEDULER_BACKUP_ROOT`                         | `/root/tracker/uht-db-backups`                 | write 前 DB 备份目录                             |
| `UHT_SCHEDULER_DRY_RUN_ONLY`                        | `0`                                            | 设置为 `1` / `true` 时只跑 dry-run，不进入 write |

手动预检示例（不会启用调度；`DRY_RUN_ONLY=1` 不写生产 DB）：

```bash
cd /root/tracker/Unified.Holdings.Tracker-server
UHT_SCHEDULER_DRY_RUN_ONLY=1 deploy/uht-source-data-scheduler.sh
```

systemd 示例文件：

- `deploy/uht-source-data-scheduler.service.example`
- `deploy/uht-source-data-scheduler.timer.example`

> 注意：M8.4.1 只交付 wrapper 和示例文件，不执行 `systemctl enable` /
> `systemctl start`，也不修改生产 crontab。

---

## 六.六、Docker 部署与访问控制（当前生产方式，必读）

生产服务器实际使用 docker-compose 部署（`tracker-backend` + `tracker-nginx`），而非上文的 PM2 方案。**公网部署必须启用 Basic Auth**，否则持仓数据对任何访问者可见。

### 启用 Basic Auth

nginx 配置（`deploy/nginx-docker.conf`）已默认开启 `auth_basic`，密码文件通过 docker-compose 挂载 `deploy/.htpasswd`（已加入 .gitignore，不进仓库）。部署前在服务器的仓库目录生成密码文件：

```bash
cd /root/tracker/Unified.Holdings.Tracker-server

# 方式一：apache2-utils
apt install -y apache2-utils
htpasswd -c deploy/.htpasswd 你的用户名   # 会提示输入密码

# 方式二：openssl（无需额外安装）
printf '你的用户名:%s\n' "$(openssl passwd -apr1)" > deploy/.htpasswd

# 重建并启动
docker compose up -d --build
```

验证：浏览器访问应弹出用户名密码框；`curl -I http://127.0.0.1:8080/api/health` 应返回 `401`，带凭证 `curl -u 用户名:密码 ...` 返回 `200`。

> 注意：若 `deploy/.htpasswd` 不存在，Docker 会自动创建同名**目录**导致 nginx 报错——务必先生成文件再 `up`。

### 其他安全基线（代码内置，无需配置）

- 后端已启用 helmet 安全头与 API 限流（600 次/分钟/IP）
- 生产环境 5xx 错误不回传内部细节
- SQLite 已启用 WAL 模式与 busy_timeout
- 每日自动整库备份（见 6.3）

### HTTPS（可选，需要域名）

有域名时参考附录 D 用 certbot 签发证书；纯 IP 访问暂无低成本方案，Basic Auth 密码建议设置为强密码并定期更换。

---

## 七、故障排查

### 问题：502 Bad Gateway

**原因**：后端未启动或已崩溃。

```bash
pm2 status                  # 检查状态
pm2 logs uht-backend --lines 50  # 查看最近日志
pm2 restart uht-backend     # 尝试重启
```

### 问题：前端页面空白

**原因**：前端未构建或 Nginx 路径配置错误。

```bash
# 检查构建产物是否存在
ls -la /opt/uht/frontend/dist/index.html

# 如果不存在，重新构建
npm run deploy:build
```

### 问题：API 请求 404

**原因**：Nginx 代理配置有误，或后端路由前缀不匹配。

```bash
# 直接测试后端
curl http://localhost:3001/api/health

# 通过 Nginx 测试
curl http://localhost/api/health
```

### 问题：数据库锁定 (SQLITE_BUSY)

**原因**：SQLite 并发写入限制。

```bash
# 确保只有一个后端实例在运行
pm2 status  # 应该只有 1 个 uht-backend
```

---

## 附录

### A. 目录结构

```
/opt/uht/
├── apps/backend/
│   ├── dist/server-bundle.js    ← 后端构建产物
│   ├── prisma/
│   │   ├── data/portfolio.db    ← SQLite 数据库
│   │   └── schema.prisma        ← 数据库 Schema
│   └── .env                     ← 后端环境变量
├── frontend/
│   └── dist/                    ← 前端构建产物（Nginx 托管）
│       ├── index.html
│       └── assets/
├── deploy/
│   ├── DEPLOY.md                ← 本文档
│   ├── nginx.conf               ← Nginx 配置
│   ├── ecosystem.config.js      ← PM2 配置
│   ├── setup.sh                 ← 一键部署脚本
│   └── .env.production.example  ← 环境变量模板
└── logs/                        ← PM2 日志
```

### B. 常用命令速查

| 操作       | 命令                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| 启动后端   | `pm2 start deploy/ecosystem.config.js`                                       |
| 停止后端   | `pm2 stop uht-backend`                                                       |
| 重启后端   | `pm2 restart uht-backend`                                                    |
| 查看状态   | `pm2 status`                                                                 |
| 查看日志   | `pm2 logs uht-backend`                                                       |
| 重新构建   | `npm run deploy:build`                                                       |
| 重载 Nginx | `sudo systemctl reload nginx`                                                |
| 数据库迁移 | `cd apps/backend && npx prisma migrate deploy --schema prisma/schema.prisma` |

### C. 一键部署（快速通道）

如果你希望跳过手动步骤，可以直接执行：

```bash
git clone -b main https://github.com/cuowuxuexi/Unified.Holdings.Tracker.git /opt/uht
cd /opt/uht
bash deploy/setup.sh
```

> ⚠️ 使用前需先编辑 `deploy/setup.sh`，将 `REPO_URL` 替换为你的仓库地址。

### D. HTTPS 配置（可选）

使用 Let's Encrypt 免费证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名.com
```

Certbot 会自动修改 Nginx 配置并设置证书自动续期。
