/**
 * 汇率验证脚本
 *
 * 功能：
 * 1. 对比后端计算的持仓数据（人民币）和原始数据
 * 2. 检测是否存在汇率重复应用的情况
 * 3. 生成验证报告
 *
 * 使用方法：
 * npm run verify:exchange-rate -w backend
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { buildPositionsUsingLots } from '../services/portfolioReplay';
import type { Position, Transaction } from '../types';
import { Market } from '../types';

// 获取数据目录路径
function getDataDir(): string {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (isDevelopment) {
    // 开发环境：使用项目根目录下的 data 文件夹
    const projectRoot = path.resolve(__dirname, '../../');
    return path.join(projectRoot, 'data');
  } else {
    // 生产环境：使用用户数据目录
    const userDataPath =
      process.env.APPDATA ||
      (process.platform === 'darwin'
        ? path.join(process.env.HOME || '', 'Library', 'Application Support')
        : path.join(process.env.HOME || '', '.local', 'share'));
    return path.join(userDataPath, 'unified-holdings-tracker', 'data');
  }
}

const dataDir = getDataDir();
const dbPath = path.join(dataDir, 'database.db');

console.log('[verifyExchangeRate] 使用数据目录:', dataDir);
console.log('[verifyExchangeRate] 数据库路径:', dbPath);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});

interface VerificationIssue {
  portfolioId: string;
  portfolioName: string;
  assetCode: string;
  assetName: string;
  issue: string;
  details: {
    quantity: number;
    costPrice: number;
    marketValue: number;
    totalCost: number;
    totalPnl?: number;
    totalPnlPercent?: number;
    currency: string;
  };
}

interface VerificationResult {
  portfolioId: string;
  portfolioName: string;
  totalPositions: number;
  issuesFound: VerificationIssue[];
  status: 'ok' | 'warning' | 'error';
}

/**
 * 检查汇率是否被重复应用
 *
 * 检测方法：
 * 1. 比较 totalCostCny 和 totalCostLocal 的比例是否符合预期汇率
 * 2. 检查成本价是否过低（可能被重复除以汇率）
 * 3. 检查盈亏百分比是否异常（可能因汇率问题导致）
 */
function checkExchangeRateIssues(position: Position): VerificationIssue | null {
  const {
    asset,
    quantity,
    costPrice,
    marketValue,
    totalCost,
    totalPnl,
    totalPnlPercent,
  } = position;

  if (!asset || !quantity || quantity === 0) return null;

  const currency = asset.code?.startsWith('hk')
    ? 'HKD'
    : asset.code?.startsWith('us')
      ? 'USD'
      : 'CNY';

  const issues: string[] = [];

  // 检查1：成本价是否异常（港股应该在几十到几百范围，美股通常几十到几百美元）
  if (currency === 'HKD' && costPrice && costPrice < 1) {
    issues.push(`成本价过低 (${costPrice.toFixed(4)} CNY)，可能被错误地缩小了`);
  }

  if (currency === 'USD' && costPrice && costPrice < 1) {
    issues.push(`成本价过低 (${costPrice.toFixed(4)} CNY)，可能被错误地缩小了`);
  }

  // 检查2：盈亏百分比是否异常（绝对值超过1000%）
  if (totalPnlPercent !== undefined && totalPnlPercent !== null) {
    const percentValue = Math.abs(totalPnlPercent);
    if (percentValue > 1000) {
      // 1000 表示 1000%
      issues.push(`总盈亏%异常 (${totalPnlPercent.toFixed(2)}%)，远超正常范围`);
    }
  }

  // 检查3：市值与成本价的关系是否合理
  if (marketValue && totalCost && marketValue > 0 && totalCost > 0) {
    const ratio = marketValue / totalCost;
    // 如果市值和总成本相差超过100倍，可能有问题
    if (ratio > 100 || ratio < 0.01) {
      issues.push(`市值/总成本比例异常 (${ratio.toFixed(2)})，数据可能不一致`);
    }
  }

  if (issues.length === 0) return null;

  return {
    portfolioId: '', // 将在调用处填充
    portfolioName: '', // 将在调用处填充
    assetCode: asset.code || 'unknown',
    assetName: asset.name || 'unknown',
    issue: issues.join('; '),
    details: {
      quantity,
      costPrice: costPrice || 0,
      marketValue: marketValue || 0,
      totalCost: totalCost || 0,
      totalPnl: totalPnl || 0,
      totalPnlPercent: totalPnlPercent || 0,
      currency,
    },
  };
}

/**
 * 验证单个投资组合的持仓数据
 */
async function verifyPortfolio(
  portfolioId: string
): Promise<VerificationResult> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    include: { transactions: true },
  });

  if (!portfolio) {
    throw new Error(`Portfolio not found: ${portfolioId}`);
  }

  // 将 Prisma 交易转换为应用层 Transaction 类型
  const transactions = portfolio.transactions.map((tx) => ({
    id: tx.id,
    date: tx.date.toISOString(),
    type: tx.type,
    assetCode: tx.assetCode ?? undefined,
    quantity: tx.quantity ? Number(tx.quantity) : undefined,
    price: tx.price ? Number(tx.price) : undefined,
    amount: tx.amount ? Number(tx.amount) : undefined,
    commission: tx.commission ? Number(tx.commission) : undefined,
    leverageUsed: tx.leverageUsed ? Number(tx.leverageUsed) : undefined,
    exchangeRate: tx.exchangeRate ? Number(tx.exchangeRate) : undefined,
    currency: tx.currency ?? undefined,
    notes: tx.notes ?? undefined,
  }));

  // 使用批次系统重建持仓
  const lotPositions = buildPositionsUsingLots(
    transactions as unknown as Transaction[]
  );

  // 推断市场类型
  function inferMarket(assetCode: string): Market {
    const prefix = assetCode.slice(0, 2).toLowerCase();
    if (prefix === 'hk') return Market.HK;
    if (prefix === 'us') return Market.US;
    return Market.CN;
  }

  const positionsArray = Array.from(lotPositions.values()).map((state) => ({
    asset: {
      code: state.assetCode,
      name: state.assetCode, // 使用 assetCode 作为临时名称
      market: inferMarket(state.assetCode),
    },
    quantity: state.quantity,
    costPrice: state.totalCostCny / state.quantity,
    currentPrice: undefined, // 没有行情数据
    marketValue: 0, // 没有行情数据
    totalCost: state.totalCostCny,
    totalCostLocal: state.totalCostLocal,
  })) as Position[];

  // 检查每个持仓
  const issuesFound: VerificationIssue[] = [];

  for (const position of positionsArray) {
    const issue = checkExchangeRateIssues(position);
    if (issue) {
      issue.portfolioId = portfolio.id;
      issue.portfolioName = portfolio.name;
      issuesFound.push(issue);
    }
  }

  // 确定状态
  let status: 'ok' | 'warning' | 'error' = 'ok';
  if (issuesFound.length > 0) {
    // 如果有超过3个问题，标记为error
    status = issuesFound.length > 3 ? 'error' : 'warning';
  }

  return {
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    totalPositions: positionsArray.length,
    issuesFound,
    status,
  };
}

/**
 * 验证所有投资组合
 */
async function verifyAllPortfolios(): Promise<VerificationResult[]> {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, name: true },
  });

  console.log(`\n找到 ${portfolios.length} 个投资组合\n`);

  const results: VerificationResult[] = [];

  for (const portfolio of portfolios) {
    console.log(`验证投资组合: ${portfolio.name} (${portfolio.id})`);
    const result = await verifyPortfolio(portfolio.id);
    results.push(result);

    if (result.status === 'ok') {
      console.log(`✅ 无问题`);
    } else if (result.status === 'warning') {
      console.log(`⚠️  发现 ${result.issuesFound.length} 个潜在问题`);
    } else {
      console.log(`❌ 发现 ${result.issuesFound.length} 个严重问题`);
    }
  }

  return results;
}

/**
 * 生成 Markdown 格式的验证报告
 */
function generateMarkdownReport(results: VerificationResult[]): string {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let report = `# 汇率验证报告\n\n`;
  report += `**生成时间**: ${timestamp}\n\n`;
  report += `---\n\n`;

  // 总览
  const totalPortfolios = results.length;
  const okCount = results.filter((r) => r.status === 'ok').length;
  const warningCount = results.filter((r) => r.status === 'warning').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const totalIssues = results.reduce((sum, r) => sum + r.issuesFound.length, 0);

  report += `## 总览\n\n`;
  report += `- **投资组合总数**: ${totalPortfolios}\n`;
  report += `- **✅ 无问题**: ${okCount}\n`;
  report += `- **⚠️  有警告**: ${warningCount}\n`;
  report += `- **❌ 有错误**: ${errorCount}\n`;
  report += `- **问题总数**: ${totalIssues}\n\n`;
  report += `---\n\n`;

  // 详细报告
  for (const result of results) {
    report += `## ${result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌'} ${result.portfolioName}\n\n`;
    report += `- **ID**: ${result.portfolioId}\n`;
    report += `- **持仓数量**: ${result.totalPositions}\n`;
    report += `- **问题数量**: ${result.issuesFound.length}\n\n`;

    if (result.issuesFound.length > 0) {
      report += `### 发现的问题\n\n`;

      for (const issue of result.issuesFound) {
        report += `#### ${issue.assetCode} - ${issue.assetName}\n\n`;
        report += `**问题**: ${issue.issue}\n\n`;
        report += `**详细数据**:\n`;
        report += `- 货币: ${issue.details.currency}\n`;
        report += `- 数量: ${issue.details.quantity}\n`;
        report += `- 成本价: ${issue.details.costPrice.toFixed(4)} CNY\n`;
        report += `- 总成本: ${issue.details.totalCost.toFixed(2)} CNY\n`;
        report += `- 市值: ${issue.details.marketValue.toFixed(2)} CNY\n`;
        if (issue.details.totalPnl !== undefined) {
          report += `- 总盈亏: ${issue.details.totalPnl.toFixed(2)} CNY\n`;
        }
        if (issue.details.totalPnlPercent !== undefined) {
          report += `- 总盈亏%: ${issue.details.totalPnlPercent.toFixed(2)}%\n`;
        }
        report += `\n`;
      }
    }

    report += `---\n\n`;
  }

  // 建议
  report += `## 修复建议\n\n`;
  if (totalIssues === 0) {
    report += `✅ 所有持仓数据正常，未发现汇率重复应用问题。\n\n`;
  } else {
    report += `如果发现问题，请检查：\n\n`;
    report += `1. **前端组件**: 确保 MarketAssetsPanel.tsx 不对后端数据再次乘以汇率\n`;
    report += `2. **后端计算**: 确保 calculationService.ts 中的汇率只应用一次\n`;
    report += `3. **批次系统**: 确保 portfolioReplay.ts 中的成本计算正确\n`;
    report += `4. **数据源**: 检查交易记录中的汇率字段是否正确\n\n`;
  }

  return report;
}

/**
 * 主函数
 */
async function main() {
  console.log('============================================================');
  console.log('开始汇率验证...');
  console.log('============================================================\n');

  try {
    const results = await verifyAllPortfolios();

    // 生成报告
    const report = generateMarkdownReport(results);
    const reportPath = path.join(
      dataDir,
      'exchange-rate-verification-report.md'
    );
    fs.writeFileSync(reportPath, report, 'utf-8');

    console.log(
      '\n============================================================'
    );
    console.log(`✅ 验证完成！报告已保存到: ${reportPath}`);
    console.log(
      '============================================================\n'
    );
  } catch (error) {
    console.error('验证失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行主函数
main();
