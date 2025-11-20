const esbuild = require('esbuild');
const path = require('path');

console.log('🧹 Building backend bundle with esbuild...');

esbuild.build({
  entryPoints: [path.join(__dirname, 'src/server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(__dirname, 'dist/server-bundle.js'),
  external: ['electron', '@prisma/client', 'sharp'], // Exclude native modules and electron
  sourcemap: true,
  minify: true,
  logLevel: 'info',
}).then(() => {
  console.log('✅ Backend bundle built successfully: dist/server-bundle.js');
}).catch((e) => {
  console.error('❌ Build failed:', e);
  process.exit(1);
});

