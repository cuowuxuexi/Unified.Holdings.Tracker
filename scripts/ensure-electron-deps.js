const fs = require('fs');
const path = require('path');

// 将 electron 运行时依赖从根 node_modules 复制到 electron/node_modules，
// 避免 electron-forge 打包时找不到 hoist 的依赖。
const repoRoot = path.resolve(__dirname, '..');
const electronDir = path.join(repoRoot, 'electron');
const electronNodeModules = path.join(electronDir, 'node_modules');
const rootNodeModules = path.join(repoRoot, 'node_modules');
const packageJsonPath = path.join(electronDir, 'package.json');

if (!fs.existsSync(packageJsonPath)) {
  console.error('未找到 electron/package.json，无法校验依赖。');
  process.exit(1);
}

if (!fs.existsSync(rootNodeModules)) {
  console.error('未找到根目录 node_modules，请先在仓库根目录执行 npm install。');
  process.exit(1);
}

const { dependencies = {} } = require(packageJsonPath);
const runtimeDeps = Object.keys(dependencies);

if (runtimeDeps.length === 0) {
  console.log('electron 子包未声明 runtime dependencies，跳过校验。');
  process.exit(0);
}

fs.mkdirSync(electronNodeModules, { recursive: true });

const readVersion = (modulePath) => {
  try {
    const pkgJson = require(path.join(modulePath, 'package.json'));
    return pkgJson.version || null;
  } catch {
    return null;
  }
};

const copiedDeps = [];
const missingAtRoot = [];

for (const dep of runtimeDeps) {
  const depSegments = dep.split('/');
  const sourceDir = path.join(rootNodeModules, ...depSegments);
  const targetDir = path.join(electronNodeModules, ...depSegments);

  if (!fs.existsSync(sourceDir)) {
    missingAtRoot.push(dep);
    continue;
  }

  const sourceVersion = readVersion(sourceDir);
  const targetVersion = readVersion(targetDir);

  if (sourceVersion && targetVersion && sourceVersion === targetVersion) {
    continue;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  copiedDeps.push(dep);
}

if (missingAtRoot.length > 0) {
  console.error(`根目录 node_modules 中缺少以下依赖: ${missingAtRoot.join(', ')}`);
  console.error('请先运行 npm install，再重新执行 ensure:electron-deps。');
  process.exit(1);
}

if (copiedDeps.length === 0) {
  console.log('electron 子包的 runtime 依赖版本已同步，无需复制。');
} else {
  console.log(`已同步 electron runtime 依赖: ${copiedDeps.join(', ')}`);
}
