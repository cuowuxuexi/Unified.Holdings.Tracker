import { prisma } from '../lib/prisma';
import { container } from '../container';
import { getExchangeRate } from './currencyService';

// ==================== 类型定义 ====================

export interface ReportPosition {
  assetCode: string;
  name: string;
  market: string;
  start: {
    quantity: number;
    price: number;
    marketValue: number;
  } | null;
  end: {
    quantity: number;
    price: number;
    marketValue: number;
  } | null;
  periodPnl: number;
  priceReturn: number | null;
  isCleared: boolean;
}

export interface ReportTransaction {
  date: string;
  type: string;
  assetCode: string;
  assetName: string;
  quantity: number;
  price: number;
  amount: number;
  commission: number;
}

export interface PeriodReport {
  portfolioId: string;
  portfolioName: string;
  period: { from: string; to: string };
  periodType: string; // 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
  portfolio: {
    startNetAssets: number;
    endNetAssets: number;
    netAssetsChange: number;
    periodReturn: number;
    startTotalMarketValue: number;
    endTotalMarketValue: number;
    startCash: number;
    endCash: number;
  };
  costs: {
    commission: number;
    leverageInterest: number;
    total: number;
  };
  exchangeRates: {
    currency: string;
    rate: number;
  }[];
  transactions: ReportTransaction[];
  positions: ReportPosition[];
  meta: {
    snapshotAvailable: boolean;
    startSnapshotDate: string;
    endSnapshotDate: string;
  };
}

// ==================== 服务 ====================

export const periodReportService = {
  /**
   * 生成期间报表核心数据
   */
  async getPeriodReport(
    portfolioId: string,
    from: string,
    to: string,
    periodType: string = 'custom'
  ): Promise<PeriodReport> {
    const portfolio = await container.getPortfolioUseCase.execute({
      portfolioId,
    });
    if (!portfolio) throw new Error(`Portfolio ${portfolioId} not found`);

    // 1. 获取期初期末的组合级别快照
    const portfolioSnapshots = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "PortfolioSnapshot" WHERE "portfolioId" = ? AND "date" >= ? AND "date" <= ? ORDER BY "date" ASC`,
      portfolioId,
      from,
      to
    );

    let startSnapshotDate = from;
    let endSnapshotDate = to;
    const snapshotAvailable = portfolioSnapshots.length > 0;

    let startNetAssets = 0;
    let endNetAssets = 0;
    let startTotalMarketValue = 0;
    let endTotalMarketValue = 0;
    let startCash = 0;
    let endCash = 0;

    if (snapshotAvailable) {
      const first = portfolioSnapshots[0];
      const last = portfolioSnapshots[portfolioSnapshots.length - 1];
      startSnapshotDate = first.date;
      endSnapshotDate = last.date;
      startNetAssets = Number(first.netAssets);
      endNetAssets = Number(last.netAssets);
      startTotalMarketValue = Number(first.totalMarketValue);
      endTotalMarketValue = Number(last.totalMarketValue);
      startCash = Number(first.cash);
      endCash = Number(last.cash);
    }

    // 2. 获取期初期末的个股快照
    const startPositions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "PositionSnapshot" WHERE "portfolioId" = ? AND "date" = ?`,
      portfolioId,
      startSnapshotDate
    );
    const endPositions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "PositionSnapshot" WHERE "portfolioId" = ? AND "date" = ?`,
      portfolioId,
      endSnapshotDate
    );

    // 3. 获取期间交易流水
    const rawTransactions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Transaction" WHERE "portfolioId" = ? AND "date" >= ? AND "date" <= ? ORDER BY "date" ASC`,
      portfolioId,
      startSnapshotDate,
      endSnapshotDate
    );

    // 计算成本和费用
    let commission = 0;
    let leverageInterest = 0;
    const tradeSummary: Record<string, { buys: number; sells: number }> = {};

    // 获取资产基础信息
    const assets = await prisma.asset.findMany();
    const assetDict = Object.fromEntries(assets.map((a: any) => [a.code, a]));

    // 结构化交易记录
    const transactions: ReportTransaction[] = [];

    for (const tx of rawTransactions) {
      commission += Number(tx.commission || 0);
      if (tx.type === 'LEVERAGE_COST') {
        leverageInterest += Number(tx.amount || 0);
      }

      if (tx.assetCode && (tx.type === 'BUY' || tx.type === 'SELL')) {
        if (!tradeSummary[tx.assetCode])
          tradeSummary[tx.assetCode] = { buys: 0, sells: 0 };
        const amount = Number(tx.amount || 0);
        if (tx.type === 'BUY') tradeSummary[tx.assetCode].buys += amount;
        if (tx.type === 'SELL') tradeSummary[tx.assetCode].sells += amount;

        transactions.push({
          date: tx.date,
          type: tx.type,
          assetCode: tx.assetCode,
          assetName: assetDict[tx.assetCode]?.name || tx.assetCode,
          quantity: Number(tx.quantity || 0),
          price: Number(tx.price || 0),
          amount,
          commission: Number(tx.commission || 0),
        });
      }
    }

    // 4. 计算每只股票的期间盈亏
    const positionsMap: Record<string, ReportPosition> = {};
    const assetCodes = new Set([
      ...startPositions.map((p) => p.assetCode),
      ...endPositions.map((p) => p.assetCode),
    ]);

    for (const code of assetCodes) {
      const startSnap = startPositions.find((p) => p.assetCode === code);
      const endSnap = endPositions.find((p) => p.assetCode === code);
      const trades = tradeSummary[code] || { buys: 0, sells: 0 };

      const startMV = startSnap ? Number(startSnap.marketValue) : 0;
      const endMV = endSnap ? Number(endSnap.marketValue) : 0;
      const periodPnl = endMV - startMV + trades.sells - trades.buys;

      let priceReturn = null;
      if (startSnap && endSnap && Number(startSnap.currentPrice) > 0) {
        priceReturn =
          (Number(endSnap.currentPrice) / Number(startSnap.currentPrice) - 1) *
          100;
      }

      const assetDef = assetDict[code];

      positionsMap[code] = {
        assetCode: code,
        name: assetDef?.name || code,
        market: assetDef?.market || 'CN',
        start: startSnap
          ? {
              quantity: Number(startSnap.quantity),
              price: Number(startSnap.currentPrice),
              marketValue: startMV,
            }
          : null,
        end: endSnap
          ? {
              quantity: Number(endSnap.quantity),
              price: Number(endSnap.currentPrice),
              marketValue: endMV,
            }
          : null,
        periodPnl,
        priceReturn,
        isCleared: !endSnap || Number(endSnap.quantity) === 0,
      };
    }

    // 5. 获取当前汇率
    const usdRate = getExchangeRate('USD', 'CNY') ?? 7.25;
    const hkdRate = getExchangeRate('HKD', 'CNY') ?? 0.91;
    const exchangeRates = [
      { currency: 'USD/CNY', rate: usdRate },
      { currency: 'HKD/CNY', rate: hkdRate },
    ];

    // 6. 计算期间资产总变化
    const netAssetsChange = endNetAssets - startNetAssets;
    const periodReturn =
      startNetAssets > 0 ? (netAssetsChange / startNetAssets) * 100 : 0;

    return {
      portfolioId,
      portfolioName: portfolio.name,
      period: { from, to },
      periodType,
      portfolio: {
        startNetAssets,
        endNetAssets,
        netAssetsChange,
        periodReturn,
        startTotalMarketValue,
        endTotalMarketValue,
        startCash,
        endCash,
      },
      costs: {
        commission,
        leverageInterest,
        total: commission + leverageInterest,
      },
      exchangeRates,
      transactions,
      positions: Object.values(positionsMap),
      meta: {
        snapshotAvailable,
        startSnapshotDate,
        endSnapshotDate,
      },
    };
  },

  /**
   * 将报告转换为 Markdown 文本
   */
  formatReportAsMarkdown(report: PeriodReport): string {
    if (!report.meta.snapshotAvailable) {
      return formatNoSnapshotMarkdown(report);
    }

    let md = generateTitle(report);
    let secNum = 1;

    // ---- 一、总资产变化 ----
    md += `## ${cnNum(secNum++)}、总资产变化\n\n`;
    md += `| 指标 | 期初 | 期末 | 变动 |\n|------|-----:|-----:|-----:|\n`;

    const mvChange =
      report.portfolio.endTotalMarketValue -
      report.portfolio.startTotalMarketValue;
    const cashChange = report.portfolio.endCash - report.portfolio.startCash;

    md += `| 总市值 | ${fmtMoney(report.portfolio.startTotalMarketValue)} | ${fmtMoney(report.portfolio.endTotalMarketValue)} | ${fmtMoneyChange(mvChange)} |\n`;
    md += `| 现金 | ${fmtMoney(report.portfolio.startCash)} | ${fmtMoney(report.portfolio.endCash)} | ${fmtMoneyChange(cashChange)} |\n`;
    md += `| 净资产 | ${fmtMoney(report.portfolio.startNetAssets)} | ${fmtMoney(report.portfolio.endNetAssets)} | ${fmtMoneyChange(report.portfolio.netAssetsChange)} |\n`;

    const retSign = report.portfolio.periodReturn >= 0 ? '+' : '';
    md += `| 期间收益率 | | | **${retSign}${report.portfolio.periodReturn.toFixed(2)}%** |\n`;
    md += `\n---\n\n`;

    // ---- 二、费用 ----
    md += `## ${cnNum(secNum++)}、费用\n\n`;
    md += `| 项目 | 金额 |\n|------|-----:|\n`;
    md += `| 手续费 | ${fmtMoney(report.costs.commission)} |\n`;
    md += `| 融资利息 | ${fmtMoney(report.costs.leverageInterest)} |\n`;
    md += `| **合计** | **${fmtMoney(report.costs.total)}** |\n`;
    md += `\n---\n\n`;

    // ---- 持仓明细（按市场分组）----
    const markets = ['CN', 'HK', 'US'];

    for (const market of markets) {
      const posInMarket = report.positions.filter(
        (p) => !p.isCleared && p.market === market
      );
      if (posInMarket.length === 0) continue;

      const title =
        market === 'CN' ? 'A 股' : market === 'HK' ? '港股' : '美股';
      md += `## ${cnNum(secNum++)}、${title}持仓\n\n`;
      md += `| 股票 | 期初价 | 期末价 | 涨跌幅 | 持仓 | 期初市值 | 期末市值 | 期间盈亏 |\n`;
      md += `|------|-------:|-------:|-------:|-----:|---------:|---------:|---------:|\n`;

      let subStartTotal = 0;
      let subEndTotal = 0;
      let subPnlTotal = 0;

      for (const pos of posInMarket) {
        const startPrice = pos.start ? pos.start.price.toFixed(2) : '—';
        const endPrice = pos.end ? pos.end.price.toFixed(2) : '—';
        const ret =
          pos.priceReturn !== null
            ? `${pos.priceReturn >= 0 ? '+' : ''}${pos.priceReturn.toFixed(2)}%`
            : '—';
        const qty = pos.end?.quantity || 0;
        const startMV = pos.start ? pos.start.marketValue : 0;
        const endMV = pos.end ? pos.end.marketValue : 0;

        subStartTotal += startMV;
        subEndTotal += endMV;
        subPnlTotal += pos.periodPnl;

        const startMVStr = pos.start ? fmtMoney(startMV) : '—';
        const endMVStr = pos.end ? fmtMoney(endMV) : '—';

        md += `| ${pos.name} \`${pos.assetCode}\` | ${startPrice} | ${endPrice} | ${ret} | ${qty} | ${startMVStr} | ${endMVStr} | ${fmtMoneyChange(pos.periodPnl)} |\n`;
      }

      md += `| **小计** | | | | | ${fmtMoney(subStartTotal)} | ${fmtMoney(subEndTotal)} | **${fmtMoneyChange(subPnlTotal)}** |\n\n`;
    }

    // ---- 期间交易 ----
    md += `## ${cnNum(secNum++)}、期间交易\n\n`;

    if (report.transactions.length === 0) {
      md += `_本期无交易_\n\n`;
    } else {
      md += `| 日期 | 类型 | 股票 | 数量 | 价格 | 金额(CNY) | 佣金 |\n`;
      md += `|------|:----:|------|-----:|-----:|----------:|-----:|\n`;
      const typeMap: Record<string, string> = {
        BUY: '买入',
        SELL: '卖出',
      };
      for (const tx of report.transactions) {
        md += `| ${tx.date} | ${typeMap[tx.type] || tx.type} | ${tx.assetName} \`${tx.assetCode}\` | ${tx.quantity} | ${tx.price.toFixed(2)} | ${fmtMoney(tx.amount)} | ${fmtMoney(tx.commission)} |\n`;
      }
      md += `\n`;
    }

    // ---- 盈亏贡献排名 ----
    const sortedPos = [...report.positions].sort(
      (a, b) => b.periodPnl - a.periodPnl
    );
    md += `## ${cnNum(secNum++)}、盈亏贡献排名\n\n`;
    md += `| # | 市场 | 股票 | 期间盈亏 | 状态 |\n`;
    md += `|:-:|:----:|------|--------:|:---:|\n`;

    sortedPos.forEach((pos, idx) => {
      const clearedMarker = pos.isCleared ? ' *(已清仓)*' : '';
      md += `| ${idx + 1} | ${pos.market} | ${pos.name}${clearedMarker} | ${fmtMoneyChange(pos.periodPnl)} | ${pos.isCleared ? '清仓' : '在持'} |\n`;
    });

    // ---- 参考汇率 ----
    if (report.exchangeRates.length > 0) {
      md += `\n---\n\n`;
      md += `## 参考汇率\n\n`;
      md += `| 币种 | 当前汇率 |\n|------|--------:|\n`;
      for (const rate of report.exchangeRates) {
        md += `| ${rate.currency} | ${rate.rate.toFixed(4)} |\n`;
      }
    }

    md += `\n---\n*数据来源：${report.meta.startSnapshotDate} 与 ${report.meta.endSnapshotDate} 快照*\n`;

    return md;
  },
};

// ==================== 工具函数 ====================

const CN_NUMS = [
  '〇',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
];
function cnNum(n: number): string {
  if (n <= 10) return CN_NUMS[n];
  if (n < 20) return `十${CN_NUMS[n - 10]}`;
  return n.toString();
}

function fmtMoney(v: number): string {
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoneyChange(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generateTitle(report: PeriodReport): string {
  const { from, to } = report.period;
  const name = report.portfolioName;

  switch (report.periodType) {
    case 'daily': {
      const d = new Date(to);
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const weekday = weekdays[d.getDay()];
      return `# 📊 每日持仓快照 — ${to}（${weekday}）\n\n> 组合：**${name}**\n\n---\n\n`;
    }
    case 'weekly': {
      const d = new Date(to);
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(
        ((d.getTime() - startOfYear.getTime()) / 86400000 +
          startOfYear.getDay() +
          1) /
          7
      );
      return `# 📊 投资组合周报 — 第 ${weekNum} 周\n\n> 组合：**${name}**| 期间：${from} ~ ${to}\n\n---\n\n`;
    }
    case 'monthly': {
      const d = new Date(to);
      return `# 📊 投资组合月报 — ${d.getFullYear()} 年 ${d.getMonth() + 1} 月\n\n> 组合：**${name}**| 期间：${from} ~ ${to}\n\n---\n\n`;
    }
    case 'yearly': {
      const d = new Date(from);
      return `# 📊 投资组合年报 — ${d.getFullYear()} 年度\n\n> 组合：**${name}**| 期间：${from} ~ ${to}\n\n---\n\n`;
    }
    default:
      return `# 📊 投资组合期间报表\n\n> 组合：**${name}**| 期间：${from} ~ ${to}\n\n---\n\n`;
  }
}

function formatNoSnapshotMarkdown(report: PeriodReport): string {
  const { from, to } = report.period;
  let md = generateTitle(report);

  md += `## 一、状态说明\n\n`;
  md += `⚠️ 指定区间内未找到可用仓位快照，无法生成有效期间报表。\n\n`;
  md += `| 项目 | 说明 |\n`;
  md += `|------|------|\n`;
  md += `| 请求区间 | ${from} ~ ${to} |\n`;
  md += `| 快照状态 | 无可用快照 |\n`;
  md += `| 建议处理 | 改用最近两个有快照的交易日，或先排查快照采集链路 |\n`;

  if (report.exchangeRates.length > 0) {
    md += `\n---\n\n`;
    md += `## 参考汇率\n\n`;
    md += `| 币种 | 当前汇率 |\n|------|--------:|\n`;
    for (const rate of report.exchangeRates) {
      md += `| ${rate.currency} | ${rate.rate.toFixed(4)} |\n`;
    }
  }

  md += `\n---\n*数据来源：请求区间 ${from} ~ ${to} 未匹配到任何快照*\n`;
  return md;
}
