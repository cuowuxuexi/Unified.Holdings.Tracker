import { Table, Tag } from 'antd';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../../../shared/utils/formatters';

interface Position {
  asset?: {
    code?: string;
    name?: string;
    market?: string;
  };
  quantity?: number;
  costPrice?: number;
  costPriceLocal?: number;
  dilutedPrice?: number;
  dilutedPriceLocal?: number;
  totalCost?: number;
  totalBuyCost?: number;
  marketValue?: number;
  currentPrice?: number;
  dailyChange?: number;
  totalPnl?: number;
  totalPnlPercent?: number;
  currency?: string;
}

interface PositionsTableProps {
  positions: Position[];
}

const marketMap: Record<string, { text: string; color: string }> = {
  CN: { text: 'A股', color: 'red' },
  HK: { text: '港股', color: 'blue' },
  US: { text: '美股', color: 'green' },
};

export function PositionsTable({ positions }: PositionsTableProps) {
  const columns = [
    {
      title: '资产代码',
      dataIndex: ['asset', 'code'],
      key: 'code',
      width: 120,
      render: (code: string) => <strong>{code || '-'}</strong>,
    },
    {
      title: '资产名称',
      dataIndex: ['asset', 'name'],
      key: 'name',
      width: 150,
      render: (name: string) => name || '-',
    },
    {
      title: '市场',
      dataIndex: ['asset', 'market'],
      key: 'market',
      width: 80,
      render: (market: string) => {
        const marketInfo = marketMap[market] || {
          text: market,
          color: 'default',
        };
        return <Tag color={marketInfo.color}>{marketInfo.text}</Tag>;
      },
    },
    {
      title: '持仓数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      align: 'right' as const,
      render: (qty: number) => formatNumber(qty, 0),
    },
    {
      title: '摊薄/成本',
      key: 'costPrice',
      width: 140,
      align: 'right' as const,
      render: (_: unknown, record: Position) => {
        // 根据币种选择原币种价格或 CNY 价格
        const isCNY = !record.currency || record.currency === 'CNY';
        const diluted = isCNY ? record.dilutedPrice : record.dilutedPriceLocal;
        const cost = isCNY ? record.costPrice : record.costPriceLocal;

        // 格式化价格，保留合理小数位
        const formatPrice = (price: number | undefined) => {
          if (price === undefined || price === null) return '-';
          // 价格低于10元保留3位小数，否则保留2位
          const decimals = Math.abs(price) < 10 ? 3 : 2;
          return price.toFixed(decimals);
        };

        return (
          <span style={{ fontFamily: 'monospace' }}>
            {formatPrice(diluted)}/{formatPrice(cost)}
          </span>
        );
      },
    },
    {
      title: '总成本',
      dataIndex: 'totalCost',
      key: 'totalCost',
      width: 120,
      align: 'right' as const,
      render: (cost: number) => formatCurrency(cost),
    },
    {
      title: '现价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 120,
      align: 'right' as const,
      render: (price: number) => formatCurrency(price),
    },
    {
      title: '市值',
      dataIndex: 'marketValue',
      key: 'marketValue',
      width: 120,
      align: 'right' as const,
      render: (value: number) => formatCurrency(value),
    },
    {
      title: '日涨跌',
      dataIndex: 'dailyChange',
      key: 'dailyChange',
      width: 100,
      align: 'right' as const,
      render: (change: number) => (
        <span style={{ color: change >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {change >= 0 ? '+' : ''}
          {formatCurrency(change)}
        </span>
      ),
    },
    {
      title: '总盈亏',
      dataIndex: 'totalPnl',
      key: 'totalPnl',
      width: 120,
      align: 'right' as const,
      render: (pnl: number, record: Position) => {
        const denominator =
          typeof record.totalBuyCost === 'number'
            ? record.totalBuyCost
            : (record.totalCost ?? 0);
        const pnlPercent =
          typeof record.totalPnlPercent === 'number'
            ? record.totalPnlPercent
            : denominator !== 0
              ? (pnl / denominator) * 100
              : 0;
        return (
          <div>
            <div
              style={{
                color: pnl >= 0 ? '#52c41a' : '#ff4d4f',
                fontWeight: 'bold',
              }}
            >
              {pnl >= 0 ? '+' : ''}
              {formatCurrency(pnl)}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: pnl >= 0 ? '#52c41a' : '#ff4d4f',
              }}
            >
              {pnl >= 0 ? '+' : ''}
              {formatPercent(pnlPercent)}
            </div>
          </div>
        );
      },
    },
  ];

  // 计算汇总行
  const summary = (pageData: readonly Position[]) => {
    let totalCost = 0;
    let totalMarketValue = 0;
    let totalDailyChange = 0;
    let totalPnl = 0;
    let totalBuyCost = 0;
    let totalBuyCostCount = 0;

    pageData.forEach((position) => {
      totalCost += position.totalCost || 0;
      totalMarketValue += position.marketValue || 0;
      totalDailyChange += position.dailyChange || 0;
      totalPnl += position.totalPnl || 0;
      if (typeof position.totalBuyCost === 'number') {
        totalBuyCost += position.totalBuyCost;
        totalBuyCostCount += 1;
      }
    });

    const hasFullBuyCost =
      totalBuyCostCount === pageData.length && totalBuyCostCount > 0;
    const summaryDenominator = hasFullBuyCost ? totalBuyCost : totalCost;
    const summaryPercent = summaryDenominator
      ? totalPnl / summaryDenominator
      : 0;

    return (
      <Table.Summary fixed>
        <Table.Summary.Row
          style={{ fontWeight: 'bold', backgroundColor: '#fafafa' }}
        >
          <Table.Summary.Cell index={0} colSpan={5} align="right">
            合计
          </Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right">
            {formatCurrency(totalCost)}
          </Table.Summary.Cell>
          <Table.Summary.Cell index={6} colSpan={1} />
          <Table.Summary.Cell index={7} align="right">
            {formatCurrency(totalMarketValue)}
          </Table.Summary.Cell>
          <Table.Summary.Cell index={8} align="right">
            <span
              style={{ color: totalDailyChange >= 0 ? '#52c41a' : '#ff4d4f' }}
            >
              {totalDailyChange >= 0 ? '+' : ''}
              {formatCurrency(totalDailyChange)}
            </span>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={9} align="right">
            <div style={{ color: totalPnl >= 0 ? '#52c41a' : '#ff4d4f' }}>
              {totalPnl >= 0 ? '+' : ''}
              {formatCurrency(totalPnl)}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: totalPnl >= 0 ? '#52c41a' : '#ff4d4f',
              }}
            >
              {totalPnl >= 0 ? '+' : ''}
              {formatPercent(summaryPercent * 100)}
            </div>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  };

  return (
    <Table
      columns={columns}
      dataSource={positions}
      rowKey={(record) => record.asset?.code || Math.random().toString()}
      pagination={false}
      scroll={{ x: 1200 }}
      summary={summary}
    />
  );
}
