/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './', // 确保在 file:// 协议下资源使用相对路径
  plugins: [react()],
  build: {
    // 将输出目录设置到 electron 目录下的 renderer 文件夹
    outDir: '../electron/renderer',
    emptyOutDir: true, // 确保每次构建前清空目录
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts', // Optional: if we need global setup later
  },
})
