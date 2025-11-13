# 市场分类配置功能

## 功能概述

为投资组合详情页面的市场资产面板（MarketAssetsPanel）添加了可编辑的市场分类配置功能，用户现在可以：

- ✅ 自定义市场分类（如添加日股、欧股等）
- ✅ 编辑现有市场的名称、货币、符号和代码前缀
- ✅ 删除不需要的市场分类
- ✅ 拖拽排序市场显示顺序
- ✅ 显示/隐藏特定市场
- ✅ 配置自动保存到浏览器本地存储

## 实现细节

### 1. 数据结构

在 `frontend/src/store/types.ts` 中新增了 `MarketConfig` 接口：

```typescript
export interface MarketConfig {
  key: string; // 唯一标识
  label: string; // 显示名称
  currency: string; // 货币类型
  symbol: string; // 货币符号
  codePrefix: string[]; // 代码前缀数组，用于匹配持仓
  visible: boolean; // 是否显示
}
```

### 2. Store 状态管理

在 `frontend/src/store/index.ts` 中：

- 添加了 `marketConfigs` 状态
- 添加了 `setMarketConfigs` action
- 实现了本地存储持久化（localStorage key: `marketConfigsV1`）
- 默认市场配置：
  - A股（CNY/¥，代码前缀：sh, sz）
  - 港股（HKD/HK$，代码前缀：hk）
  - 美股（USD/$，代码前缀：us）

### 3. UI 组件

在 `frontend/src/components/MarketAssetsPanel.tsx` 中：

#### 3.1 管理入口
- 在页面右上角添加了"管理市场分类"按钮
- 点击按钮打开配置模态框

#### 3.2 配置模态框功能
- **已配置市场列表**：
  - 显示所有已配置的市场
  - 支持拖拽排序（使用 @dnd-kit 库）
  - 每个市场卡片显示：名称、货币、代码前缀
  - 操作按钮：显示/隐藏、编辑、删除
  
- **添加新市场**：
  - 市场标识（唯一键，不可重复）
  - 显示名称
  - 货币类型（下拉选择：CNY/USD/HKD/JPY/EUR/GBP）
  - 货币符号
  - 代码前缀（支持多个，用逗号分隔）
  
- **编辑市场**：
  - 点击"编辑"按钮进入编辑模式
  - 市场标识（key）不可修改
  - 可修改其他所有字段
  - 保存修改后立即生效

#### 3.3 市场资产显示
- 根据配置的市场动态渲染卡片
- 只显示 `visible: true` 的市场
- 按照用户设置的顺序显示
- 使用配置的货币符号和名称

### 4. 持仓匹配逻辑

持仓资产根据 `codePrefix` 数组进行匹配：

```typescript
const marketPositions = positionsWithCny.filter((p) => {
  if (!p.asset?.code) return false;
  return market.codePrefix.some(prefix => p.asset.code.startsWith(prefix));
});
```

这样可以灵活支持多个代码前缀，例如：
- A股：`['sh', 'sz']` - 同时匹配上证和深证
- 日股：`['jp', 'nikkei']` - 可以支持多种命名方式

## 使用示例

### 添加日本股票市场

1. 点击"管理市场分类"按钮
2. 在"添加新市场"区域填写：
   - 市场标识：`日股`
   - 显示名称：`日本股票`
   - 货币类型：`JPY (日元)`
   - 货币符号：`¥` 或 `￥`
   - 代码前缀：`jp` （如果有多个格式，可以填写 `jp, nikkei`）
3. 点击"添加市场"
4. 新市场会立即出现在投资组合页面中

### 修改现有市场

1. 点击"管理市场分类"按钮
2. 找到要修改的市场卡片
3. 点击"编辑"按钮
4. 修改需要更改的字段
5. 点击"保存修改"

### 调整市场顺序

1. 点击"管理市场分类"按钮
2. 在已配置市场列表中，直接拖拽市场卡片
3. 释放鼠标后顺序自动保存
4. 关闭模态框，页面上的市场顺序已更新

### 隐藏市场

1. 点击"管理市场分类"按钮
2. 找到要隐藏的市场卡片
3. 点击"隐藏"按钮
4. 该市场在投资组合页面中不再显示（数据仍保留）

## 技术栈

- **状态管理**：Zustand
- **UI 组件**：Ant Design (Modal, Button, Input, Select, Card, Space)
- **拖拽排序**：@dnd-kit/core + @dnd-kit/sortable
- **数据持久化**：localStorage
- **图标**：@ant-design/icons

## 兼容性

- 配置数据保存在浏览器本地存储中
- 清除浏览器数据会重置为默认配置
- 支持跨标签页同步（同一浏览器）

## 未来改进方向

1. 支持市场分组（如"亚太市场"、"欧美市场"）
2. 支持自定义货币汇率来源
3. 支持导入/导出市场配置
4. 支持市场模板（一键添加常用市场组合）
5. 支持更复杂的代码匹配规则（正则表达式）

## 相关文件

- `frontend/src/store/types.ts` - 类型定义
- `frontend/src/store/index.ts` - 状态管理
- `frontend/src/components/MarketAssetsPanel.tsx` - UI 组件

## 更新日期

2025-11-09


