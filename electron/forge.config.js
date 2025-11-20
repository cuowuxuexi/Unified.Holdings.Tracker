const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon', // 指定应用图标 (Forge 会自动选择 .ico/.icns)
    name: "Portfolio Tool", // 应用名称 (显示在标题栏等)
    executableName: "PortfolioTool", // Windows 下的可执行文件名
    extraResource: [] // We use hooks instead for dynamic copying
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel', // Windows (NSIS 替代品)
      config: {
        name: 'PortfolioTool', // 安装程序的名称
        setupIcon: './assets/icon.ico' // 安装程序的图标
      },
    },
    {
      name: '@electron-forge/maker-zip', // macOS 和 Linux
      platforms: ['darwin', 'linux'], // 为 Zip 包指定目标平台
    },
    // 移除了 maker-deb 和 maker-rpm 以简化配置，与文档保持一致
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      console.log('📦 [Hook] Copying backend resources...');
      console.log(`  Build Path: ${buildPath}`);
      
      // buildPath is the directory containing the app source (which will be asared)
      // e.g. .../resources/app/
      // We want to put files in .../resources/backend/
      // So we go up one level from buildPath to get the 'resources' directory
      let resourcesDir = path.resolve(buildPath, '..');

      console.log(`  Target resources directory: ${resourcesDir}`);
      
      const backendDestDir = path.join(resourcesDir, 'backend');
      
      // Ensure backend dir exists
      if (!fs.existsSync(backendDestDir)) {
        fs.mkdirSync(backendDestDir, { recursive: true });
      }
      
      // 1. Copy server bundle
      const backendSrc = path.join(__dirname, '../apps/backend/dist/server-bundle.js');
      if (fs.existsSync(backendSrc)) {
         fs.copyFileSync(backendSrc, path.join(backendDestDir, 'server-bundle.js'));
         console.log('  ✅ Copied server-bundle.js');
      } else {
         console.error('  ❌ server-bundle.js not found at:', backendSrc);
         throw new Error('Backend bundle not found. Did you run npm run build?');
      }
      
      // 2. Copy Prisma Engine (跨平台支持)
      const prismaClientDir = path.join(__dirname, '../node_modules/.prisma/client');

      // 平台引擎映射表
      const engineMapping = {
        'win32': 'query_engine-windows.dll.node',
        'darwin': {
          'arm64': 'libquery_engine-darwin-arm64.dylib.node',
          'x64': 'libquery_engine-darwin.dylib.node'
        },
        'linux': 'libquery_engine-debian-openssl-3.0.x.so.node'
      };

      // 根据平台和架构确定引擎名称
      let engineName;
      if (platform === 'darwin' && typeof engineMapping.darwin === 'object') {
        engineName = engineMapping.darwin[arch] || engineMapping.darwin.x64;
      } else {
        engineName = engineMapping[platform];
      }

      if (!engineName) {
        console.warn(`  ⚠️ Unsupported platform: ${platform}-${arch}`);
        return;
      }

      const engineSrc = path.join(prismaClientDir, engineName);
      if (fs.existsSync(engineSrc)) {
        fs.copyFileSync(engineSrc, path.join(backendDestDir, engineName));
        console.log(`  ✅ Copied Prisma Engine (${engineName})`);
      } else {
        console.error(`  ❌ Prisma Engine not found: ${engineSrc}`);
        // 列出可用引擎，便于调试
        try {
          const availableEngines = fs.readdirSync(prismaClientDir).filter(f => f.includes('query_engine'));
          console.error(`  Available engines: ${availableEngines.join(', ')}`);
        } catch (e) {
          console.error(`  Failed to list available engines: ${e.message}`);
        }
        throw new Error(`Prisma Engine for ${platform}-${arch} not found`);
      }

      // 3. Copy Schema
      const schemaSrc = path.join(__dirname, '../apps/backend/prisma/schema.prisma');
      if (fs.existsSync(schemaSrc)) {
        fs.copyFileSync(schemaSrc, path.join(backendDestDir, 'schema.prisma'));
        console.log('  ✅ Copied schema.prisma');
      } else {
         console.error('  ❌ schema.prisma not found at:', schemaSrc);
      }

      // 4. Copy Prisma Client node_modules
      // 后端bundle将@prisma/client标记为external，需要在打包时提供这些模块
      const nodeModulesInBackend = path.join(backendDestDir, 'node_modules');

      // 4.1 复制 @prisma/client
      const prismaClientSrc = path.join(__dirname, '../node_modules/@prisma/client');
      const prismaClientDest = path.join(nodeModulesInBackend, '@prisma', 'client');
      if (fs.existsSync(prismaClientSrc)) {
        fs.mkdirSync(path.dirname(prismaClientDest), { recursive: true });
        copyDirectory(prismaClientSrc, prismaClientDest);
        console.log('  ✅ Copied @prisma/client');
      } else {
        console.error('  ❌ @prisma/client not found at:', prismaClientSrc);
        throw new Error('@prisma/client not found');
      }

      // 4.2 复制 .prisma/client
      const dotPrismaClientSrc = path.join(__dirname, '../node_modules/.prisma/client');
      const dotPrismaClientDest = path.join(nodeModulesInBackend, '.prisma', 'client');
      if (fs.existsSync(dotPrismaClientSrc)) {
        fs.mkdirSync(path.dirname(dotPrismaClientDest), { recursive: true });
        copyDirectory(dotPrismaClientSrc, dotPrismaClientDest);
        console.log('  ✅ Copied .prisma/client');
      } else {
        console.error('  ❌ .prisma/client not found at:', dotPrismaClientSrc);
        throw new Error('.prisma/client not found');
      }
    }
  }
};

// Helper function to recursively copy directories
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
