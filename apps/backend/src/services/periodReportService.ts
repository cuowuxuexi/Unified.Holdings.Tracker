import { prisma } from '../lib/prisma';
import { container } from '../container';
import { format } from 'date-fns';

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

export interface PeriodReport {
  portfolioId: string;
  period: { from: string; to: string };
  portfolio: {
    startNetAssets: number;
    endNetAssets: number;
    netAssetsChange: number;
    periodReturn: number;
  };
  costs: {
    commission: number;
    leverageInterest: number;
    total: number;
  };
  exchangeRates: {
    currency: string;
    startRate: number;
    endRate: number;
    change: number;
    impact: number;
  }[];
  positions: ReportPosition[];
  meta: {
    snapshotAvailable: boolean;
    startSnapshotDate: string;
    endSnapshotDate: string;
  };
}

export const periodReportService = {
  /**
   * 生成期间报表核心数据
   */
  async getPeriodReport(
    portfolioId: string,
    from: string,
    to: string
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

    if (snapshotAvailable) {
      const first = portfolioSnapshots[0];
      const last = portfolioSnapshots[portfolioSnapshots.length - 1];
      startSnapshotDate = first.date;
      endSnapshotDate = last.date;
      startNetAssets = Number(first.netAssets);
      endNetAssets = Number(last.netAssets);
    } else {
      // 没有任何快照，用当前的最新数据代替（退化模式）
      const stats = container.portfolioStatsService;
      // ... 可以在这里获取实时, 这里简化为0
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
    const transactions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Transaction" WHERE "portfolioId" = ? AND "date" >= ? AND "date" <= ?`,
      portfolioId,
      startSnapshotDate,
      endSnapshotDate
    );

    // 计算成本和费用
    let commission = 0;
    let leverageInterest = 0;

    // 按股票聚合买卖
    const tradeSummary: Record<string, { buys: number; sells: number }> = {};

    for (const tx of transactions) {
      // 费用
      commission += Number(tx.commission || 0);
      if (tx.type === 'LEVERAGE_COST') {
        leverageInterest += Number(tx.amount || 0); // 都是正数花费
      }

      // 股票买卖金额(含佣金)
      if (tx.assetCode && (tx.type === 'BUY' || tx.type === 'SELL')) {
        if (!tradeSummary[tx.assetCode])
          tradeSummary[tx.assetCode] = { buys: 0, sells: 0 };
        const amount = Number(tx.amount || 0);
        if (tx.type === 'BUY') tradeSummary[tx.assetCode].buys += amount;
        if (tx.type === 'SELL') tradeSummary[tx.assetCode].sells += amount;
      }
    }

    // 4. 计算每只股票的期间盈亏
    const positionsMap: Record<string, ReportPosition> = {};
    const assetCodes = new Set([
      ...startPositions.map((p) => p.assetCode),
      ...endPositions.map((p) => p.assetCode),
    ]);

    // 获取资产基础信息
    const assets = await prisma.asset.findMany();
    const assetDict = Object.fromEntries(assets.map((a: any) => [a.code, a]));

    for (const code of assetCodes) {
      const startSnap = startPositions.find((p) => p.assetCode === code);
      const endSnap = endPositions.find((p) => p.assetCode === code);
      const trades = tradeSummary[code] || { buys: 0, sells: 0 };

      const startMV = startSnap ? Number(startSnap.marketValue) : 0;
      const endMV = endSnap ? Number(endSnap.marketValue) : 0;

      // 期间盈亏 = (期末市值 - 期初市值) + 期间卖出得到 - 期间买入花费
      const periodPnl = endMV - startMV + trades.sells - trades.buys;

      // 纯价格回报
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

    // 计算期间资产总变化
    const netAssetsChange = endNetAssets - startNetAssets;
    const periodReturn =
      startNetAssets > 0 ? (netAssetsChange / startNetAssets) * 100 : 0;

    return {
      portfolioId,
      period: { from, to },
      portfolio: {
        startNetAssets,
        endNetAssets,
        netAssetsChange,
        periodReturn,
      },
      costs: {
        commission,
        leverageInterest,
        total: commission + leverageInterest,
      },
      exchangeRates: [], // 简化处理，暂时留空或日后从独立汇率服务拿
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
    const { from, to } = report.period;

    let md = `# 📊 投资组合期间报表\n`;
    md += `> 期间：${from} ~ ${to}\n\n---\n\n`;

    // 组合概览
    md += `## 一、组合概览\n\n`;
    md += `| 指标 | 数值 |\n|------|-----:|\n`;
    md += `| 期初净资产 | ¥${report.portfolio.startNetAssets.toFixed(2)} |\n`;
    md += `| 期末净资产 | ¥${report.portfolio.endNetAssets.toFixed(2)} |\n`;
    const pnlSign = report.portfolio.netAssetsChange >= 0 ? '+' : '';
    md += `| 期间盈亏 | **${pnlSign}¥${report.portfolio.netAssetsChange.toFixed(2)}** |\n`;
    md += `| 期间收益率 | **${pnlSign}${report.portfolio.periodReturn.toFixed(2)}%** |\n`;
    md += `\n---\n\n`;

    // 费用
    md += `## 二、费用\n\n`;
    md += `| 项目 | 金额 |\n|------|-----:|\n`;
    md += `| 手续费 | ¥${report.costs.commission.toFixed(2)} |\n`;
    md += `| 融资利息 | ¥${report.costs.leverageInterest.toFixed(2)} |\n`;
    md += `| **合计** | **¥${report.costs.total.toFixed(2)}** |\n`;
    md += `\n---\n\n`;

    // 持仓 - 按市场分组
    const markets = ['CN', 'HK', 'US'];
    let sectionIdx = 3;

    for (const market of markets) {
      const posInMarket = report.positions.filter(
        (p) => !p.isCleared && p.market === market
      );
      if (posInMarket.length === 0) continue;

      const title =
        market === 'CN' ? 'A 股' : market === 'HK' ? '港股' : '美股';
      md += `## ${['三', '四', '五', '六'][sectionIdx - 3]}、${title}持仓\n\n`;
      md += `| 股票 | 期初价 | 期末价 | 涨跌幅 | 持仓 | 期初市值(CNY) | 期末市值(CNY) | 期间盈亏 |\n`;
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

        const startMVStr = pos.start ? `¥${startMV.toFixed(2)}` : '—';
        const endMVStr = pos.end ? `¥${endMV.toFixed(2)}` : '—';
        const pPnlSign = pos.periodPnl >= 0 ? '+' : '';

        md += `| ${pos.name} \`${pos.assetCode}\` | ${startPrice} | ${endPrice} | ${ret} | ${qty} | ${startMVStr} | ${endMVStr} | ${pPnlSign}¥${pos.periodPnl.toFixed(2)} |\n`;
      }

      const sPnlSign = subPnlTotal >= 0 ? '+' : '';
      md += `| **小计** | | | | | ¥${subStartTotal.toFixed(2)} | ¥${subEndTotal.toFixed(2)} | **${sPnlSign}¥${subPnlTotal.toFixed(2)}** |\n\n`;
      sectionIdx++;
    }

    // 盈亏贡献排名
    const sortedPos = [...report.positions].sort(
      (a, b) => b.periodPnl - a.periodPnl
    );
    md += `## ${['三', '四', '五', '六'][sectionIdx - 3]}、盈亏贡献排名\n\n`;
    md += `| # | 市场 | 股票 | 期间盈亏 | 状态 |\n`;
    md += `|:-:|:----:|------|--------:|:---:|\n`;

    sortedPos.forEach((pos, idx) => {
      const pSign = pos.periodPnl >= 0 ? '+' : '';
      const clearedMarker = pos.isCleared ? ' *(已清仓)*' : '';
      md += `| ${idx + 1} | ${pos.market} | ${pos.name}${clearedMarker} | ${pSign}¥${pos.periodPnl.toFixed(2)} | ${pos.isCleared ? '清仓' : '在持'} |\n`;
    });

    md += `\n---\n*数据来源：${report.meta.startSnapshotDate} 与 ${report.meta.endSnapshotDate} 快照*\n`;

    return md;
  },
};
