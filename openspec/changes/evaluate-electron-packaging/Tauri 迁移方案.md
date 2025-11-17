# Tauri 迁移方案

## 目标
- 在保留目前 Electron 评测结论与现有业务层（前端 React + 后端 Node/Prisma）不变的前提下，构建一套以 Tauri 为壳层的双轨桌面发行路径。
- 降低打包体积与运行时开销，强化对本地数据目录与资源权限的可控性。
- 通过灰度策略，让 Tauri 与 Electron 并行验证，最终评估是否完全切换。

## 核心策略
1. **新建 Tauri 工程**：在 `apps/desktop-tauri`（命名可调）中初始化 Tauri 项目，配置 `distDir` 指向 `frontend/dist`，保持前端构建产物一致。
2. **维持前端与后端**：前端继续构建为静态资源，后端通过 Node 进程（dist 目录）运行，Tauri 负责启动/停止与 IPC。
3. **统一数据与配置路径**：使用 Tauri `app_dir`/`config_dir` 作为用户数据根，Node 和 `DataService` 优先读取此目录，必要时提供 Electron 数据迁移脚本。
4. **打包与 CI 集成**：编写 Tauri bundle 脚本，覆盖 Windows/macOS/Linux，多平台打包在现有 pipeline 增加 `tauri:build` 步骤，并保留 Electron 工程用于回退。

## 迁移阶段
- **阶段 1（PoC）**：完成 Tauri 基础窗口、资源加载，验证前端静态资源无差异。
- **阶段 2（后端启动）**：Rust 侧使用 `Command::new("node")` 启动后端dist，增加健康检查、日志转发，确保崩溃可捕捉。
- **阶段 3（数据路径）**：同步 Prisma Client 的 `binaryTargets`、SQLite路径；实现从旧 Electron 数据目录迁移至 Tauri 指定目录。 
- **阶段 4（打包验证）**：配置 Tauri 的 `bundle.targets`，在多平台运行 `tauri build`，并与 Electron 打包产物做基本性能对比。
- **阶段 5（灰度）**：让小部分用户使用 Tauri 版本，收集日志、兼容性反馈后再决定是否彻底迁移。

## 风险与缓解
- **Rust/Tauri 学习曲线**：安排文档与 PoC，总结必要命令和调试技巧。
- **跨平台差异**：在 Windows/macOS/Linux 上执行冒烟测试，并记录最低系统要求。
- **Node 后端稳定性**：增加守护逻辑、日志、自动重启策略。
- **数据迁移失败**：封装迁移脚本，首次启动前先备份旧目录。

## 下一步建议
1. 基于此方案更新 `openspec/changes/migrate-electron-to-tauri/tasks.md` 与 spec delta（如 `specs/electron-packaging` 拓展 Tauri 要求）。
2. 运行 `openspec validate migrate-electron-to-tauri --strict` 以确认规范完整。
3. 启动灰度评估，保持 Electron 与 Tauri 双轨迭代。 
