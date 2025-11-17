# 指数分类栏目功能实现文档

## 📋 功能概述

本次优化将原来固定的"大盘"和"个股"两个标签栏改造为可自定义、可动态添加的分类栏目系统，用户可以根据自己的需求灵活组织指数分类。

## ✨ 主要功能

### 1. 动态分类栏目
- ✅ 可自定义栏目名称（如"A股指数"、"港股自选"、"美股科技股"等）
- ✅ 支持添加任意多个新栏目
- ✅ 支持编辑现有栏目名称
- ✅ 支持删除栏目（同时删除该栏目下的所有指数）
- ✅ 支持拖拽排序栏目顺序

### 2. 指数管理
- ✅ 每个栏目独立管理其包含的指数代码
- ✅ 支持添加自定义指数到指定栏目
- ✅ 支持删除栏目内的指数
- ✅ 支持显示/隐藏栏目内的指数
- ✅ 支持拖拽排序栏目内的指数

### 3. 数据持久化
- ✅ 分类配置保存到 localStorage
- ✅ 指数配置保存到 localStorage
- ✅ 自动数据迁移（从旧的 type 字段迁移到新的 categoryId 字段）

## 🔧 技术实现

### 1. 类型定义（frontend/src/store/types.ts）

#### IndexCategory 类型
```typescript
export interface IndexCategory {
  id: string;           // 唯一标识
  label: string;        // 可自定义的显示名称
  order: number;        // 排序
  visible: boolean;     // 是否显示
}
```

#### 更新 SelectedIndexItem 类型
```typescript
export interface SelectedIndexItem {
  code: string;
  name: string;
  visible: boolean;
  categoryId: string;   // 所属栏目ID（替代原来的 type: 'market' | 'stock'）
}
```

#### AppState 扩展
新增以下状态和 actions：
```typescript
// 状态
indexCategories: IndexCategory[];

// Actions
setIndexCategories: (categories: IndexCategory[]) => void;
addIndexCategory: (category: Omit<IndexCategory, 'id' | 'order'>) => void;
updateIndexCategory: (id: string, updates: Partial<IndexCategory>) => void;
deleteIndexCategory: (id: string) => void;
reorderIndexCategories: (categories: IndexCategory[]) => void;
```

### 2. Store 实现（frontend/src/store/index.ts）

#### 默认分类
```typescript
const DEFAULT_INDEX_CATEGORIES: IndexCategory[] = [
  { id: 'market', label: '大盘', order: 0, visible: true },
  { id: 'stock', label: '个股', order: 1, visible: true },
];
```

#### 数据迁移
```typescript
// 迁移老的 type 字段到新的 categoryId 字段
const migrateTypeToCategory = (items: any[]): SelectedIndexItem[] => {
  return items.map(item => {
    if (item.type && !item.categoryId) {
      return { ...item, categoryId: item.type };
    }
    return item;
  });
};
```

#### localStorage 键名
- `indexCategoriesV1`: 存储指数分类配置
- `marketIndicesOrderV2`: 存储指数配置（已包含 categoryId）

### 3. 组件重构（frontend/src/components/MarketIndices.tsx）

#### 主要改进
1. **分类标签栏**：支持动态显示和拖拽排序
2. **添加栏目按钮**：快速添加新分类
3. **设置模态框**：集中管理栏目和指数
4. **三个模态框**：
   - 设置模态框：管理指数和栏目
   - 添加栏目模态框：创建新分类
   - 编辑栏目模态框：修改栏目名称

#### 核心组件

**SortableCategoryTab**：可拖拽排序的分类标签
```typescript
const SortableCategoryTab: React.FC<{
  category: IndexCategory;
  isActive: boolean;
  onClick: () => void;
}> = ({ category, isActive, onClick }) => {
  // 使用 @dnd-kit 实现拖拽排序
};
```

**拖拽排序功能**：
- 分类标签拖拽排序（水平方向）
- 指数标签拖拽排序（垂直方向）

## 📊 数据结构示例

### 分类数据
```json
[
  { "id": "market", "label": "大盘", "order": 0, "visible": true },
  { "id": "stock", "label": "个股", "order": 1, "visible": true },
  { "id": "category_1699999999", "label": "港股自选", "order": 2, "visible": true }
]
```

### 指数数据
```json
[
  { "code": "sh000001", "name": "上证指数", "visible": true, "categoryId": "market" },
  { "code": "sz399001", "name": "深证成指", "visible": true, "categoryId": "market" },
  { "code": "hk00700", "name": "腾讯控股", "visible": true, "categoryId": "category_1699999999" }
]
```

## 🎨 UI/UX 特性

### 1. 分类标签栏
- 当前激活分类带有蓝色下划线
- 支持拖拽重新排序
- 未激活分类灰色显示，鼠标悬停可点击

### 2. 添加栏目按钮
- 位于分类标签栏末尾
- 点击弹出简洁的输入框

### 3. 设置模态框
- **栏目管理区**：列出所有栏目，提供编辑和删除功能
- **添加指数区**：输入指数代码添加到当前栏目
- **指数列表区**：显示当前栏目的所有指数，支持拖拽排序、显示/隐藏切换

### 4. 交互体验
- 拖拽排序时半透明效果
- 删除栏目时弹出确认对话框
- 操作成功/失败有消息提示

## 🔄 数据迁移策略

### 向后兼容
旧数据格式会自动迁移：
```typescript
// 旧格式
{ code: 'sh000001', name: '上证指数', visible: true, type: 'market' }

// 自动迁移为新格式
{ code: 'sh000001', name: '上证指数', visible: true, categoryId: 'market' }
```

### 迁移流程
1. 检查 localStorage 中的 `marketIndicesOrderV2`
2. 如果存在 `type` 字段但没有 `categoryId`，自动添加 `categoryId = type`
3. 如果不存在分类配置，使用默认的"大盘"和"个股"两个分类

## 🚀 使用场景示例

### 场景 1：按市场分类
- 大盘（A股主要指数）
- 港股（恒生、恒生科技等）
- 美股（道琼斯、纳斯达克、标普500）

### 场景 2：按行业分类
- 科技股
- 金融股
- 能源股
- 消费股

### 场景 3：按关注度分类
- 重点关注
- 次要关注
- 观察列表

### 场景 4：混合分类
- A股指数
- 我的自选股
- 科技巨头（FAANG）
- 加密货币相关

## 📝 后续优化建议

1. **批量导入**：支持批量导入指数代码
2. **模板保存**：预设分类模板供用户选择
3. **搜索功能**：在指数列表中快速搜索
4. **数据导出**：导出分类配置供其他设备使用
5. **分类图标**：为每个分类添加自定义图标
6. **颜色主题**：为每个分类设置不同的主题色

## 🐛 已知限制

1. 删除分类时会同时删除该分类下的所有指数（有确认对话框）
2. 至少需要保留一个分类栏目（最后一个无法删除）
3. 分类 ID 使用时间戳生成，理论上可能重复（概率极低）

## ✅ 测试要点

- [x] 添加新分类栏目
- [x] 编辑分类名称
- [x] 删除分类（包含确认）
- [x] 拖拽排序分类标签
- [x] 在不同分类间切换
- [x] 添加指数到指定分类
- [x] 删除分类内的指数
- [x] 拖拽排序分类内的指数
- [x] 显示/隐藏指数
- [x] 数据持久化（刷新页面后保持）
- [x] 旧数据自动迁移

## 📅 开发日期

- 实现日期：2025-11-09
- 版本：v1.0

