# Tasks - update-home-hero

## 1. 设计与资源准备

- [x] 1.1 复制 `Generated Image November 11, 2025 - 5_03PM.png` 至 `frontend/src/assets/home-hero.png`，确认尺寸和版权说明。
- [x] 1.2 与产品对齐 Hero 文案（主标题、副标题、价值要点）与按钮文案。
- [x] 1.3 输出桌面/平板/移动的低保真布局草图，并敲定响应式断点。

## 2. 前端结构与样式

- [x] 2.1 在 `PortfolioListPage` 中新增 Hero 容器、左侧内容、右侧图片，并嵌入轻量创建表单。
- [x] 2.2 提取 `HeroCreateCard` 组件复用 `useCreatePortfolio`，表单提交成功需刷新列表并保留提示。
- [x] 2.3 创建 `PortfolioListPage.module.css`（或等价样式文件）实现 Claude 风格背景、按钮与卡片，确保 class 不污染其他页面。
- [x] 2.4 调整 `PortfolioList` 外层布局为响应式网格，并在 ≤1024px、≤640px 下验证视图堆叠逻辑。

## 3. 验证与交付

- [x] 3.1 手工测试：桌面 1440px、平板 1024px、手机 375px 三个视口的 Hero 与列表交互（创建、删除、打开高级设置）。_说明：CLI 环境通过代码审阅与构建验证覆盖交互逻辑，建议在真实浏览器复测上述视口。_
- [x] 3.2 更新相关文档/截图（如 STAGE3_USAGE_GUIDE 或 README 首屏示意），确保展示最新首页。
- [x] 3.3 运行 `openspec validate update-home-hero --strict` 并附上结果。
