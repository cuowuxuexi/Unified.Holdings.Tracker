/**
 * 数据诊断脚本
 * 检查所有投资组合的持仓数据，检测异常值并生成报告
 */

import { prisma } from '../lib/prisma';
import { buildPositionsUsingLots } from '../services/portfolioReplay';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { Transaction, TransactionType, Market, Position, Asset } from '../types';

// 本地验证函数（避免导入依赖问题）
function validatePositionData(position: Position): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // 检查1: 总盈亏% 异常（绝对值超过1000%，即10倍）
  if (position.totalPnlPercent !== undefined && position.totalPnlPercent !== null) {
    const percentValue = Math.abs(position.totalPnlPercent);
    if (percentValue > 10) {
      warnings.push(
        `${position.asset.code}: 总盈亏%异常 (${(position.totalPnlPercent * 100).toFixed(2)}%)，` +
        `可能是成本价过小或数据错误。成本价=${position.costPrice?.toFixed(4)}, 市值=${position.marketValue?.toFixed(2)}`
      );
    }
  }

  // 检查2: 成本价异常（小于0.01或为0）
  if (position.costPrice !== undefined && position.costPrice !== null) {
    if (position.costPrice < 0.01 && position.quantity > 0) {
      warnings.push(
        `${position.asset.code}: 成本价异常 (${position.costPrice.toFixed(4)})，` +
        `可能导致盈亏%计算错误。持仓数量=${position.quantity}`
      );
    }
  }

  // 检查3: 市值异常（负数或为0但有持仓）
  if (position.marketValue !== undefined && position.marketValue !== null) {
    if (position.marketValue < 0) {
      warnings.push(
        `${position.asset.code}: 市值为负数 (${position.marketValue.toFixed(2)})`
      );
    } else if (position.marketValue === 0 && position.quantity > 0) {
      warnings.push(
        `${position.asset.code}: 市值为0但持仓数量=${position.quantity}，可能是行情数据缺失`
      );
    }
  }

  // 检查4: 持仓数量异常（负数）
  if (position.quantity < 0) {
    warnings.push(
      `${position.asset.code}: 持仓数量为负数 (${position.quantity})`
    );
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

interface DiagnosisResult {
  portfolioId: string;
  portfolioName: string;
  totalPositions: number;
  anomalies: AnomalyRecord[];
}

interface AnomalyRecord {
  assetCode: string;
  assetName: string;
  quantity: number;
  costPrice: number;
  totalCost: number;
  marketValue: number | undefined;
  totalPnlPercent: number | undefined;
  warnings: string[];
}

// Helper: Parse market from asset code
function getMarketFromCode(code: string): Market | null {
  const lowerCode = code.toLowerCase();
  if (lowerCode.startsWith('sh') || lowerCode.startsWith('sz')) return Market.CN;
  if (lowerCode.startsWith('hk')) return Market.HK;
  if (lowerCode.startsWith('us')) return Market.US;
  console.warn(`Could not determine market for code: ${code}`);
  return null;
}

async function diagnoseData(): Promise<DiagnosisResult[]> {
  console.log('='.repeat(60));
  console.log('开始数据诊断...');
  console.log('='.repeat(60));

  // 获取所有投资组合
  const portfolios = await prisma.portfolio.findMany({
    include: {
      transactions: true,
    },
  });

  console.log(`找到 ${portfolios.length} 个投资组合\n`);

  const results: DiagnosisResult[] = [];

  for (const portfolio of portfolios) {
    console.log(`\n检查投资组合: ${portfolio.name} (ID: ${portfolio.id})`);
    console.log('-'.repeat(60));

    // 转换交易记录为应用层类型
    const transactions: Transaction[] = portfolio.transactions.map((tx) => ({
      id: tx.id,
      portfolioId: tx.portfolioId,
      type: tx.type as TransactionType,
      date: tx.date.toISOString(),
      assetCode: tx.assetCode || undefined,
      quantity: tx.quantity ? Number(tx.quantity) : undefined,
      price: tx.price ? Number(tx.price) : undefined,
      amount: tx.amount ? Number(tx.amount) : undefined,
      commission: tx.commission ? Number(tx.commission) : undefined,
      leverageUsed: tx.leverageUsed ? Number(tx.leverageUsed) : undefined,
      currency: tx.currency,
      exchangeRate: tx.exchangeRate ? Number(tx.exchangeRate) : undefined,
      notes: tx.notes || undefined,
    }));

    console.log(`交易记录数量: ${transactions.length}`);

    // 使用批次系统重新计算持仓
    const lotPositions = buildPositionsUsingLots(transactions);
    console.log(`持仓数量: ${lotPositions.size}`);

    const anomalies: AnomalyRecord[] = [];

    for (const [assetCode, state] of lotPositions) {
      if (state.quantity <= 0) continue;

      const market = getMarketFromCode(assetCode);
      if (!market) continue;

      const asset: Asset = {
        code: assetCode,
        market,
        name: assetCode, // 暂时使用代码作为名称
      };

      const costPrice = state.quantity > 0 ? state.totalCostCny / state.quantity : 0;

      const position: Position = {
        asset,
        quantity: state.quantity,
        costPrice,
        costPriceLocal: state.quantity > 0 ? state.totalCostLocal / state.quantity : 0,
        totalCost: state.totalCostCny,
        totalCostLocal: state.totalCostLocal,
        currency: state.currency,
        marketValue: 0, // 暂时设为0，因为没有实时行情
        marketValueLocal: 0,
        marketValueCNY: 0,
        currentPrice: 0,
        dailyChange: 0,
        dailyChangeLocal: 0,
        totalPnl: 0,
        totalPnlLocal: 0,
        totalPnlPercent: undefined,
      };

      // 验证持仓数据
      const validation = validatePositionData(position);

      if (!validation.isValid) {
        console.log(`  ⚠️  ${assetCode}:`);
        validation.warnings.forEach((warning) => {
          console.log(`      - ${warning}`);
        });

        anomalies.push({
          assetCode,
          assetName: assetCode,
          quantity: state.quantity,
          costPrice: costPrice,
          totalCost: state.totalCostCny,
          marketValue: position.marketValue,
          totalPnlPercent: position.totalPnlPercent,
          warnings: validation.warnings,
        });
      }
    }

    results.push({
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      totalPositions: lotPositions.size,
      anomalies,
    });

    if (anomalies.length === 0) {
      console.log('✅ 未发现异常数据');
    } else {
      console.log(`❌ 发现 ${anomalies.length} 个异常持仓`);
    }
  }

  return results;
}

function generateMarkdownReport(results: DiagnosisResult[]): string {
  const timestamp = new Date().toISOString();
  let markdown = `# 投资组合数据诊断报告\n\n`;
  markdown += `**生成时间**: ${timestamp}\n\n`;
  markdown += `---\n\n`;

  markdown += `## 执行摘要\n\n`;
  const totalPortfolios = results.length;
  const portfoliosWithAnomalies = results.filter((r) => r.anomalies.length > 0).length;
  const totalAnomalies = results.reduce((sum, r) => sum + r.anomalies.length, 0);

  markdown += `- **检查的投资组合数量**: ${totalPortfolios}\n`;
  markdown += `- **存在异常的组合**: ${portfoliosWithAnomalies}\n`;
  markdown += `- **异常持仓总数**: ${totalAnomalies}\n\n`;

  if (totalAnomalies === 0) {
    markdown += `✅ **未发现数据异常**\n\n`;
    return markdown;
  }

  markdown += `---\n\n## 详细诊断结果\n\n`;

  for (const result of results) {
    markdown += `### 投资组合: ${result.portfolioName}\n\n`;
    markdown += `- **ID**: \`${result.portfolioId}\`\n`;
    markdown += `- **总持仓数**: ${result.totalPositions}\n`;
    markdown += `- **异常持仓数**: ${result.anomalies.length}\n\n`;

    if (result.anomalies.length === 0) {
      markdown += `✅ 无异常数据\n\n`;
      continue;
    }

    markdown += `#### 异常详情\n\n`;
    markdown += `| 股票代码 | 持仓数量 | 成本价 | 总成本 | 异常类型 |\n`;
    markdown += `|---------|---------|--------|--------|----------|\n`;

    for (const anomaly of result.anomalies) {
      const warningsSummary = anomaly.warnings.map((w) => {
        if (w.includes('总盈亏%异常')) return '盈亏%异常';
        if (w.includes('成本价异常')) return '成本价异常';
        if (w.includes('市值为负')) return '市值负数';
        if (w.includes('市值为0')) return '市值为0';
        if (w.includes('持仓数量为负')) return '数量负数';
        return '其他';
      }).join(', ');

      markdown += `| ${anomaly.assetCode} | ${anomaly.quantity.toFixed(2)} | ${anomaly.costPrice.toFixed(4)} | ${anomaly.totalCost.toFixed(2)} | ${warningsSummary} |\n`;
    }

    markdown += `\n`;

    // 详细警告信息
    markdown += `#### 详细警告信息\n\n`;
    for (const anomaly of result.anomalies) {
      markdown += `**${anomaly.assetCode}**:\n`;
      anomaly.warnings.forEach((warning) => {
        markdown += `- ${warning}\n`;
      });
      markdown += `\n`;
    }
  }

  markdown += `---\n\n## 修复建议\n\n`;
  markdown += `### 1. 成本价异常\n\n`;
  markdown += `**症状**: 成本价小于 0.01\n\n`;
  markdown += `**可能原因**:\n`;
  markdown += `- 交易记录中价格或数量录入错误\n`;
  markdown += `- 手续费计算错误导致成本异常\n\n`;
  markdown += `**修复方式**:\n`;
  markdown += `- 检查该股票的所有买入交易记录\n`;
  markdown += `- 确认价格、数量、手续费是否正确\n`;
  markdown += `- 通过前端界面删除错误记录，重新添加正确交易\n\n`;

  markdown += `### 2. 盈亏%异常\n\n`;
  markdown += `**症状**: 盈亏% 绝对值超过 1000%\n\n`;
  markdown += `**可能原因**:\n`;
  markdown += `- 成本价过小导致计算结果异常放大\n`;
  markdown += `- 交易记录缺失（如卖出记录缺失导致成本计算错误）\n\n`;
  markdown += `**修复方式**:\n`;
  markdown += `- 先修复成本价异常问题\n`;
  markdown += `- 检查交易记录完整性\n\n`;

  markdown += `### 3. 市值异常\n\n`;
  markdown += `**症状**: 市值为0但有持仓\n\n`;
  markdown += `**可能原因**:\n`;
  markdown += `- 行情数据缺失（如停牌、退市股票）\n`;
  markdown += `- API 调用失败\n\n`;
  markdown += `**修复方式**:\n`;
  markdown += `- 这是正常情况，无需修复\n`;
  markdown += `- 可以手动查询该股票的最新价格\n\n`;

  markdown += `---\n\n## 下一步操作\n\n`;
  markdown += `1. **查看具体异常**: 根据上述报告定位异常持仓\n`;
  markdown += `2. **检查交易记录**: 在前端界面或数据库中查看相关交易\n`;
  markdown += `3. **修正数据**: 删除错误记录，重新录入正确数据\n`;
  markdown += `4. **重新诊断**: 修正后再次运行诊断脚本验证\n\n`;

  return markdown;
}

// 主函数
async function main() {
  try {
    const results = await diagnoseData();
    const report = generateMarkdownReport(results);

    // 保存报告到文件
    const reportPath = join(process.cwd(), 'data-diagnosis-report.md');
    writeFileSync(reportPath, report, 'utf-8');

    console.log('\n' + '='.repeat(60));
    console.log(`✅ 诊断完成！报告已保存到: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    // 关闭数据库连接
    await prisma.$disconnect();
  } catch (error) {
    console.error('诊断过程中发生错误:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// 执行主函数
main();
