# Unified.Holdings.Tracker（UHT）本地说明

## 项目来源

- GitHub 仓库：`https://github.com/cuowuxuexi/Unified.Holdings.Tracker.git`
- 本地拉取目录：`项目/Unified.Holdings.Tracker/`
- 本目录由 `d:/aizhineng` 主工作区下的 `项目/` 子工作区统一管理。

## 用途

本地副本用于执行“世尊 UHT 修复”相关工作，当前主要用于落实 P0/P1：

- P0：修复快照日期与价格错位（按 `snapshotDate` 回填 K 线收盘价）
- P1：修复新增资产时 `Asset.name = code` 的脏数据来源

## 与修复方案文档的关系

本目录是以下执行文档对应的源码落点：

- `机器人/世尊/UHT修复方案.md`

执行修复时，应以该方案文档为准，按其中“前置条件 -> 修改点 -> 验证 -> 回滚”顺序落地。

## 后续修复入口文件提示

按当前方案文档，P0/P1 重点入口如下：

1. `apps/backend/src/services/snapshotService.ts`（P0 主入口，快照修复逻辑）
2. `packages/infra/src/storage/storage.prisma.ts`（P1 资产初始化相关逻辑）
3. `apps/backend/` 内“新增交易成功后异步补全资产名称”的实际入口文件（待在代码中最终确认）

## 说明

- 本任务仅完成“拉仓 + 说明接入”，不在本步骤修改 UHT 业务代码。
- 如后续开始 P0/P1 实施，需先确认目标分支、构建与部署链路，再进入代码修复阶段。
