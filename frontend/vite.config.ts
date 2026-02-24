/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isElectronBuild = process.env.BUILD_TARGET === 'electron';
const DEFAULT_PORT = 5173;
const parsedPort = Number(process.env.VITE_PORT ?? process.env.PORT);
const devServerPort =
  Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;

// https://vite.dev/config/
export default defineConfig({
  base: isElectronBuild ? './' : '/',
  plugins: [react()],
  build: {
    outDir: isElectronBuild ? '../electron/renderer' : 'dist',
    emptyOutDir: true, // 确保每次构建前清空目录
    // Rollup 选项
    rollupOptions: {
      output: {
        // 手动代码分割，减少主 bundle 体积
        manualChunks: {
          // React 核心库
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Ant Design UI 库 - 进一步细分
          'vendor-antd-core': ['antd'],
          'vendor-antd-icons': ['@ant-design/icons'],
          // 数据查询库
          'vendor-query': ['@tanstack/react-query'],
          // 图表库（已按需加载，但仍单独分割）
          'vendor-chart': ['echarts', 'echarts-for-react'],
          // 工具库
          'vendor-utils': ['dayjs', 'lodash', 'zod'],
        },
      },
    },
    // 优化选项
    minify: 'terser', // 使用 terser 进行更激进的压缩
    terserOptions: {
      compress: {
        drop_console: true, // 生产环境移除 console
        drop_debugger: true,
      },
    },
  },
  // 开发服务器配置
  server: {
    port: devServerPort,
    // 端口占用时自动切换，避免因 5173 被占用导致启动失败
    strictPort: false,
    host: true,
    watch: {
      // 使用原生文件系统事件（推荐）
      usePolling: false,
    },
  },
  // 依赖优化配置
  optimizeDeps: {
    // 强制预构建这些依赖
    include: [
      'react',
      'react-dom',
      'antd',
      'dayjs',
      'lodash',
      'echarts',
      'echarts-for-react',
    ],
    // 开发模式下强制重新构建（解决缓存问题）
    force: process.env.NODE_ENV === 'development',
  },
  // 缓存目录配置
  cacheDir: 'node_modules/.vite',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts', // Optional: if we need global setup later
  },
});
