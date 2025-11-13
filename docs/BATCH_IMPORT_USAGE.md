# 批量导入功能使用指南

## 快速开始

### 在前端中使用批量导入组件

批量导入组件已经创建完成，可以在投资组合详情页面中集成使用。

#### 1. 导入组件

```typescript
import { BatchImport } from '@/features/transaction';
```

#### 2. 使用组件

```tsx
<BatchImport 
  portfolioId={portfolioId}
  onSuccess={() => {
    // 导入成功后的回调，可以刷新数据
    refetchPortfolio();
    refetchTransactions();
  }}
/>
```

#### 3. 完整示例

```tsx
import React from 'react';
import { Tabs } from 'antd';
import { AddTransactionForm, TransactionList, BatchImport } from '@/features/transaction';

export const PortfolioDetail: React.FC = () => {
  const { portfolioId } = useParams();
  
  const handleRefresh = () => {
    // 刷新投资组合数据
    refetch();
  };

  return (
    <div>
      <Tabs>
        <Tabs.TabPane tab="添加交易" key="add">
          <AddTransactionForm 
            portfolioId={portfolioId}
            onSuccess={handleRefresh}
          />
        </Tabs.TabPane>
        
        <Tabs.TabPane tab="批量导入" key="batch">
          <BatchImport 
            portfolioId={portfolioId}
            onSuccess={handleRefresh}
          />
        </Tabs.TabPane>
        
        <Tabs.TabPane tab="交易记录" key="list">
          <TransactionList portfolioId={portfolioId} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};
```

## 用户操作流程

### 步骤1: 下载模板
用户点击"下载CSV模板"按钮，获取标准格式的CSV文件。

### 步骤2: 填写数据
使用Excel打开模板，按照以下格式填写交易数据：

```csv
日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-15,BUY,sh600519,100,1850.50,,92.50,0,CNY,1,买入茅台
2025-01-16,DEPOSIT,,,,50000,,,,CNY,1,入金
```

### 步骤3: 上传文件
点击"选择CSV文件"上传填写好的CSV文件。

### 步骤4: 预览验证
点击"预览"按钮，系统会：
- 解析CSV文件
- 验证每一行数据
- 显示验证结果
- 列出所有错误（如有）

### 步骤5: 确认导入
如果验证通过（无错误），点击"确认导入"按钮执行导入。

## CSV格式说明

### 交易类型说明

| 类型 | 说明 | 必填字段 |
|------|------|----------|
| BUY | 买入股票 | 日期、资产代码、数量、价格 |
| SELL | 卖出股票 | 日期、资产代码、数量、价格 |
| DEPOSIT | 存入现金 | 日期、金额 |
| WITHDRAW | 取出现金 | 日期、金额 |
| LEVERAGE_ADD | 增加融资额度 | 日期、金额 |
| LEVERAGE_REMOVE | 减少融资额度 | 日期、金额 |
| LEVERAGE_COST | 融资利息支出 | 日期、金额 |
| DIVIDEND | 股息分红 | 日期、金额 |

### 资产代码格式

- **A股**：sh + 代码（上交所）或 sz + 代码（深交所）
  - 示例：sh600519（贵州茅台）、sz000001（平安银行）
  
- **港股**：hk + 代码
  - 示例：hk00700（腾讯控股）、hk09988（阿里巴巴）
  
- **美股**：us + 代码
  - 示例：usAAPL（苹果）、usTSLA（特斯拉）

### 货币和汇率

- **货币类型**：CNY（人民币）、USD（美元）、HKD（港币）
- **汇率**：相对于人民币的汇率，默认为1
  - 美股交易：货币=USD，汇率≈7.2
  - 港股交易：货币=HKD，汇率≈0.92

## 错误处理

### 常见错误类型

1. **日期格式错误**
   - 错误：`2025/01/15` 或 `15-01-2025`
   - 正确：`2025-01-15`

2. **交易类型错误**
   - 错误：`buy` 或 `购买`
   - 正确：`BUY`（必须大写）

3. **资产代码格式错误**
   - 错误：`600519` 或 `SH600519`
   - 正确：`sh600519`（小写前缀）

4. **缺少必填字段**
   - BUY/SELL交易必须有：资产代码、数量、价格
   - 资金操作必须有：金额

5. **数值范围错误**
   - 数量、价格、金额必须大于0
   - 汇率必须大于0

### 错误提示

系统会在预览阶段显示所有错误，包括：
- 错误所在的行号
- 错误的字段名
- 详细的错误信息
- 字段的实际值

用户需要修正所有错误后才能执行导入。

## 注意事项

### Excel操作建议

1. **保存格式**：使用"CSV UTF-8（逗号分隔）"格式
2. **编码问题**：确保文件编码为UTF-8，避免中文乱码
3. **空值处理**：不需要填写的字段留空即可，不要填写0或null
4. **数值格式**：不要使用千分位分隔符，如 1,850.50 应写为 1850.50

### 数据一致性

1. **导入顺序**：建议按时间顺序导入，先入金再买股
2. **资金检查**：系统会检查账户余额，资金不足会导入失败
3. **持仓检查**：卖出时会检查持仓数量，超卖会导入失败
4. **重复导入**：注意避免重复导入相同的交易记录

### 性能建议

1. **批次大小**：建议每次导入不超过1000条记录
2. **文件大小**：CSV文件最大10MB
3. **导入时间**：大批量数据导入可能需要几分钟，请耐心等待

## 测试数据

可以使用以下测试数据验证功能：

```csv
日期,类型,资产代码,数量,价格,金额,手续费,融资额度,货币,汇率,备注
2025-01-10,DEPOSIT,,,,100000,,,,CNY,1,初始资金
2025-01-11,BUY,sh600519,50,1800.00,,90.00,0,CNY,1,买入茅台50股
2025-01-12,BUY,hk00700,100,380.00,,190.00,0,HKD,0.92,买入腾讯100股
2025-01-13,SELL,sh600519,20,1850.00,,92.50,0,CNY,1,卖出茅台20股
2025-01-14,DIVIDEND,sh600519,,,1000,,,CNY,1,茅台分红
```

## 技术支持

如遇到问题，请：
1. 检查CSV格式是否正确
2. 查看错误提示信息
3. 参考本文档的格式说明
4. 联系技术支持

---

**相关文档**：
- [批量导入功能详细文档](./BATCH_IMPORT_FEATURE.md)
- [交易类型说明](../README.md)

