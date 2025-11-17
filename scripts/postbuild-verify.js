#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('\n🔍 开始构建后验证...\n');

const requiredArtifacts = [
  {
    name: 'Domain 构建产物',
    path: 'packages/domain/dist/index.js',
    critical: true,
  },
  {
    name: 'Application 构建产物',
    path: 'packages/application/dist/index.js',
    critical: true,
  },
  {
    name: 'Infra 构建产物',
    path: 'packages/infra/dist/index.js',
    critical: true,
  },
  {
    name: 'Infra 缓存服务（新增）',
    path: 'packages/infra/dist/cache/period-cache-service.js',
    critical: true,
  },
  {
    name: 'Backend 构建产物',
    paths: [
      'apps/backend/dist/server.js',
      'apps/backend/dist/apps/backend/src/server.js',
    ],
    critical: true,
  },
  {
    name: 'Frontend 构建产物',
    path: 'electron/renderer/index.html',
    critical: true,
  },
  {
    name: 'Electron 构建产物',
    path: 'electron/dist/main.js',
    critical: true,
  },
  {
    name: 'Prisma Client',
    paths: [
      'apps/backend/node_modules/.prisma/client/index.js',
      'node_modules/.prisma/client/index.js',
    ],
    critical: true,
  },
  {
    name: 'Electron 图标（Windows）',
    path: 'electron/assets/icon.ico',
    critical: false,
  },
  {
    name: 'Electron 图标（macOS）',
    path: 'electron/assets/icon.icns',
    critical: false,
  },
];

let criticalFailed = false;
let warnings = 0;

requiredArtifacts.forEach(({ name, path: artifactPath, paths, critical }) => {
  const candidates = Array.isArray(paths) ? paths : [artifactPath];
  const exists = candidates.some((relativePath) => {
    if (!relativePath) {
      return false;
    }

    const fullPath = path.join(process.cwd(), relativePath);
    return fs.existsSync(fullPath);
  });

  if (!exists) {
    if (critical) {
      console.error(`❌ ${name} 缺失：${artifactPath}`);
      criticalFailed = true;
    } else {
      console.warn(`⚠️  ${name} 缺失：${artifactPath}`);
      warnings += 1;
    }
  } else {
    console.log(`✅ ${name}`);
  }
});

console.log('');

if (criticalFailed) {
  console.error('❌ 构建验证失败，关键文件缺失\n');
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`⚠️  构建完成，但有 ${warnings} 个警告\n`);
  process.exit(0);
} else {
  console.log('✅ 构建验证通过，所有产物齐全\n');
  process.exit(0);
}
