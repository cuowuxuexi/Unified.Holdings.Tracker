const esbuild = require('esbuild');
const path = require('path');

console.log('🧹 Building backend bundles with esbuild...');

const commonBuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: ['electron', '@prisma/client', 'sharp'], // Exclude native modules and electron
  sourcemap: true,
  minify: true,
  logLevel: 'info',
};

Promise.all([
  esbuild.build({
    ...commonBuildOptions,
    entryPoints: [path.join(__dirname, 'src/server.ts')],
    outfile: path.join(__dirname, 'dist/server-bundle.js'),
  }),
  esbuild.build({
    ...commonBuildOptions,
    entryPoints: [path.join(__dirname, 'src/scripts/backfillSourceData.ts')],
    outfile: path.join(__dirname, 'dist/backfill-source-data.js'),
  }),
])
  .then(() => {
    console.log(
      '✅ Backend bundles built successfully: dist/server-bundle.js, dist/backfill-source-data.js'
    );
  })
  .catch((e) => {
    console.error('❌ Build failed:', e);
    process.exit(1);
  });
