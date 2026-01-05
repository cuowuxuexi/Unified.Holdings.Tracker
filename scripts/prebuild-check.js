#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('🔍 开始构建前检查...\n');

const checks = [
  {
    name: 'Node.js 版本',
    check: () => {
      const version = process.version;
      const major = parseInt(version.slice(1).split('.')[0], 10);
      if (Number.isNaN(major) || major < 18) {
        throw new Error(`需要 Node.js 18+，当前版本：${version}`);
      }
      console.log(`✅ Node.js 版本：${version}`);
    },
  },
  {
    name: 'npm 依赖安装',
    check: () => {
      const hasNodeModules = fs.existsSync(path.join(process.cwd(), 'node_modules'));
      if (!hasNodeModules) {
        throw new Error('node_modules 不存在，请运行 npm install');
      }
      console.log('✅ npm 依赖已安装');
    },
  },
  {
    name: 'Prisma schema',
    check: () => {
      const schemaPath = path.join(process.cwd(), 'apps/backend/prisma/schema.prisma');
      if (!fs.existsSync(schemaPath)) {
        throw new Error('Prisma schema 文件不存在');
      }
      console.log('✅ Prisma schema 存在');
    },
  },
  {
    name: 'TypeScript 配置',
    check: () => {
      const configs = [
        'tsconfig.base.json',
        'packages/domain/tsconfig.json',
        'packages/application/tsconfig.json',
        'packages/infra/tsconfig.json',
        'apps/backend/tsconfig.json',
        'frontend/tsconfig.json',
        'electron/tsconfig.json',
      ];

      configs.forEach((config) => {
        const configPath = path.join(process.cwd(), config);
        if (!fs.existsSync(configPath)) {
          throw new Error(`TypeScript 配置缺失：${config}`);
        }
      });

      console.log('✅ TypeScript 配置完整');
    },
  },
];

let failed = false;

checks.forEach(({ name, check }) => {
  try {
    check();
  } catch (error) {
    console.error(`❌ ${name} 检查失败：${error.message}`);
    failed = true;
  }
});

if (failed) {
  console.error('\n❌ 构建前检查失败，请修复上述问题后重试\n');
  process.exit(1);
} else {
  console.log('\n✅ 所有检查通过，开始构建...\n');
  process.exit(0);
}
