/**
 * 资源复制脚本
 * 将构建产物复制到 electron 目录，为打包做准备
 *
 * 注意：前端已通过 vite 直接输出到 electron/renderer，无需复制
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'electron');

/**
 * 递归删除目录
 */
function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`源目录不存在: ${src}`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 复制单个文件
 */
function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`源文件不存在: ${src}`);
    process.exit(1);
  }

  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

async function main() {
  console.log('=== 开始复制资源到 electron 目录 ===\n');

  // 1. 清理后端和 Prisma 目录（不清理 renderer，因为 vite 已直接输出）
  console.log('1. 清理旧文件...');
  removeDir(path.join(electronDir, 'backend'));
  removeDir(path.join(electronDir, 'prisma'));
  console.log('   ✓ 清理完成\n');

  // 2. 检查前端构建产物（由 vite 直接输出到 electron/renderer）
  console.log('2. 检查前端构建产物...');
  const rendererDir = path.join(electronDir, 'renderer');
  const rendererIndex = path.join(rendererDir, 'index.html');

  if (!fs.existsSync(rendererIndex)) {
    console.error(`   ✗ 前端构建产物不存在: ${rendererDir}`);
    console.error('   请先运行: npm run build:frontend');
    process.exit(1);
  }
  console.log(`   ✓ 前端已构建到: ${rendererDir}\n`);

  // 3. 复制后端 bundle
  console.log('3. 复制后端 bundle...');
  const backendSrc = path.join(root, 'apps', 'backend', 'dist');
  const backendDest = path.join(electronDir, 'backend');

  if (!fs.existsSync(backendSrc)) {
    console.error(`   ✗ 后端构建产物不存在: ${backendSrc}`);
    console.error('   请先运行: npm run build:backend');
    process.exit(1);
  }

  copyDir(backendSrc, backendDest);
  console.log(`   ✓ 已复制到: ${backendDest}\n`);

  // 4. 复制 Prisma schema
  console.log('4. 复制 Prisma schema...');
  const prismaSrc = path.join(root, 'apps', 'backend', 'prisma', 'schema.prisma');
  const prismaDest = path.join(electronDir, 'prisma', 'schema.prisma');

  if (!fs.existsSync(prismaSrc)) {
    console.error(`   ✗ Prisma schema 不存在: ${prismaSrc}`);
    process.exit(1);
  }

  copyFile(prismaSrc, prismaDest);
  console.log(`   ✓ 已复制到: ${prismaDest}\n`);

  // 5. 复制 Prisma 生成的客户端（如果存在）
  console.log('5. 检查 Prisma Client...');
  const prismaClientSrc = path.join(root, 'node_modules', '.prisma');
  const prismaClientDest = path.join(electronDir, 'node_modules', '.prisma');

  if (fs.existsSync(prismaClientSrc)) {
    // 先清理目标目录
    removeDir(prismaClientDest);
    copyDir(prismaClientSrc, prismaClientDest);
    console.log(`   ✓ 已复制 Prisma Client\n`);
  } else {
    console.log('   ⚠ Prisma Client 未找到，打包时需要单独处理\n');
  }

  // 6. 验证复制结果
  console.log('6. 验证复制结果...');
  const checks = [
    { path: rendererIndex, name: 'renderer/index.html' },
    { path: path.join(backendDest, 'server-bundle.js'), name: 'backend/server-bundle.js' },
    { path: prismaDest, name: 'prisma/schema.prisma' },
  ];

  let allPassed = true;
  for (const check of checks) {
    if (fs.existsSync(check.path)) {
      console.log(`   ✓ ${check.name}`);
    } else {
      console.log(`   ✗ ${check.name} - 文件不存在`);
      allPassed = false;
    }
  }

  console.log('\n=== 资源复制完成 ===');

  if (!allPassed) {
    console.error('\n⚠ 部分文件缺失，请检查构建步骤');
    process.exit(1);
  }

  console.log('\n下一步: cd electron && npm run package');
}

main().catch((err) => {
  console.error('复制失败:', err);
  process.exit(1);
});
