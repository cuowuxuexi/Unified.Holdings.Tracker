# Proposal: 首页 Hero 分区升级

## Change ID

`update-home-hero`

## Summary

参考 Claude 官方首页，将 Portfolio 列表页顶部改造成左右分栏 Hero：左侧聚焦价值叙事与"创建投资组合"操作，右侧展示现有插画 `Generated Image November 11, 2025 - 5_03PM.png`。通过更精致的文案、布局与色彩体系，营造 Stage 3 要求的品质感，同时保留原有投资组合列表功能。

## Why Now

- Stage 3 文档要求桌面端达到「对外展示」标准，现有首页仍是功能面板，缺少营销化入口。
- 用户反馈创建投资组合按钮偏隐蔽，希望打开应用即能看到价值主张与创建流程。
- 设计风格需对齐 Claude 等高端产品，以统一公司品牌形象。

## Goals

1. 左侧 Hero 列出主标题、副标语、价值要点以及嵌入式创建表单，支持跳转到完整创建弹窗。
2. 右侧固定展示本地插画资源，保持与 Claude 类似的留白、圆角与阴影处理。
3. Hero 之后的组合列表支持多列栅格呈现，视觉宽度与新布局一致。
4. 响应式断点：≤1024px 改为纵向堆叠，≤640px 隐藏次要装饰元素，确保移动端可用。

## Non-goals

- 不改变 `PortfolioDetailPage`、投资组合 API 或数据结构。
- 不引入新主题系统或设计令牌，只在页面内自定义样式。
- 不在本次迭代处理国际化或 A/B 测试。

## User Impact

- 新用户进入应用即可理解价值主张并立即创建组合，减少探索成本。
- 视觉一致性提升，有助于在 Stage 3 评审中展示最终形态。
- 多列布局让已有组合利用更多屏幕空间，减少滚动。

## Implementation Notes

### 前端结构

- `PortfolioListPage.tsx` 顶部新增 `HeroSection` 容器，`display:flex` + `gap:48px`。
- Hero 左列包含 `Typography.Title` + 副标题、价值要点列表、嵌入式 `HeroCreateCard`（复用 `useCreatePortfolio`）。
- 右列引用静态资源 `heroImage`（由 `Generated Image...png` 复制至 `frontend/src/assets/home-hero.png`），`img` 设置 `border-radius:28px`、`object-fit:cover`。
- 原 `CreatePortfolioForm` 弹窗改为“高级设置”入口，由 Hero 内链接/按钮触发原 Modal 以填写融资信息。

### 样式策略

- 新建 `PortfolioListPage.module.css`（或同等 CSS Module）定义 Hero、Tag、Grid 样式；`background:#fdf9f3`，按钮采用黑底白字。
- Portfolio 列表外层容器改为 `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`，保持卡片在大屏上自动铺满。
- 响应式：<1024px Hero 改为 column；<640px 隐藏 Tag 条并将表单字段堆叠。

### 交互

- Hero 表单提交后调用同一 mutation，成功后刷新列表并保留成功提示。
- “高级设置”按钮只在需要填写融资信息时打开 Modal，避免重复校验逻辑。
- 图片添加 `loading="lazy"` 与 `alt="投资组合插画"`。

## Risks & Mitigations

- **样式污染**：使用 CSS Modules 并以 `hero-` 命名，避免影响其他页面。
- **表单重复校验**：Hero 内仅保留必填字段，其余依旧在 Modal；逻辑复用现有 hook。
- **大图加载**：静态资源打包在前端，配合懒加载和合适尺寸，避免阻塞。

## Success Metrics

- 首屏 Hero 在 1920px width 下保持左右 50/50 布局且 Lighthouse CLS < 0.05。
- 创建按钮点击到组合成功写入的路径无报错（QA 覆盖 3 次）。
- 手动测试中，在 768px/375px 视口下布局不重叠、不产生横向滚动。
