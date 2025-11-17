# Homepage Capability - Delta

## ADDED Requirements

### Requirement: Claude 风格 Hero 布局

PortfolioListPage SHALL 在投资组合列表上方渲染一个左右分栏的 Hero，并保持与 Claude 官网相似的留白、色调与排版。

#### Scenario: 桌面视图布局

- **GIVEN** 视口宽度 >= 1280px
- **WHEN** 用户打开 `/`
- **THEN** Hero 使用 `display:flex` 呈现两列（左列内容宽度 40–50%，右列图片占余量）
- **AND** 背景色为 `#fdf9f3` 或同等米色，圆角 >= 24px，内边距 >= 40px
- **AND** 左列包含主标题、副标题、价值要点列表以及主操作按钮

#### Scenario: 列表区衔接

- **WHEN** Hero 渲染完成
- **THEN** 页面下方的投资组合卡片改为响应式网格（最少 1 列，最大 3 列）
- **AND** 卡片对齐 Hero 宽度，左右留白一致

### Requirement: 嵌入式创建表单

Hero 左列 MUST 提供即时创建投资组合入口，并与现有创建流程共享逻辑。

#### Scenario: 快速创建成功

- **GIVEN** 用户在 Hero 表单输入名称和初始现金（必填）
- **WHEN** 点击“创建投资组合”
- **THEN** 系统调用既有 `useCreatePortfolio` 逻辑
- **AND** 成功后刷新 `PortfolioList` 数据并展示成功提示

#### Scenario: 访问高级设置

- **GIVEN** 用户需要填写融资额度或利率
- **WHEN** 在 Hero 中点击“高级设置”或等效链接
- **THEN** 打开原有 Modal（含所有字段）
- **AND** Modal 成功提交时同样刷新列表并关闭弹窗

### Requirement: Hero 插画展示

Hero 右列 SHALL 展示固定插画资源与辅助装饰，保证加载性能与可访问性。

#### Scenario: 图片资源

- **WHEN** 构建前端资产
- **THEN** `Generated Image November 11, 2025 - 5_03PM.png` 被复制/命名为 `frontend/src/assets/home-hero.png`
- **AND** PortfolioListPage 通过 ES module 引用并设置 `alt="投资组合插画"`、`loading="lazy"`
- **AND** 图片应用圆角 >= 24px 与轻投影，宽度自适应容器

#### Scenario: 图片加载失败

- **WHEN** 图片资源未能加载
- **THEN** 右列展示备用背景色块与提示文案，按钮仍可操作

### Requirement: 响应式与可访问性

页面 SHALL 在平板与移动端保持可读性，并满足基本可访问性要求。

#### Scenario: 平板断点

- **GIVEN** 视口宽度在 768–1023px
- **THEN** Hero 自动改为纵向堆叠（图片在文字下方）
- **AND** 网格列表至少保持 2 列（若空间允许）

#### Scenario: 移动断点

- **GIVEN** 视口宽度 <= 640px
- **THEN** Hero 内的价值要点装饰可隐藏，标题字号降级但仍保持衬线字体
- **AND** 所有交互元素（输入框、按钮）满足 WCAG 建议的 44px 可点击高度，无横向滚动
