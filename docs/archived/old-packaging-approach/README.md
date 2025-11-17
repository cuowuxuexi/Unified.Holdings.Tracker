# 旧 Electron 打包方案（已废弃）

## 归档时间
2025-11-17

## 方案说明
该目录包含旧的 Electron 打包方案相关文件：
- launcher/ - 应用启动器（用于启动独立后端 exe + Electron 前端）
- setup.iss - Inno Setup 安装脚本

## 废弃原因
1. 依赖独立的后端 exe（portfolio-backend.exe），但该产物不再构建
2. 架构复杂，维护成本高
3. 已被 Electron Forge + 内嵌后端方案替代

## 当前方案
使用 Electron Forge 打包，后端作为 Node.js 模块直接运行在 Electron 主进程中。

详见：
- 打包指南：`../../打包.md`
- Forge 配置：`../../electron/forge.config.js`
- OpenSpec 提案：`../../openspec/changes/evaluate-electron-packaging/`

## 保留原因
作为历史参考，供未来需要独立后端部署时参考。
