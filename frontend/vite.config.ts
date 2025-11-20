/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  base: './', // 确保在 file:// 协议下资源使用相对路径
  plugins: [react()],
  build: {
    // 将输出目录设置到 electron 目录下的 renderer 文件夹
    outDir: '../electron/renderer',
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
    port: 5173,
    strictPort: true, // 严格要求使用5173端口，不自动切换
    host: 'localhost',
    watch: {
      // 使用原生文件系统事件（推荐）
      usePolling: false,
    },
    // 如果端口被占用，显示明确错误而不是自动切换
    hmr: {
      port: 5173,
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
