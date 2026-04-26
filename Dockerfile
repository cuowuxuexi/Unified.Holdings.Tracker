# ============================================
# Unified Holdings Tracker - Docker Build
# Multi-stage: build frontend & backend, then run
# ============================================

# ---------- Stage 1: Install & Build ----------
FROM node:22-slim AS builder

WORKDIR /app

# Install build essentials for native modules
RUN sed -i 's#http://deb.debian.org/debian-security#http://mirrors.ustc.edu.cn/debian-security#g' /etc/apt/sources.list.d/debian.sources \
    && sed -i 's#http://deb.debian.org/debian#http://mirrors.ustc.edu.cn/debian#g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (better layer caching)
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY frontend/package.json frontend/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/infra/package.json packages/infra/

# Install all dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY apps/backend/ apps/backend/
COPY frontend/ frontend/
COPY packages/ packages/
COPY tsconfig.base.json ./

# Generate Prisma Client (for linux)
RUN cd apps/backend && npx prisma generate --schema prisma/schema.prisma

# Build backend bundle
RUN cd apps/backend && node build.js

# Build frontend (no API URL = uses relative /api, perfect for nginx proxy)
RUN cd frontend && npx tsc -b && npx vite build


# ---------- Stage 2: Backend Runtime ----------
FROM node:22-slim AS backend

WORKDIR /app

RUN sed -i 's#http://deb.debian.org/debian-security#http://mirrors.ustc.edu.cn/debian-security#g' /etc/apt/sources.list.d/debian.sources \
    && sed -i 's#http://deb.debian.org/debian#http://mirrors.ustc.edu.cn/debian#g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy only what's needed to run
COPY --from=builder /app/apps/backend/dist/server-bundle.js* ./dist/
COPY --from=builder /app/apps/backend/dist/backfill-source-data.js* ./dist/
COPY --from=builder /app/apps/backend/prisma/schema.prisma ./prisma/
COPY --from=builder /app/node_modules/@prisma/ ./node_modules/@prisma/
COPY --from=builder /app/node_modules/.prisma/ ./node_modules/.prisma/
COPY --from=builder /app/node_modules/dotenv/ ./node_modules/dotenv/

# Create data directory for SQLite volume mount
RUN mkdir -p prisma/data

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=file:./prisma/data/portfolio.db
ENV API_BASE_PATH=/api

EXPOSE 3001

CMD ["node", "dist/server-bundle.js"]


# ---------- Stage 3: Nginx (frontend + reverse proxy) ----------
FROM nginx:alpine AS nginx

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf

# Copy frontend build output
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
