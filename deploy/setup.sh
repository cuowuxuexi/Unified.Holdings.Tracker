#!/bin/bash
# UHT 云服务器一键部署脚本
# 用法: bash deploy/setup.sh
set -e

APP_DIR="/opt/uht"
REPO_URL="你的仓库地址"  # 替换为实际 Git 仓库地址

echo "========== UHT 部署开始 =========="

# 1. 系统依赖
echo ">>> 安装系统依赖..."
sudo apt update
sudo apt install -y curl git nginx

# 2. 安装 Node.js 18+
if ! command -v node &> /dev/null; then
    echo ">>> 安装 Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js 版本: $(node -v)"

# 3. 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo ">>> 安装 PM2..."
    sudo npm install -g pm2
fi

# 4. 克隆/更新代码
if [ -d "$APP_DIR" ]; then
    echo ">>> 更新代码..."
    cd "$APP_DIR"
    git pull
else
    echo ">>> 克隆代码..."
    sudo mkdir -p "$APP_DIR"
    sudo chown $USER:$USER "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# 5. 安装依赖
echo ">>> 安装项目依赖..."
npm install

# 6. 创建生产环境配置
if [ ! -f "$APP_DIR/apps/backend/.env" ]; then
    echo ">>> 创建后端环境配置..."
    cat > "$APP_DIR/apps/backend/.env" << 'EOF'
NODE_ENV=production
PORT=3001
FRONTEND_URL=http://localhost
DATABASE_URL="file:./prisma/data/portfolio.db"
API_BASE_PATH=/api
EOF
fi

# 7. 构建项目
echo ">>> 构建项目..."
npm run deploy:build

# 8. 确保数据库目录存在
mkdir -p "$APP_DIR/apps/backend/prisma/data"

# 9. 运行数据库迁移
echo ">>> 运行数据库迁移..."
cd "$APP_DIR/apps/backend"
npx prisma migrate deploy --schema prisma/schema.prisma
cd "$APP_DIR"

# 10. 配置 Nginx
echo ">>> 配置 Nginx..."
sudo cp deploy/nginx.conf /etc/nginx/sites-available/uht
sudo ln -sf /etc/nginx/sites-available/uht /etc/nginx/sites-enabled/uht
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 11. 创建日志目录
mkdir -p "$APP_DIR/logs"

# 12. 启动后端服务
echo ">>> 启动后端服务..."
pm2 start deploy/ecosystem.config.js
pm2 save

# 13. 设置开机自启
echo ">>> 设置开机自启..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
pm2 save

echo ""
echo "========== 部署完成！ =========="
echo "前端: http://$(hostname -I | awk '{print $1}')"
echo "后端: http://$(hostname -I | awk '{print $1}')/api/health"
echo ""
echo "常用命令:"
echo "  pm2 status          # 查看后端运行状态"
echo "  pm2 logs uht-backend  # 查看后端日志"
echo "  pm2 restart uht-backend  # 重启后端"
