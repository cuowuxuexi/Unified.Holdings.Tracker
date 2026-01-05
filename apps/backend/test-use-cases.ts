/**
 * 手动测试脚本：验证 Use Cases 行为
 * 
 * 运行方式：
 * cd apps/backend
 * npx ts-node test-use-cases.ts
 */

import { Container } from './src/container';
import { TransactionType } from '@uht/domain';

// 颜色输出辅助函数
const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
};

async function testUseCases() {
  console.log(colors.blue('\n========== Use Case 测试开始 ==========\n'));

  const container = new Container();
  let testPortfolioId: string | null = null;

  try {
    // 测试 1: 列出所有投资组合
    console.log(colors.yellow('测试 1: ListPortfoliosUseCase'));
    const portfoliosBefore = await container.listPortfoliosUseCase.execute();
    console.log(`当前投资组合数量: ${portfoliosBefore.length}`);
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 2: 创建新投资组合
    console.log(colors.yellow('测试 2: CreatePortfolioUseCase'));
    const newPortfolio = await container.createPortfolioUseCase.execute({
      name: `测试组合-${Date.now()}`,
      initialCash: 100000,
      leverage: {
        totalAmount: 50000,
        usedAmount: 0,
        availableAmount: 50000,
        costRate: 0.08,
      },
    });
    testPortfolioId = newPortfolio.id;
    console.log(`创建投资组合成功，ID: ${testPortfolioId}`);
    console.log(`初始现金: ${newPortfolio.initialCash}, 可用现金: ${newPortfolio.cash}`);
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 3: 获取投资组合详情
    console.log(colors.yellow('测试 3: GetPortfolioUseCase'));
    const portfolio = await container.getPortfolioUseCase.execute({ 
      portfolioId: testPortfolioId 
    });
    if (!portfolio) {
      throw new Error('获取投资组合失败');
    }
    console.log(`投资组合名称: ${portfolio.name}`);
    console.log(`交易记录数量: ${portfolio.transactions.length}`);
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 4: 添加入金交易
    console.log(colors.yellow('测试 4: AddTransactionUseCase - 入金'));
    const portfolioAfterDeposit = await container.addTransactionUseCase.execute({
      portfolioId: testPortfolioId,
      transaction: {
        type: TransactionType.DEPOSIT,
        date: new Date().toISOString(),
        amount: 50000,
        notes: '测试入金',
      },
    });
    console.log(`入金后现金: ${portfolioAfterDeposit.cash}`);
    console.log(`交易记录数量: ${portfolioAfterDeposit.transactions.length}`);
    if (portfolioAfterDeposit.cash !== 150000) {
      throw new Error(`预期现金为 150000，实际为 ${portfolioAfterDeposit.cash}`);
    }
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 5: 添加买入交易
    console.log(colors.yellow('测试 5: AddTransactionUseCase - 买入'));
    const buyTransactionId = portfolioAfterDeposit.transactions[portfolioAfterDeposit.transactions.length - 1].id;
    
    const portfolioAfterBuy = await container.addTransactionUseCase.execute({
      portfolioId: testPortfolioId,
      transaction: {
        type: TransactionType.BUY,
        date: new Date().toISOString(),
        assetCode: 'sh600519',
        quantity: 100,
        price: 1500,
        commission: 5,
        notes: '测试买入茅台',
      },
    });
    console.log(`买入后现金: ${portfolioAfterBuy.cash}`);
    console.log(`交易记录数量: ${portfolioAfterBuy.transactions.length}`);
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 6: 删除交易
    console.log(colors.yellow('测试 6: RemoveTransactionUseCase'));
    const lastTransaction = portfolioAfterBuy.transactions[portfolioAfterBuy.transactions.length - 1];
    const expectedTransactionCount = portfolioAfterBuy.transactions.length - 1;
    const portfolioAfterRemove = await container.removeTransactionUseCase.execute({
      portfolioId: testPortfolioId,
      transactionId: lastTransaction.id,
    });
    console.log(`删除交易后现金: ${portfolioAfterRemove.cash}`);
    console.log(`交易记录数量: ${portfolioAfterRemove.transactions.length}（预期: ${expectedTransactionCount}）`);
    if (portfolioAfterRemove.transactions.length !== expectedTransactionCount) {
      throw new Error(`删除交易失败：预期 ${expectedTransactionCount} 条交易，实际 ${portfolioAfterRemove.transactions.length} 条`);
    }
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 7: 重算现金
    console.log(colors.yellow('测试 7: RecalculatePortfolioCashUseCase'));
    const portfolioAfterRecalc = await container.recalculatePortfolioCashUseCase.execute({
      portfolioId: testPortfolioId,
    });
    console.log(`重算后现金: ${portfolioAfterRecalc.cash}`);
    console.log(colors.green('✓ 测试通过\n'));

    // 测试 8: 删除投资组合
    console.log(colors.yellow('测试 8: 删除投资组合'));
    await container.getPortfolioRepository().delete(testPortfolioId);
    const deletedPortfolio = await container.getPortfolioUseCase.execute({ 
      portfolioId: testPortfolioId 
    });
    if (deletedPortfolio !== null) {
      throw new Error('删除投资组合失败');
    }
    console.log('投资组合已成功删除');
    console.log(colors.green('✓ 测试通过\n'));

    // 最终验证
    console.log(colors.yellow('最终验证: 投资组合数量'));
    const portfoliosAfter = await container.listPortfoliosUseCase.execute();
    if (portfoliosAfter.length !== portfoliosBefore.length) {
      throw new Error(`投资组合数量不一致，预期 ${portfoliosBefore.length}，实际 ${portfoliosAfter.length}`);
    }
    console.log(`投资组合数量恢复: ${portfoliosAfter.length}`);
    console.log(colors.green('✓ 测试通过\n'));

    console.log(colors.green('========== 所有测试通过！ ==========\n'));
  } catch (error) {
    console.error(colors.red(`\n测试失败: ${error}`));
    console.error(error);

    // 清理：如果测试失败，尝试删除测试组合
    if (testPortfolioId) {
      try {
        await container.getPortfolioRepository().delete(testPortfolioId);
        console.log(colors.yellow('已清理测试数据'));
      } catch (cleanupError) {
        console.error(colors.red('清理测试数据失败'), cleanupError);
      }
    }

    process.exit(1);
  }
}

// 运行测试
testUseCases()
  .then(() => {
    console.log(colors.blue('测试完成，退出。'));
    process.exit(0);
  })
  .catch((error) => {
    console.error(colors.red('测试执行出错:'), error);
    process.exit(1);
  });

