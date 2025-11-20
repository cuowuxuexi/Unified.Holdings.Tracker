#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('\n🔍 开始构建后验证...\n');

const requiredArtifacts = [
  {
    name: 'Domain 构建产物',
    path: 'packages/domain/dist/index.js',
    critical: true,
    minSize: 100, // 至少 100 bytes
  },
  {
    name: 'Application 构建产物',
    path: 'packages/application/dist/index.js',
    critical: true,
    minSize: 100,
  },
  {
    name: 'Infra 构建产物',
    path: 'packages/infra/dist/index.js',
    critical: true,
    minSize: 100,
  },
  {
    name: 'Infra 缓存服务（新增）',
    path: 'packages/infra/dist/cache/period-cache-service.js',
    critical: true,
    minSize: 100,
  },
  {
    name: 'Backend 构建产物',
    path: 'apps/backend/dist/server-bundle.js',
    critical: true,
    minSize: 1024 * 1024, // 至少 1 MB（正常应该 3MB+）
  },
  {
    name: 'Frontend 构建产物',
    path: 'electron/renderer/index.html',
    critical: true,
    minSize: 500, // 至少 500 bytes
  },
  {
    name: 'Electron 构建产物',
    path: 'electron/dist/main.js',
    critical: true,
    minSize: 1024 * 10, // 至少 10 KB
  },
  {
    name: 'Prisma Client',
    paths: [
      'apps/backend/node_modules/.prisma/client/index.js',
      'node_modules/.prisma/client/index.js',
    ],
    critical: true,
    minSize: 100,
  },
  {
    name: 'Electron 图标（Windows）',
    path: 'electron/assets/icon.ico',
    critical: false,
    minSize: 1024, // 至少 1 KB
  },
  {
    name: 'Electron 图标（macOS）',
    path: 'electron/assets/icon.icns',
    critical: false,
    minSize: 1024,
  },
];

let criticalFailed = false;
let warnings = 0;

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

requiredArtifacts.forEach(({ name, path: artifactPath, paths, critical, minSize }) => {
  const candidates = Array.isArray(paths) ? paths : [artifactPath];

  let foundPath = null;
  let fileSize = 0;

  for (const relativePath of candidates) {
    if (!relativePath) continue;

    const fullPath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(fullPath)) {
      foundPath = fullPath;
      const stats = fs.statSync(fullPath);
      fileSize = stats.size;
      break;
    }
  }

  if (!foundPath) {
    // 文件不存在
    if (critical) {
      console.error(`❌ ${name} 缺失：${artifactPath}`);
      criticalFailed = true;
    } else {
      console.warn(`⚠️  ${name} 缺失：${artifactPath}`);
      warnings += 1;
    }
  } else if (minSize && fileSize < minSize) {
    // 文件存在但大小异常
    if (critical) {
      console.error(`❌ ${name} 文件过小：${formatSize(fileSize)} (最小要求: ${formatSize(minSize)})`);
      criticalFailed = true;
    } else {
      console.warn(`⚠️  ${name} 文件过小：${formatSize(fileSize)} (最小要求: ${formatSize(minSize)})`);
      warnings += 1;
    }
  } else {
    // 文件正常
    console.log(`✅ ${name} (${formatSize(fileSize)})`);
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
