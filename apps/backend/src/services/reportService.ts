import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  PortfolioDetail,
  Position,
  Transaction,
  TransactionType,
  Market,
} from '../types';
import { fetchQuotes } from './tencentApi';

interface AttentionItemPayload {
  id?: string;
  icon?: string;
  title?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AttentionPayload {
  items?: AttentionItemPayload[];
}

/**
 * 报表生成服务
 */
export class ReportService {
  /**
   * 生成 Markdown 格式的投资组合报表
   */
  async generateMarkdownReport(
    portfolioDetail: PortfolioDetail,
    includeMarketIndex: boolean = true
  ): Promise<string> {
    const timestamp = format(new Date(), 'yyyy/MM/dd HH:mm:ss', {
      locale: zhCN,
    });
    const dateOnly = format(new Date(), 'yyyy/MM/dd', { locale: zhCN });

    let markdown = '';

    // 1. 市场指数部分
    if (includeMarketIndex) {
      const marketIndexSection = await this.generateMarketIndexSection();
      if (marketIndexSection) {
        markdown += marketIndexSection + '\n\n';
      }
    }

    // 2. 投资组合综合概览
    markdown += this.generatePortfolioOverviewSection(
      portfolioDetail,
      dateOnly
    );
    markdown += '\n\n';

    // 3. 核心投资指标
    markdown += this.generateCoreIndicatorsSection(portfolioDetail, timestamp);
    markdown += '\n\n';

    // 4. 周期收益
    markdown += this.generatePeriodReturnsSection(portfolioDetail);
    markdown += '\n\n';

    // 5. 各市场持仓
    markdown += this.generateHoldingsSection(portfolioDetail);
    markdown += '\n\n';

    // 5. 交易记录
    markdown += this.generateTransactionsSection(portfolioDetail.transactions);

    return markdown;
  }

  /**
   * 生成市场指数部分
   */
  private async generateMarketIndexSection(): Promise<string | null> {
    try {
      const indexCodes = [
        'sh000001', // 上证指数
        'sz399001', // 深证成指
        'sz399006', // 创业板指
        'usIXIC', // 纳斯达克
        'usDJI', // 道琼斯
        'hkHSI', // 恒生指数
      ];

      const quotes = await fetchQuotes(indexCodes);
      if (!quotes || quotes.length === 0) {
        return null;
      }

      let section = '## **1. 市场指数**\n\n';
      section +=
        '| 指数名称 | 当前值 | 日涨跌 | 日涨跌幅 | W涨幅 | M涨幅 | Y涨幅 |\n';
      section +=
        '| :------ | :----- | :----- | :------ | :---- | :---- | :---- |\n';

      for (const quote of quotes) {
        const indexName = this.getIndexName(quote.code);
        const currentValue = quote.currentPrice?.toFixed(2) || 'N/A';
        const changeAmount = quote.changeAmount?.toFixed(2) || '0.00';
        // changePercent 存储为小数形式（0.0221 = 2.21%），需要乘以100后再格式化
        const changePercent = quote.changePercent
          ? (quote.changePercent * 100).toFixed(2)
          : '0.00';
        const changeArrow = parseFloat(changePercent) >= 0 ? '▲' : '▼';
        const weekChange = quote.weekChangePercent
          ? `W${this.formatPercentWithSign(quote.weekChangePercent)}`
          : 'N/A';
        const monthChange = quote.monthChangePercent
          ? `M${this.formatPercentWithSign(quote.monthChangePercent)}`
          : 'N/A';
        const yearChange = quote.yearChangePercent
          ? `Y${this.formatPercentWithSign(quote.yearChangePercent)}`
          : 'N/A';

        section += `| ${indexName} | ${currentValue} | ${changeAmount} | ${changePercent}% ${changeArrow} | ${weekChange} | ${monthChange} | ${yearChange} |\n`;
      }

      return section;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(
        '[ReportService] Failed to generate market index section:',
        error
      );
      return null;
    }
  }

  /**
   * 生成投资组合综合概览部分
   */
  private generatePortfolioOverviewSection(
    detail: PortfolioDetail,
    date: string
  ): string {
    const leverage = detail.leverage;

    // 计算净入金：优先使用后端已计算好的 netDepositedCash，确保与前端/统计接口一致
    const netDeposit =
      typeof detail.netDepositedCash === 'number'
        ? detail.netDepositedCash
        : this.calculateNetDeposit(detail.transactions);
    const usedCash = detail.initialCash - detail.cash;
    // 杠杆比例 = 已用杠杆 / 总资产（与前端显示一致）
    const leverageRatio =
      detail.totalAssets > 0
        ? ((leverage.usedAmount / detail.totalAssets) * 100).toFixed(2)
        : '0.00';

    let section = `## **2. 投资组合综合概览 - ${date}** (汇率折算 CNY)\n\n`;
    section += '**2.1 资金与资产**\n\n';
    section += '| 项目 | 金额/比例 | 备注 |\n';
    section += '| :--- | :-------- | :--- |\n';
    section += `| **现金信息** |  |  |\n`;
    section += `| 净入金 | ${netDeposit.toFixed(2)} |  |\n`;
    section += `| 可用现金 | ${detail.cash.toFixed(2)} |  |\n`;
    section += `| 已用现金 | ${usedCash.toFixed(2)} |  |\n`;
    section += `| **融资信息** |  |  |\n`;
    section += `| 总额度 | ${leverage.totalAmount.toFixed(2)} |  |\n`;
    section += `| 已用 | ${leverage.usedAmount.toFixed(2)} |  |\n`;
    section += `| 杠杆比例 | ${leverageRatio}% |  |\n`;
    section += `| **资产信息** |  |  |\n`;
    section += `| 总资产 | ${detail.totalAssets.toFixed(2)} |  |\n`;
    section += `| 总市值 | ${detail.totalMarketValue.toFixed(2)} |  |\n`;
    section += `| 净资产 | ${detail.netAssets.toFixed(2)} |  |\n\n`;

    // 2.2 盈亏与成本
    // 手续费与融资成本优先使用后端统一计算结果，保证与统计接口一致
    const totalCommission =
      typeof detail.totalCommission === 'number'
        ? detail.totalCommission
        : this.calculateTotalCommission(detail.transactions);
    const leverageCost =
      typeof detail.leverageCost === 'number'
        ? detail.leverageCost
        : this.calculateLeverageCost(detail.transactions);
    const leverageCostPeriod = this.getLeverageCostPeriod(detail.transactions);

    section += `**2.2 盈亏与成本**\n\n`;
    section += `| 项目 | 金额/比例 | 备注 |\n`;
    section += `| :--- | :-------- | :--- |\n`;
    section += `| **盈亏信息** |  |  |\n`;
    section += `| 当日盈亏 | ${this.formatNumberWithSign(detail.dailyPnl || 0)} |  |\n`;
    section += `| 总盈亏 | ${this.formatNumberWithSign(detail.totalPnl || 0)} |  |\n`;
    section += `| 收益率 | ${this.formatPercentWithSign(detail.totalPnlPercent || 0)} |  |\n`;
    section += `| **成本与费用** |  |  |\n`;
    section += `| 融资成本 | ${leverageCost.toFixed(2)} | 融资成本 |\n`;
    section += `| 融资成本区间 | ${leverageCostPeriod} |  |\n`;
    section += `| 交易手续费合计 | ${totalCommission.toFixed(2)} | 手续费合计 |\n\n`;

    // 注意信息
    section += this.formatAttentionSection(detail.attentionInfo);

    return section;
  }

  /**
   * 生成核心投资指标部分
   */
  private generateCoreIndicatorsSection(
    detail: PortfolioDetail,
    timestamp: string
  ): string {
    const totalDividend = this.calculateTotalDividend(detail.transactions);
    const leverage = detail.leverage;
    // 杠杆比例 = 已用杠杆 / 总资产（与前端显示一致）
    const leverageRatio =
      detail.totalAssets > 0
        ? ((leverage.usedAmount / detail.totalAssets) * 100).toFixed(2)
        : '0.00';

    // 获取汇率信息
    const usdRate = 7.2886; // 默认汇率，实际应从 API 获取
    const hkdRate = 0.9394; // 默认汇率，实际应从 API 获取

    // 计算总市值较昨日变化百分比
    const marketValueChange =
      detail.totalMarketValue > 0
        ? ((detail.dailyPnl || 0) / detail.totalMarketValue) * 100
        : 0;
    const marketValueChangeStr = this.formatPercentWithSign(
      marketValueChange,
      1
    );
    const marketValueArrow = marketValueChange >= 0 ? '↑' : '↓';

    // 计算总盈亏较昨日变化百分比
    const totalPnlChange =
      (detail.totalPnl || 0) !== 0
        ? ((detail.dailyPnl || 0) / Math.abs(detail.totalPnl || 1)) * 100
        : 0;
    const totalPnlChangeStr = this.formatPercentWithSign(totalPnlChange, 1);
    const totalPnlArrow = totalPnlChange >= 0 ? '↑' : '↓';

    let section = '## **3. 核心投资指标**\n\n';
    section += '| 指标 | 金额/比例 | 备注 |\n';
    section += '| :--- | :-------- | :--- |\n';
    section += `| 总市值 (CNY) | ¥${detail.totalMarketValue.toFixed(2)} | ${marketValueChangeStr} ${marketValueArrow} 较昨日变化 |\n`;
    section += `| 总盈亏 (CNY) | ¥${this.formatNumberWithSign(detail.totalPnl || 0)} | ${totalPnlChangeStr} ${totalPnlArrow} 较昨日变化 |\n`;
    section += `| 当前股息收入 (CNY) | ¥${totalDividend.toFixed(2)} | 累计获得 |\n`;
    section += `| **资金状况** |  |  |\n`;
    section += `| 可用现金 | ${detail.cash.toFixed(2)} |  |\n`;
    section += `| 已用杠杆 | ${leverage.usedAmount.toFixed(2)} |  |\n`;
    section += `| 杠杆比例 | ${leverageRatio}% |  |\n\n`;

    section += `*汇率：1 USD = ${usdRate} CNY, 1 HKD = ${hkdRate} CNY（更新时间: ${timestamp}）*\n`;

    return section;
  }

  /**
   * 生成周期收益部分
   */
  private generatePeriodReturnsSection(detail: PortfolioDetail): string {
    console.log('[ReportService] 生成周期收益部分');
    console.log(
      '[ReportService] weeklyStats:',
      JSON.stringify(detail.weeklyStats, null, 2)
    );
    console.log(
      '[ReportService] monthlyStats:',
      JSON.stringify(detail.monthlyStats, null, 2)
    );

    let section = '## **4. 周期收益**\n\n';
    section +=
      '| 周期 | 净值变化 | 净值变化率 | 投资收益率 | 基准日期 | 数据来源 |\n';
    section +=
      '| :--- | :--------- | :----------- | :--------- | :------- | :------- |\n';

    // 周度收益
    if (detail.weeklyStats) {
      const ws = detail.weeklyStats;
      // 检查是否有数据
      if (
        ws.totalValueChange !== null &&
        ws.totalValueChange !== undefined &&
        ws.totalValueChangePercent !== null &&
        ws.totalValueChangePercent !== undefined
      ) {
        const valueChange = this.formatNumberWithSign(ws.totalValueChange);
        const valueChangePercent = this.formatPercentWithSign(
          ws.totalValueChangePercent * 100
        );
        const periodReturn =
          ws.periodReturnPercent !== null
            ? this.formatPercentWithSign(ws.periodReturnPercent * 100)
            : 'N/A';
        const baseDate = ws.baseDate || 'N/A';
        const source = this.getSourceLabel(ws.baseDateSource);
        section += `| 周度 | ${valueChange} | ${valueChangePercent} | ${periodReturn} | ${baseDate} | ${source} |\n`;
      } else {
        section += `| 周度 | N/A | N/A | N/A | 数据缺失 | - |\n`;
      }
    } else {
      section += `| 周度 | N/A | N/A | N/A | 数据缺失 | - |\n`;
    }

    // 月度收益
    if (detail.monthlyStats) {
      const ms = detail.monthlyStats;
      // 检查是否有数据
      if (
        ms.totalValueChange !== null &&
        ms.totalValueChange !== undefined &&
        ms.totalValueChangePercent !== null &&
        ms.totalValueChangePercent !== undefined
      ) {
        const valueChange = this.formatNumberWithSign(ms.totalValueChange);
        const valueChangePercent = this.formatPercentWithSign(
          ms.totalValueChangePercent * 100
        );
        const periodReturn =
          ms.periodReturnPercent !== null
            ? this.formatPercentWithSign(ms.periodReturnPercent * 100)
            : 'N/A';
        const baseDate = ms.baseDate || 'N/A';
        const source = this.getSourceLabel(ms.baseDateSource);
        section += `| 月度 | ${valueChange} | ${valueChangePercent} | ${periodReturn} | ${baseDate} | ${source} |\n`;
      } else {
        section += `| 月度 | N/A | N/A | N/A | 数据缺失 | - |\n`;
      }
    } else {
      section += `| 月度 | N/A | N/A | N/A | 数据缺失 | - |\n`;
    }

    section +=
      '\n*说明：净值变化包含存取款影响，投资收益率排除存取款影响，仅反映投资表现（净值=总资产-已用杠杆）*\n';

    return section;
  }

  /**
   * 获取数据来源标签
   */
  private getSourceLabel(source?: string): string {
    switch (source) {
      case 'realtime':
        return '实时行情';
      case 'kline':
        return 'K线数据';
      case 'cost':
        return '成本估值';
      default:
        return '-';
    }
  }

  /**
   * 生成持仓部分
   */
  private generateHoldingsSection(detail: PortfolioDetail): string {
    const { positions } = detail;

    // 按市场分组
    const cnPositions = positions.filter((p) => p.asset.market === Market.CN);
    const hkPositions = positions.filter((p) => p.asset.market === Market.HK);
    const usPositions = positions.filter((p) => p.asset.market === Market.US);

    // 计算全局总市值（CNY），用于占比计算
    // positions 中的 marketValue 已经是 CNY 计价，直接累加即可
    const globalTotalMarketValueCny = positions.reduce(
      (sum, p) => sum + (p.marketValue || 0),
      0
    );

    let section = '';

    // A股持仓
    section += this.generateMarketHoldingsTable(
      'A股持仓',
      cnPositions,
      'CNY',
      4,
      globalTotalMarketValueCny
    );
    section += '\n\n';

    // 港股持仓
    section += this.generateMarketHoldingsTable(
      '港股持仓',
      hkPositions,
      'HKD',
      5,
      globalTotalMarketValueCny
    );
    section += '\n\n';

    // 美股持仓
    section += this.generateMarketHoldingsTable(
      '美股持仓',
      usPositions,
      'USD',
      6,
      globalTotalMarketValueCny
    );

    return section;
  }

  /**
   * 生成单个市场的持仓表格
   */
  private generateMarketHoldingsTable(
    title: string,
    positions: Position[],
    currency: string,
    sectionNum: number,
    globalTotalMarketValueCny: number
  ): string {
    // 辅助函数：获取原币种市值（非CNY资产使用marketValueLocal）
    const getLocalMarketValue = (p: Position): number => {
      if (currency !== 'CNY' && p.marketValueLocal !== undefined) {
        return p.marketValueLocal;
      }
      return p.marketValue || 0;
    };

    // 辅助函数：获取原币种盈亏（非CNY资产使用totalPnlLocal）
    const getLocalPnl = (p: Position): number => {
      if (currency !== 'CNY' && p.totalPnlLocal !== undefined) {
        return p.totalPnlLocal;
      }
      return p.totalPnl || 0;
    };

    // 辅助函数：获取原币种当日盈亏（非CNY资产使用dailyChangeLocal）
    const getLocalDailyChange = (p: Position): number => {
      if (currency !== 'CNY' && p.dailyChangeLocal !== undefined) {
        return p.dailyChangeLocal;
      }
      return p.dailyChange || 0;
    };

    // 使用原币种计算总市值和总盈亏
    const totalMarketValue = positions.reduce(
      (sum, p) => sum + getLocalMarketValue(p),
      0
    );
    const totalPnl = positions.reduce((sum, p) => sum + getLocalPnl(p), 0);

    // CNY总市值（用于显示约等于多少人民币）
    const totalMarketValueCny = positions.reduce(
      (sum, p) => sum + (p.marketValue || 0),
      0
    );
    const totalPnlCny = positions.reduce(
      (sum, p) => sum + (p.totalPnl || 0),
      0
    );

    // 货币转换率（用于占比计算）
    const currencyToCny =
      currency === 'HKD' ? 0.9394 : currency === 'USD' ? 7.2886 : 1;

    let section = `**${sectionNum}. ${title}**\n`;
    section += `*总市值: ${currency === 'CNY' ? '¥' : currency === 'HKD' ? 'HK$' : '$'}${totalMarketValue.toFixed(2)}`;

    if (currency !== 'CNY') {
      // 使用已计算好的CNY市值，避免二次转换
      section += ` (约 ¥${totalMarketValueCny.toFixed(2)})`;
    }
    section += ` | 总盈亏: ${currency === 'CNY' ? '¥' : currency === 'HKD' ? 'HK$' : '$'}${totalPnl.toFixed(2)}*\n\n`;

    if (positions.length === 0) {
      section +=
        '| 名称 | 数量 | 摊薄/成本 | 现价 | 市值 | 占比% | 当日盈亏 | 当日盈亏% | 总盈亏 | 总盈亏% | 周期涨幅 |\n';
      section +=
        '| :--- | :--- | :----- | :--- | :--- | :---- | :------- | :-------- | :----- | :------ | :------- |\n';
      section += '| \\multicolumn{11}{|c|}{*无数据*} |\n';
      return section;
    }

    section +=
      '| 名称 | 数量 | 摊薄/成本 | 现价 | 市值 | 占比% | 当日盈亏 | 当日盈亏% | 总盈亏 | 总盈亏% | 周期涨幅 |\n';
    section +=
      '| :--- | :--- | :----- | :--- | :--- | :---- | :------- | :-------- | :----- | :------ | :------- |\n';

    for (const pos of positions) {
      const name = this.sanitizeMarkdownText(pos.asset.name || pos.asset.code);
      const quantity = pos.quantity.toFixed(0);
      // 摊薄/成本：根据币种选择原币种价格或 CNY 价格
      const isCNY = currency === 'CNY';
      const dilutedPrice = isCNY ? pos.dilutedPrice : pos.dilutedPriceLocal;
      const costPrice = isCNY ? pos.costPrice : pos.costPriceLocal;
      const formatPrice = (price: number | undefined): string => {
        if (price === undefined || price === null) return '-';
        const decimals = Math.abs(price) < 10 ? 3 : 2;
        return price.toFixed(decimals);
      };
      const dilutedCostStr = `${formatPrice(dilutedPrice)}/${formatPrice(costPrice)}`;
      const currentPrice = pos.currentPrice?.toFixed(2) || '0.00';
      // 使用原币种市值显示
      const posLocalMarketValue = getLocalMarketValue(pos);
      const marketValue = posLocalMarketValue.toFixed(2);
      // 计算占比：当前持仓市值（CNY）/ 全局总市值（CNY）
      const posMarketValueCny = pos.marketValue || 0;
      const weight =
        globalTotalMarketValueCny > 0
          ? ((posMarketValueCny / globalTotalMarketValueCny) * 100).toFixed(2)
          : '0.00';
      // 使用原币种当日盈亏显示
      const dailyPnl = this.formatNumberWithSign(getLocalDailyChange(pos));
      // 修复：dailyChangePercent 是小数形式，需要乘以 100 转换为百分比
      const dailyPnlPercent = this.formatPercentWithSign(
        (pos.dailyChangePercent || 0) * 100
      );
      // 使用原币种盈亏显示
      const totalPnl = this.formatNumberWithSign(getLocalPnl(pos));
      // 修复：totalPnlPercent 是小数形式，需要乘以 100 转换为百分比
      const totalPnlPercent = this.formatPercentWithSign(
        (pos.totalPnlPercent || 0) * 100
      );

      const periodLines = [
        this.formatPeriodChange('W', pos.weeklyChangePercent),
        this.formatPeriodChange('M', pos.monthlyChangePercent),
        this.formatPeriodChange('Y', pos.yearlyChangePercent),
      ].filter((line): line is string => Boolean(line));

      const periodic =
        periodLines.length > 0 ? periodLines.join('<br />') : '--';

      section += `| ${name} | ${quantity} | ${dilutedCostStr} | ${currentPrice} | ${marketValue} | ${weight}% | ${dailyPnl} | ${dailyPnlPercent} | ${totalPnl} | ${totalPnlPercent} | ${periodic} |\n`;
    }

    return section;
  }

  /**
   * 生成交易记录部分
   */
  private generateTransactionsSection(transactions: Transaction[]): string {
    // 按日期倒序排列
    const sortedTxs = [...transactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    let section = '**7. 全部交易记录**\n\n';
    section += '| 日期 | 类型 | 资产 | 数量 | 价格 | 金额 | 备注 |\n';
    section += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';

    for (const tx of sortedTxs) {
      const dateStr = format(new Date(tx.date), 'yyyy-MM-dd HH:mm', {
        locale: zhCN,
      });
      const typeStr = this.getTransactionTypeName(tx.type);
      const assetStr = tx.assetCode
        ? this.sanitizeMarkdownText(tx.assetCode)
        : '-';
      const qtyStr = tx.quantity?.toString() || '-';
      const priceStr = tx.price?.toFixed(2) || '-';
      const amountStr = tx.amount?.toFixed(2) || '-';
      const notesStr = tx.notes ? this.sanitizeMarkdownText(tx.notes) : '-';

      section += `| ${dateStr} | ${typeStr}  | ${assetStr}       | ${qtyStr}      | ${priceStr}          | ${amountStr}   | ${notesStr}            |\n`;
    }

    return section;
  }

  // ========== 辅助方法 ==========

  private getIndexName(code: string): string {
    const indexMap: Record<string, string> = {
      sh000001: '上证指数',
      sz399001: '深证成指',
      sz399006: '创业板指',
      usIXIC: '纳斯达克',
      usDJI: '道琼斯',
      hkHSI: '恒生指数',
    };
    return indexMap[code] || code;
  }

  private getTransactionTypeName(type: TransactionType): string {
    const typeMap: Record<TransactionType, string> = {
      [TransactionType.BUY]: '买入',
      [TransactionType.SELL]: '卖出',
      [TransactionType.DEPOSIT]: '入金',
      [TransactionType.WITHDRAW]: '出金',
      [TransactionType.LEVERAGE_ADD]: '增加融资',
      [TransactionType.LEVERAGE_REMOVE]: '减少融资',
      [TransactionType.LEVERAGE_COST]: '融资成本',
      [TransactionType.DIVIDEND]: '股息',
    };
    return typeMap[type] || type;
  }

  private formatAttentionSection(rawAttention?: string): string {
    if (!rawAttention || rawAttention.trim() === '') {
      return '*重要提醒：(空白)*\n';
    }

    try {
      const parsed = JSON.parse(rawAttention) as AttentionPayload;
      if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
        let section = '**重要提醒**\n\n';
        section += '| 图标 | 标题 | 内容 | 最近更新时间 |\n';
        section += '| :---: | :----- | :----- | :----------- |\n';
        for (const item of parsed.items) {
          const icon = this.sanitizeMarkdownText(item.icon || '🔔');
          const title = this.sanitizeMarkdownText(item.title || '(未命名)');
          const content = this.sanitizeMarkdownText(item.content || '(空白)');
          const timestamp = this.formatAttentionTimestamp(
            item.updatedAt || item.createdAt
          );
          section += `| ${icon} | ${title} | ${content} | ${timestamp} |\n`;
        }
        return `${section}\n`;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.warn(
        '[ReportService] Failed to parse attentionInfo for markdown export:',
        error
      );
    }

    return `*重要提醒：${rawAttention.trim()}*\n`;
  }

  private sanitizeMarkdownText(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br />').trim();
  }

  private formatPeriodChange(
    label: 'W' | 'M' | 'Y',
    value?: number | null
  ): string | null {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return null;
    }
    return `${label}: ${this.formatPercentWithSign(value)}`;
  }

  /**
   * 格式化带符号的数字（涨跌幅用）
   * @param value 数值
   * @param decimals 小数位数，默认2位
   * @returns 带+/-号的格式化字符串
   */
  private formatNumberWithSign(value: number, decimals: number = 2): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}`;
  }

  /**
   * 格式化带符号的百分比（涨跌幅用）
   * @param value 数值
   * @param decimals 小数位数，默认2位
   * @returns 带+/-号和%的格式化字符串
   */
  private formatPercentWithSign(value: number, decimals: number = 2): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
  }

  private formatAttentionTimestamp(date?: string): string {
    if (!date) {
      return '-';
    }

    try {
      return format(new Date(date), 'yyyy/MM/dd HH:mm', { locale: zhCN });
    } catch {
      console.warn(
        '[ReportService] Invalid attention timestamp detected:',
        date
      );
      return date;
    }
  }

  private calculateNetDeposit(transactions: Transaction[]): number {
    return transactions.reduce((sum, tx) => {
      if (tx.type === TransactionType.DEPOSIT) {
        return sum + (tx.amount || 0);
      } else if (tx.type === TransactionType.WITHDRAW) {
        return sum - (tx.amount || 0);
      }
      return sum;
    }, 0);
  }

  private calculateTotalCommission(transactions: Transaction[]): number {
    return transactions.reduce((sum, tx) => sum + (tx.commission || 0), 0);
  }

  private calculateLeverageCost(transactions: Transaction[]): number {
    return transactions
      .filter((tx) => tx.type === TransactionType.LEVERAGE_COST)
      .reduce((sum, tx) => sum + (tx.amount || 0), 0);
  }

  private getLeverageCostPeriod(transactions: Transaction[]): string {
    const leverageCostTxs = transactions.filter(
      (tx) => tx.type === TransactionType.LEVERAGE_COST
    );

    if (leverageCostTxs.length === 0) {
      // 如果没有融资成本记录，查找融资操作的时间区间
      const leverageTxs = transactions.filter(
        (tx) =>
          tx.type === TransactionType.LEVERAGE_ADD ||
          tx.type === TransactionType.LEVERAGE_REMOVE
      );

      if (leverageTxs.length === 0) {
        return '未使用融资';
      }

      // 显示融资操作的时间区间，并提示未记录成本
      const dates = leverageTxs.map((tx) => new Date(tx.date).getTime());
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      return `${format(minDate, 'yyyy-MM-dd')} ~ ${format(maxDate, 'yyyy-MM-dd')} (未记录成本)`;
    }

    const dates = leverageCostTxs.map((tx) => new Date(tx.date).getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    return `${format(minDate, 'yyyy-MM-dd')} ~ ${format(maxDate, 'yyyy-MM-dd')}`;
  }

  private calculateTotalDividend(transactions: Transaction[]): number {
    return transactions
      .filter((tx) => tx.type === TransactionType.DIVIDEND)
      .reduce((sum, tx) => sum + (tx.amount || 0), 0);
  }
}

export const reportService = new ReportService();
