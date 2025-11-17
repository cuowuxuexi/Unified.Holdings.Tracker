# 实施任务清单

## 1. 问题诊断和根因分析

- [ ] 1.1 在开发环境中重现问题
  - [ ] 1.1.1 创建测试投资组合
  - [ ] 1.1.2 执行港股卖出交易（如 hk00700, 数量1, 价格100）
  - [ ] 1.1.3 执行港股股息交易（如 hk00700, 金额100）
  - [ ] 1.1.4 观察控制台日志和数据库记录
  
- [ ] 1.2 验证编译产物
  - [ ] 1.2.1 检查 `packages/infra/dist/` 是否包含最新编译的 `.js` 文件
  - [ ] 1.2.2 比对源文件 `.ts` 和编译文件 `.js` 的修改时间
  - [ ] 1.2.3 确认后端进程加载的是最新的编译产物
  
- [ ] 1.3 检查前端数据传递
  - [ ] 1.3.1 使用浏览器开发工具查看 POST 请求体
  - [ ] 1.3.2 确认是否传递了 `currency` 字段
  - [ ] 1.3.3 检查 `assetCode` 是否正确传递
  
- [ ] 1.4 验证汇率服务
  - [ ] 1.4.1 单独测试 `getExchangeRateForAssetToCNY('hk00700')`
  - [ ] 1.4.2 检查汇率API响应是否正常
  - [ ] 1.4.3 验证汇率值是否合理（HKD约0.91-0.92, USD约7.2-7.3）
  
- [ ] 1.5 审查存储层执行路径
  - [ ] 1.5.1 在 `storage.prisma.ts` 的关键位置添加 `console.log`
  - [ ] 1.5.2 追踪 SELL 分支是否正确执行汇率换算
  - [ ] 1.5.3 追踪 DIVIDEND 分支是否正确执行汇率换算
  - [ ] 1.5.4 验证 `newTransaction` 对象的 `currency` 和 `exchangeRate` 字段赋值

## 2. 存储层修复

- [ ] 2.1 增强 SELL 分支日志（`storage.prisma.ts` 约478行）
  ```typescript
  console.log(`[SELL] Asset: ${normalizedData.assetCode}, Original Amount: ${amount}, Exchange Rate: ${exchangeRate}, Amount CNY: ${amountCNY}`);
  console.log(`[SELL] Currency: ${normalizedData.currency}, Saving exchange rate: ${exchangeRate}`);
  ```

- [ ] 2.2 增强 DIVIDEND 分支日志（`storage.prisma.ts` 约504行）
  ```typescript
  console.log(`[DIVIDEND] Asset: ${normalizedData.assetCode}, Is Foreign: ${isForeign}, Exchange Rate: ${exchangeRate}`);
  console.log(`[DIVIDEND] Original Amount: ${amount}, Amount CNY: ${amountCNY}`);
  ```

- [ ] 2.3 验证数据库保存逻辑（`storage.prisma.ts` 约657行）
  ```typescript
  console.log(`[DB Save] Transaction data:`, {
    currency: newTransaction.currency ?? 'CNY',
    exchangeRate: newTransaction.exchangeRate
  });
  ```

- [ ] 2.4 确保 BUY 分支也正确保存（`storage.prisma.ts` 约422行）
  - 虽然用户主要反馈 SELL/DIVIDEND 问题，但要确保 BUY 也一致

## 3. 后端API层修复

- [ ] 3.1 增强币种推断日志（`portfolio.ts` 约486行）
  ```typescript
  console.log(`[Currency Inference] Asset: ${assetCode}, Inferred Currency: ${transactionData.currency}`);
  ```

- [ ] 3.2 确保所有交易类型都经过币种推断
  - 当前逻辑在验证之后，确认在 SELL 和 DIVIDEND 时也会触发

- [ ] 3.3 添加数据完整性检查
  ```typescript
  console.log(`[API] Sending to UseCase:`, {
    type: transactionData.type,
    assetCode: transactionData.assetCode,
    currency: transactionData.currency,
    amount: transactionData.amount,
    price: transactionData.price,
    quantity: transactionData.quantity
  });
  ```

## 4. 前端修复（如需要）

- [ ] 4.1 检查交易表单是否传递 `currency`
  - [ ] 4.1.1 查找卖出交易表单组件
  - [ ] 4.1.2 查找股息交易表单组件
  - [ ] 4.1.3 如果没有传递 `currency`，添加该字段
  
- [ ] 4.2 确保 `assetCode` 正确传递
  - 验证表单提交时资产代码格式正确（如 'hk00700'）

## 5. 汇率服务验证和增强

- [ ] 5.1 检查 `currency-service.ts` 的实现
  - [ ] 5.1.1 验证 `getExchangeRateForAssetToCNY` 函数逻辑
  - [ ] 5.1.2 确认资产代码前缀识别逻辑（hk → HKD, us → USD）
  - [ ] 5.1.3 验证API调用和缓存机制

- [ ] 5.2 添加错误处理和回退机制
  ```typescript
  try {
    exchangeRate = await getExchangeRateForAssetToCNY(assetCode);
  } catch (error) {
    console.error(`Failed to get exchange rate for ${assetCode}, using fallback rate`);
    // 使用最近的缓存汇率或默认值
    exchangeRate = getFallbackRate(assetCode);
  }
  ```

- [ ] 5.3 添加汇率合理性验证
  ```typescript
  if (exchangeRate < 0.1 || exchangeRate > 20) {
    console.warn(`Suspicious exchange rate: ${exchangeRate} for ${assetCode}`);
  }
  ```

## 6. 编译和部署流程优化

- [ ] 6.1 创建自动化编译脚本
  - [ ] 6.1.1 在 `scripts/` 目录创建 `rebuild-infra.sh` 或 `.ps1`
  - [ ] 6.1.2 脚本内容：编译 infra → 重启后端
  
- [ ] 6.2 验证编译流程
  - [ ] 6.2.1 执行 `npm run build` 在 `packages/infra`
  - [ ] 6.2.2 检查 `dist/` 目录生成的文件
  - [ ] 6.2.3 确认后端 `node_modules/@infra/` 或导入路径正确

- [ ] 6.3 添加编译后自动重启
  - [ ] 6.3.1 考虑使用 `nodemon` 或 `ts-node-dev` 的 watch 模式
  - [ ] 6.3.2 或在 `package.json` 中添加组合脚本

## 7. 数据修复（如有历史错误数据）

- [ ] 7.1 创建数据修复脚本
  - [ ] 7.1.1 查询所有 `currency` 为 NULL 或 'CNY' 但 `assetCode` 以 'hk'/'us' 开头的交易
  - [ ] 7.1.2 重新计算并更新这些交易的 `currency` 和 `exchangeRate`
  - [ ] 7.1.3 重新计算投资组合的现金余额
  
- [ ] 7.2 备份数据库
  - 在执行修复脚本前备份 `apps/backend/prisma/data/portfolio.db`

- [ ] 7.3 执行修复并验证
  - [ ] 7.3.1 运行修复脚本
  - [ ] 7.3.2 查询数据库验证结果
  - [ ] 7.3.3 在UI中检查投资组合数据是否正确

## 8. 测试

- [ ] 8.1 单元测试
  - [ ] 8.1.1 在 `packages/infra/src/storage/__tests__/` 添加汇率换算测试
  - [ ] 8.1.2 测试 SELL 交易的汇率换算
  - [ ] 8.1.3 测试 DIVIDEND 交易的汇率换算
  - [ ] 8.1.4 测试币种推断逻辑
  
- [ ] 8.2 集成测试
  - [ ] 8.2.1 完整流程测试：创建投资组合 → 买入港股 → 卖出 → 验证现金
  - [ ] 8.2.2 完整流程测试：创建投资组合 → 买入美股 → 股息 → 验证现金
  - [ ] 8.2.3 测试边界情况：汇率API失败、无效资产代码等
  
- [ ] 8.3 手动验证
  - [ ] 8.3.1 在开发环境UI中测试港股卖出
  - [ ] 8.3.2 在开发环境UI中测试港股股息
  - [ ] 8.3.3 在开发环境UI中测试美股卖出
  - [ ] 8.3.4 在开发环境UI中测试美股股息
  - [ ] 8.3.5 检查交易历史显示
  - [ ] 8.3.6 检查投资组合总览数据

## 9. 文档和清理

- [ ] 9.1 更新代码注释
  - 在关键的汇率换算逻辑处添加中文注释说明

- [ ] 9.2 更新用户文档（如有）
  - 说明系统如何处理外币交易和汇率换算

- [ ] 9.3 删除临时调试文件
  - [ ] 9.3.1 删除 `test-exchange-rate-fix.js`
  - [ ] 9.3.2 删除 `check-last-transaction.js`
  - [ ] 9.3.3 删除 `force-restart-backend.ps1`
  - [ ] 9.3.4 删除 `EXCHANGE_RATE_COMPLETE_FIX.md`（或移至文档目录）
  - [ ] 9.3.5 删除 `packages/问题.md`（或移至文档目录）

- [ ] 9.4 清理控制台日志
  - 移除或降低部分调试日志的级别（但保留关键的汇率换算日志）

## 10. 验收和部署

- [ ] 10.1 最终验收测试
  - [ ] 10.1.1 在干净的开发环境重新测试完整流程
  - [ ] 10.1.2 确认所有测试用例通过
  - [ ] 10.1.3 确认日志输出符合预期
  
- [ ] 10.2 性能检查
  - [ ] 10.2.1 验证汇率API缓存是否生效
  - [ ] 10.2.2 确认交易添加操作响应时间正常
  
- [ ] 10.3 更新变更日志
  - 在项目 CHANGELOG 中记录此次修复

- [ ] 10.4 准备发布说明
  - 说明修复的问题和影响范围

