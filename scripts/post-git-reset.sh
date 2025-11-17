#!/bin/bash

# ============================================
# Git 回退后环境恢复脚本
# ============================================
# 用途：在使用 git reset, git checkout 等命令回退代码后，
#      自动恢复项目运行环境（依赖、数据库、构建产物等）
#
# 使用方法：
#   chmod +x scripts/post-git-reset.sh
#   ./scripts/post-git-reset.sh
#
# 或者直接：
#   bash scripts/post-git-reset.sh
# ============================================

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Git 回退后环境恢复脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ 错误：请在项目根目录下运行此脚本${NC}"
  exit 1
fi

# ============================================
# 1. 停止运行中的进程
# ============================================
echo -e "${YELLOW}🛑 步骤 1/8: 检查运行中的 Node 进程...${NC}"

if command -v lsof &> /dev/null; then
  BACKEND_PID=$(lsof -ti:3001 || true)
  FRONTEND_PID=$(lsof -ti:5173 || true)

  if [ -n "$BACKEND_PID" ]; then
    echo -e "  ${YELLOW}⚠️ 发现后端进程 (PID: $BACKEND_PID)，正在停止...${NC}"
    kill -9 $BACKEND_PID 2>/dev/null || true
    echo -e "  ${GREEN}✓ 后端进程已停止${NC}"
  fi

  if [ -n "$FRONTEND_PID" ]; then
    echo -e "  ${YELLOW}⚠️ 发现前端进程 (PID: $FRONTEND_PID)，正在停止...${NC}"
    kill -9 $FRONTEND_PID 2>/dev/null || true
    echo -e "  ${GREEN}✓ 前端进程已停止${NC}"
  fi
else
  echo -e "  ${YELLOW}⚠️ 无法检查端口占用（lsof 不可用），请手动停止所有 Node 进程${NC}"
fi

# ============================================
# 2. 清理不一致的构建产物和缓存
# ============================================
echo ""
echo -e "${YELLOW}📦 步骤 2/8: 清理旧的构建产物和缓存...${NC}"

# 清理 Prisma Client
if [ -d "node_modules/.prisma" ]; then
  rm -rf node_modules/.prisma
  echo -e "  ${GREEN}✓ 清理了根目录 Prisma Client${NC}"
fi

if [ -d "apps/backend/node_modules/.prisma" ]; then
  rm -rf apps/backend/node_modules/.prisma
  echo -e "  ${GREEN}✓ 清理了 backend Prisma Client${NC}"
fi

# 清理构建产物
BUILD_DIRS=(
  "apps/backend/dist"
  "frontend/dist"
  "electron/renderer"
  "electron/main"
  "packages/*/dist"
)

for dir in "${BUILD_DIRS[@]}"; do
  if [ -d "$dir" ] || compgen -G "$dir" > /dev/null 2>&1; then
    rm -rf $dir
    echo -e "  ${GREEN}✓ 清理了 $dir${NC}"
  fi
done

# 清理 TypeScript 编译缓存
find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
echo -e "  ${GREEN}✓ 清理了 TypeScript 编译缓存${NC}"

# ============================================
# 3. 重新安装依赖
# ============================================
echo ""
echo -e "${YELLOW}📥 步骤 3/8: 重新安装依赖...${NC}"
echo -e "  ${BLUE}这可能需要几分钟时间，请耐心等待...${NC}"

npm install

if [ $? -eq 0 ]; then
  echo -e "  ${GREEN}✓ 依赖安装完成${NC}"
else
  echo -e "  ${RED}❌ 依赖安装失败，请检查错误信息${NC}"
  exit 1
fi

# ============================================
# 4. 生成 Prisma Client
# ============================================
echo ""
echo -e "${YELLOW}🔧 步骤 4/8: 生成 Prisma Client...${NC}"

cd apps/backend
npx prisma generate --schema prisma/schema.prisma

if [ $? -eq 0 ]; then
  echo -e "  ${GREEN}✓ Prisma Client 已生成${NC}"
else
  echo -e "  ${RED}❌ Prisma Client 生成失败${NC}"
  cd ../..
  exit 1
fi

cd ../..

# ============================================
# 5. 检查并同步数据库
# ============================================
echo ""
echo -e "${YELLOW}🗃️ 步骤 5/8: 检查数据库状态...${NC}"

# 检查数据库文件是否存在
if [ -f "apps/backend/prisma/data/portfolio.db" ]; then
  echo -e "  ${GREEN}✓ 数据库文件存在${NC}"

  # 检查是否有 migrations 目录
  if [ -d "apps/backend/prisma/migrations" ] && [ -n "$(ls -A apps/backend/prisma/migrations 2>/dev/null)" ]; then
    echo -e "  ${BLUE}ℹ️ 发现 Prisma Migrations，尝试应用迁移...${NC}"
    cd apps/backend
    npx prisma migrate deploy --schema prisma/schema.prisma 2>/dev/null || {
      echo -e "  ${YELLOW}⚠️ 迁移应用失败，尝试使用 db push 同步...${NC}"
      npx prisma db push --schema prisma/schema.prisma --accept-data-loss
    }
    cd ../..
  else
    echo -e "  ${YELLOW}⚠️ 未发现 Prisma Migrations，使用 db push 同步数据库...${NC}"
    cd apps/backend
    npx prisma db push --schema prisma/schema.prisma --accept-data-loss
    cd ../..
  fi

  echo -e "  ${GREEN}✓ 数据库已同步到最新 Schema${NC}"
else
  echo -e "  ${YELLOW}⚠️ 数据库文件不存在，正在初始化...${NC}"

  # 确保数据目录存在
  mkdir -p apps/backend/prisma/data

  cd apps/backend
  npx prisma db push --schema prisma/schema.prisma
  cd ../..

  echo -e "  ${GREEN}✓ 数据库已初始化${NC}"
fi

# ============================================
# 6. 恢复配置文件
# ============================================
echo ""
echo -e "${YELLOW}📄 步骤 6/8: 检查配置文件...${NC}"

# 后端环境变量
if [ ! -f "apps/backend/.env" ]; then
  if [ -f "apps/backend/.env.example" ]; then
    cp apps/backend/.env.example apps/backend/.env
    echo -e "  ${GREEN}✓ 已从示例创建 apps/backend/.env${NC}"
    echo -e "  ${YELLOW}⚠️ 请检查 apps/backend/.env 中的配置是否正确${NC}"
  else
    echo -e "  ${YELLOW}⚠️ 未找到 .env.example，请手动创建 apps/backend/.env${NC}"
  fi
else
  echo -e "  ${GREEN}✓ apps/backend/.env 已存在${NC}"
fi

# 前端环境变量
if [ ! -f "frontend/.env" ]; then
  if [ -f "frontend/.env.example" ]; then
    cp frontend/.env.example frontend/.env
    echo -e "  ${GREEN}✓ 已从示例创建 frontend/.env${NC}"
  else
    echo -e "  ${YELLOW}⚠️ 未找到 .env.example，前端将使用默认配置${NC}"
  fi
else
  echo -e "  ${GREEN}✓ frontend/.env 已存在${NC}"
fi

# ============================================
# 7. 重新构建项目
# ============================================
echo ""
echo -e "${YELLOW}🏗️ 步骤 7/8: 重新构建项目...${NC}"

# 构建后端
echo -e "  ${BLUE}构建后端...${NC}"
npm run build -w backend

if [ $? -eq 0 ]; then
  echo -e "  ${GREEN}✓ 后端构建完成${NC}"
else
  echo -e "  ${RED}❌ 后端构建失败${NC}"
  exit 1
fi

# 构建前端
echo -e "  ${BLUE}构建前端...${NC}"
npm run build -w frontend

if [ $? -eq 0 ]; then
  echo -e "  ${GREEN}✓ 前端构建完成${NC}"
else
  echo -e "  ${RED}❌ 前端构建失败${NC}"
  exit 1
fi

# ============================================
# 8. 完成
# ============================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ 环境恢复完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}接下来你可以：${NC}"
echo -e "  1. 运行 ${YELLOW}npm run dev:backend${NC} 启动后端服务"
echo -e "  2. 运行 ${YELLOW}npm run dev:frontend${NC} 启动前端服务（新终端）"
echo -e "  3. 或运行 ${YELLOW}npm run dev${NC} 同时启动（如果已配置）"
echo ""
echo -e "${BLUE}💡 提示：${NC}"
echo -e "  - 如果遇到问题，请查看 ${YELLOW}docs/修复数据库问题.md${NC}"
echo -e "  - 数据库位置：${YELLOW}apps/backend/prisma/data/portfolio.db${NC}"
echo ""
