---
title: 'AI写的代码烂？Claude官方开源终极武器：code-simplifier'
source: 'https://mp.weixin.qq.com/s/2JqXgYDs4w2FKe2MCGJxdg'
author:
  - '[[道哥说]]'
published:
created: 2026-01-23
description: 'AI编程正从“代码生成”转向“代码治理”。'
tags:
  - 'clippings'
---

![图片](https://mmbiz.qpic.cn/mmbiz_jpg/FHJ2QVOp4afVX6315QqepMWicng84vP1wl3VEA6XIbCDVetREyJr8ddKoN0zI3mWDTL7D0HjANQd4E5spyjVfjg/640?wx_fmt=jpeg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=0)

你用AI写代码，是否也经历过这种过山车？

开头行云流水，AI指哪打哪。可随着对话轮次增加，代码开始变味：功能能跑，但逻辑像迷宫，变量名风格迥异，冗余四处都是。

2026年1月9日，Claude Code核心开发者Boris Cherny宣布，正式开源其内部利器：**code-simplifier**。

它不是格式化工具，也不是Lint插件。它是一个智能代理，能在**绝对保证功能不变**的前提下，将AI生成的“屎山代码”变成清晰、可维护的优雅代码。

**一、它是什么**

想象一下收拾行李：你胡乱塞衣，箱子能关上就行。但到酒店找袜子，就得翻个底朝天。

code-simplifier，就是在你“盖上箱子”前，帮你把衣服叠好、分类收纳的工具。

它的核心使命唯一且明确：**只改实现，不改功能。**

- 统一命名风格
- 删除冗余逻辑
- 拆分复杂嵌套
- 拒绝过度抽象
- 严守项目规范

**二、价值部分**

这插件最有机制的不是代码，是它背后的设计哲学，堪称AI时代的代码审美革命。

1. **功能守恒定律**：底线是“只改怎么做，不改做什么”。这解决了我们对AI重构的最大恐惧——它杀红眼把逻辑重写了。

- **启示**：AI编程时代，最值钱的是划定“不可触碰区”的能力。

3. **清晰度大于简洁度**：明确反对“炫技”。官方提示词强调：“选择清晰而非简短，显式代码通常优于过度紧凑的代码”，并明令避免嵌套三元运算符。

- **启示**：代码的第一受众是人。好代码的标准不是短，是无歧义。

5. **强制执行项目规范**：通过读取`CLAUDE.md`文件，把个人习惯固化成团队规则。

- **启示**：不要每次和AI强调习惯，要把习惯文档化。这是规模工程的正道。

**三、如何上手**

安装方法非常简单，官方提供了两种方式：

**方式一：终端直接安装**

```
claude plugin install code-simplifier
```

**方式二：在 Claude Code 会话中安装**

```
/plugin marketplace update claude-plugins-official/plugin install code-simplifier
```

安装完后，用 `/plugin list` 检查是否安装成功。

它便自动根据你的`CLAUDE.md`开始大扫除，且默认只处理刚修改的代码，风险极低。

**四、存在形式**

code-simplifier 现在有两种存在形式：

**形式一：独立插件**（本次开源）

```
claude plugin install code-simplifier
```

**形式二：pr-review-toolkit 的一部分**

code-simplifier 同时也是 pr-review-toolkit 插件里的 6 个 agent 之一：

- **comment-analyzer** - 分析代码注释质量
- **pr-test-analyzer** - 检查测试覆盖率
- **silent-failure-hunter** - 找静默失败和错误处理问题
- **type-design-analyzer** - 分析类型设计
- **code-reviewer** - 常规代码审查
- **code-simplifier** - 代码简化

如果想要完整的 PR 审查能力，可以安装全套：

```
/plugin install pr-review-toolkit
```

**五、提示词**

### 中文版

```
---name: code-simplifierdescription: 简化并优化代码以提高清晰度、一致性和可维护性，同时保留所有功能。除非另有指示，否则专注于最近修改的代码。model: opus---你是一位专家级的代码简化专员，专注于增强代码的清晰度、一致性和可维护性，同时保留精确的功能。你的专长在于应用特定于项目的最佳实践来简化和改进代码，而不改变其行为。你优先考虑可读、直观的代码，而不是过度紧凑的解决方案。这种平衡是你作为专家级软件工程师多年积累的成果。你将分析最近修改的代码并应用以下优化：1. **保留功能**：绝不改变代码的*作用*——只改变它是*如何做*的。所有原始特性、输出和行为必须保持原样。2. **应用项目标准**：遵循 CLAUDE.md 中已建立的编码标准，包括：   - 使用带有正确导入排序和扩展名的 ES 模块   - 优先使用 \`function\` 关键字而非箭头函数   - 为顶层函数使用显式的返回类型注解   - 遵循正确的 React 组件模式及显式的 Props 类型   - 使用正确的错误处理模式（尽可能避免 try/catch）   - 保持一致的命名约定3. **增强清晰度**：通过以下方式简化代码结构：   - 减少不必要的复杂度和嵌套   - 消除冗余代码和抽象   - 通过清晰的变量和函数名提高可读性   - 整合相关逻辑   - 删除描述显而易见代码的不必要注释   - **重要**：避免嵌套的三元运算符——对于多重条件，优先使用 switch 语句或 if/else 链   - 选择清晰而非简短——显式的代码通常优于过度紧凑的代码4. **保持平衡**：避免可能导致以下后果的过度简化：   - 降低代码清晰度或可维护性   - 制造难以理解的"过于聪明"的解决方案   - 将过多的关注点合并到单个函数或组件中   - 移除有助于代码组织的有益抽象   - 优先考虑"行数更少"而非可读性   - 使代码更难调试或扩展5. **聚焦范围**：仅优化最近修改或在当前会话中触及的代码，除非明确指示审查更广泛的范围。你的优化流程：1. 识别最近修改的代码部分2. 分析提高优雅性和一致性的机会3. 应用特定于项目的最佳实践和编码标准4. 确保所有功能保持不变5. 验证优化后的代码更简洁且更易于维护6. 仅记录影响理解的重大更改你自主且主动地运作，在代码编写或修改后立即进行优化，无需显式请求。你的目标是确保所有代码符合最高标准的优雅性和可维护性，同时保留其完整功能。
```

**六、最佳实践**

1. **时机**：放在Build阶段尾声，Commit之前。
2. **规矩**：务必创建`CLAUDE.md`文件，写明你的编码规范。
3. **流程**：

- 完成 feature 后，跑一遍 code-simplifier
- 提 PR 之前，跑一遍完整的 pr-review-toolkit
- 把发现的问题修掉，再 commit

**七、最后的思考**

Claude此次开源，传递了一个关键信号：**AI编程正从“代码生成”转向“代码治理”。**

对独立开发者而言，它像一个不知疲倦、水平极高的技术总监，随时为你做Code Review。

它解决的不仅是代码质量，更是项目失控带来的焦虑。当代码整洁清晰，你才有信心开启下一个里程碑。

**参考链接：**

- • Boris 的开源公告：https://x.com/bcherny/status/2009450715081789767
- • Claude Code 官方插件仓库：https://github.com/anthropics/claude-plugins-official
- • PR Review Toolkit 文档：https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit
