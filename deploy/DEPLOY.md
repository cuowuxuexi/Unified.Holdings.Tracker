# UHT 云服务器部署说明书

> **Unified Holdings Tracker** — 投资组合追踪系统  
> 最后更新：2026-02-24

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

> **说明**：如果使用 Nginx 代理（推荐方案），`FRONTEND_URL` 的值不太重要，因为 CORS 在生产环境已设为 `true`。

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

SQLite 是单文件数据库，备份极其简单：

```bash
# 手动备份
cp /opt/uht/apps/backend/prisma/data/portfolio.db ~/backup/portfolio_$(date +%Y%m%d).db

# 定时备份（每天凌晨 3 点）
crontab -e
# 添加以下行：
# 0 3 * * * cp /opt/uht/apps/backend/prisma/data/portfolio.db /home/$USER/backup/portfolio_$(date +\%Y\%m\%d).db
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
