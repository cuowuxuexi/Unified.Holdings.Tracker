import React from 'react';
import { Table, Tag, Tooltip } from 'antd';
import type { TableProps } from 'antd';
import { PositionWithStats } from '../../store/types'; // Import the updated type
import '../PositionsTable.css'; // 引入CSS样式文件

const MARKET_TO_CURRENCY: Record<string, string> = {
  HK: 'HKD',
  US: 'USD',
  CN: 'CNY',
};

const inferCurrencyCode = (record: PositionWithStats): string => {
  const market = record.asset?.market;
  if (!market) return 'CNY';
  return MARKET_TO_CURRENCY[market] || 'CNY';
};

const shouldUseLocalCurrency = (record: PositionWithStats) =>
  inferCurrencyCode(record) !== 'CNY';

const toNumber = (value: any): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getQuantity = (record: PositionWithStats): number =>
  Number.isFinite(record.quantity) ? record.quantity : 0;

const getLocalCostPrice = (record: PositionWithStats): number | undefined => {
  const data = record as any;
  const costPriceLocal = toNumber(data.costPriceLocal);
  if (costPriceLocal !== undefined) {
    return costPriceLocal;
  }
  const totalCostLocal = toNumber(data.totalCostLocal);
  const quantity = getQuantity(record);
  if (totalCostLocal !== undefined && quantity > 0) {
    return totalCostLocal / quantity;
  }
  return undefined;
};

const getLocalMarketValue = (record: PositionWithStats): number | undefined => {
  const data = record as any;
  const marketValueLocal = toNumber(data.marketValueLocal);
  if (marketValueLocal !== undefined) {
    return marketValueLocal;
  }
  if (typeof record.currentPrice === 'number') {
    return record.currentPrice * getQuantity(record);
  }
  return undefined;
};

const getLocalTotalCost = (record: PositionWithStats): number | undefined => {
  const data = record as any;
  const totalCostLocal = toNumber(data.totalCostLocal);
  if (totalCostLocal !== undefined) {
    return totalCostLocal;
  }
  const costPriceLocal = getLocalCostPrice(record);
  if (costPriceLocal !== undefined) {
    return costPriceLocal * getQuantity(record);
  }
  return undefined;
};

const getLocalTotalPnl = (record: PositionWithStats): number | undefined => {
  const data = record as any;
  const totalPnlLocal = toNumber(data.totalPnlLocal);
  if (totalPnlLocal !== undefined) {
    return totalPnlLocal;
  }
  const marketValueLocal = getLocalMarketValue(record);
  const totalCostLocal = getLocalTotalCost(record);
  if (marketValueLocal !== undefined && totalCostLocal !== undefined) {
    return marketValueLocal - totalCostLocal;
  }
  return undefined;
};

const getLocalDailyChange = (record: PositionWithStats): number | undefined => {
  const data = record as any;
  return toNumber(data.dailyChangeLocal);
};

const getDisplayCostPrice = (record: PositionWithStats): number | undefined => {
  if (shouldUseLocalCurrency(record)) {
    const local = getLocalCostPrice(record);
    if (local !== undefined) {
      return local;
    }
  }
  return record.costPrice;
};

const getDisplayDilutedPrice = (
  record: PositionWithStats
): number | undefined => {
  const data = record as any;
  if (shouldUseLocalCurrency(record)) {
    const local = toNumber(data.dilutedPriceLocal);
    if (local !== undefined) {
      return local;
    }
  }
  return toNumber(data.dilutedPrice);
};

const getDisplayMarketValue = (
  record: PositionWithStats
): number | undefined => {
  if (shouldUseLocalCurrency(record)) {
    const local = getLocalMarketValue(record);
    if (local !== undefined) {
      return local;
    }
  }
  return record.marketValue;
};

const getDisplayDailyChange = (
  record: PositionWithStats
): number | undefined => {
  if (shouldUseLocalCurrency(record)) {
    const local = getLocalDailyChange(record);
    if (local !== undefined) {
      return local;
    }
  }
  return record.dailyChange;
};

const getDisplayTotalPnl = (record: PositionWithStats): number | undefined => {
  if (shouldUseLocalCurrency(record)) {
    const local = getLocalTotalPnl(record);
    if (local !== undefined) {
      return local;
    }
  }
  const data = record as any;
  const pnlCny = toNumber(data.pnlCNY);
  if (record.totalPnl !== undefined) {
    return record.totalPnl;
  }
  return pnlCny;
};

const getCostBaseForPercent = (
  record: PositionWithStats
): number | undefined => {
  if (shouldUseLocalCurrency(record)) {
    const localCost = getLocalTotalCost(record);
    if (localCost !== undefined && localCost !== 0) {
      return localCost;
    }
  }
  const data = record as any;
  const totalCost = toNumber(data.totalCost);
  if (totalCost !== undefined && totalCost !== 0) {
    return totalCost;
  }
  const quantity = getQuantity(record);
  if (quantity > 0 && typeof record.costPrice === 'number') {
    return record.costPrice * quantity;
  }
  return undefined;
};

const getDisplayPnlPercent = (record: PositionWithStats): number => {
  const pnl = getDisplayTotalPnl(record);
  const base = getCostBaseForPercent(record);
  if (pnl !== undefined && base) {
    return base !== 0 ? (pnl / base) * 100 : 0;
  }
  return record.totalPnlPercent ?? 0;
};

interface PositionsTableProps {
  positions: PositionWithStats[]; // Use the type with stats
  totalMarketValue?: number; // 从后端获取的投资组合总市值，用于计算占比
}

const PositionsTable: React.FC<PositionsTableProps> = React.memo(
  ({ positions, totalMarketValue }) => {
    // Helper function for formatting and coloring P/L
    const renderPnl = React.useCallback(
      (value: number | undefined | null, isPercent = false) => {
        if (value === undefined || value === null) return '-'; // Match TransactionList 'N/A' style
        const color = value > 0 ? 'red' : value < 0 ? 'green' : 'default'; // Use Antd Tag colors
        const formattedValue = isPercent
          ? `${value.toFixed(2)}%`
          : value.toFixed(2);
        return (
          <Tag color={color} className="pnl-tag">
            {' '}
            {/* Use class for potential fine-tuning */}
            {formattedValue}
          </Tag>
        );
      },
      []
    );

    const formatNumber = React.useCallback(
      (value: number | undefined | null, decimals = 2) => {
        if (value === undefined || value === null) return '-'; // Match TransactionList 'N/A' style
        return value.toFixed(decimals);
      },
      []
    );

    const renderPeriodChange = React.useCallback(
      (record: PositionWithStats) => {
        const getColor = (v: number | undefined | null) => {
          if (v == null || v === undefined) return '#999'; // 灰色表示无数据
          if (v === 0) return '#666'; // 深灰色表示0涨幅
          return v > 0 ? '#f5222d' : '#52c41a'; // 红涨绿跌
        };

        // 改进：分离标签和数值，返回对象格式
        const format = (label: string, v: number | undefined | null) => {
          if (v == null || v === undefined)
            return { label: `${label}:`, value: 'N/A' };
          if (v === 0) return { label: `${label}:`, value: '0.00%' };
          // 后端返回的周期涨幅已经是百分比数值（如 18.18 表示 18.18%），不需要再乘以100
          return { label: `${label}:`, value: `${Math.abs(v).toFixed(2)}%` };
        };

        const getTooltip = (period: string, v: number | undefined | null) => {
          if (v == null || v === undefined) {
            return `${period}涨幅数据暂不可用，可能因为停牌、假期或新股上市`;
          }
          return `${period}涨幅: ${v.toFixed(2)}%`;
        };

        // 优先读取 weeklyChangePercent/monthlyChangePercent/yearlyChangePercent 字段
        const week = format('W', record.weeklyChangePercent);
        const month = format('M', record.monthlyChangePercent);
        const year = format('Y', record.yearlyChangePercent);

        // 统一的行样式
        const lineStyle: React.CSSProperties = {
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          lineHeight: '1.2',
          fontSize: 15,
          fontWeight: 600,
          fontFamily:
            'Consolas, "Courier New", monospace, "PingFang SC", "Microsoft YaHei"',
          cursor: 'help',
        };

        // 固定宽度样式确保对齐
        const labelStyle: React.CSSProperties = {
          width: '24px', // 固定标签宽度（W: M: Y:）
          textAlign: 'right',
          marginRight: '4px',
        };

        const valueStyle: React.CSSProperties = {
          width: '70px', // 固定数值宽度
          textAlign: 'left',
        };

        return (
          <div
            className="period-change-container"
            style={{
              padding: '6px 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Tooltip
              title={getTooltip('周', record.weeklyChangePercent)}
              placement="left"
            >
              <div
                style={{
                  ...lineStyle,
                  color: getColor(record.weeklyChangePercent),
                }}
              >
                <span style={labelStyle}>{week.label}</span>
                <span style={valueStyle}>{week.value}</span>
              </div>
            </Tooltip>
            <Tooltip
              title={getTooltip('月', record.monthlyChangePercent)}
              placement="left"
            >
              <div
                style={{
                  ...lineStyle,
                  color: getColor(record.monthlyChangePercent),
                }}
              >
                <span style={labelStyle}>{month.label}</span>
                <span style={valueStyle}>{month.value}</span>
              </div>
            </Tooltip>
            <Tooltip
              title={getTooltip('年', record.yearlyChangePercent)}
              placement="left"
            >
              <div
                style={{
                  ...lineStyle,
                  color: getColor(record.yearlyChangePercent),
                }}
              >
                <span style={labelStyle}>{year.label}</span>
                <span style={valueStyle}>{year.value}</span>
              </div>
            </Tooltip>
          </div>
        );
      },
      []
    );

    const columns: TableProps<PositionWithStats>['columns'] = React.useMemo(
      () => [
        {
          title: '名称',
          dataIndex: ['asset', 'name'],
          key: 'name',
          render: (name) => name || '-', // Match TransactionList 'N/A' style
          className: 'name-cell', // Add class for CSS targeting
          width: 150,
        },
        {
          title: '数量',
          dataIndex: 'quantity',
          key: 'quantity',
          // align: 'right', // Removed for global center alignment in CSS
          width: 100,
          // className: 'number-cell', // Optional
        },
        {
          title: '摊薄/成本',
          dataIndex: 'costPrice',
          key: 'costPrice',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_price: number, record: PositionWithStats) => {
            const diluted = getDisplayDilutedPrice(record);
            const cost = getDisplayCostPrice(record);
            // 格式化价格，保留合理小数位
            const formatPrice = (price: number | undefined) => {
              if (price === undefined || price === null) return '-';
              const decimals = Math.abs(price) < 10 ? 3 : 2;
              return price.toFixed(decimals);
            };
            return (
              <span style={{ fontFamily: 'Consolas, monospace' }}>
                {formatPrice(diluted)}/{formatPrice(cost)}
              </span>
            );
          },
          width: 130,
          // className: 'number-cell', // Optional
        },
        {
          title: '现价',
          dataIndex: 'currentPrice',
          key: 'currentPrice',
          // align: 'right', // Removed for global center alignment in CSS
          render: (price) => formatNumber(price), // Keep format function
          width: 100,
          // className: 'number-cell', // Optional
        },
        {
          title: '市值',
          dataIndex: 'marketValue',
          key: 'marketValue',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_value: number, record: PositionWithStats) =>
            formatNumber(getDisplayMarketValue(record)), // 优先展示本币市值
          width: 120,
          // className: 'number-cell', // Optional
        },
        {
          title: '占比%',
          key: 'positionRatio',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_: any, record: PositionWithStats) => {
            if (!totalMarketValue || totalMarketValue === 0) return '-';
            // 使用 marketValueCNY（已换算为人民币的市值）来计算占比
            // 因为 totalMarketValue 是人民币计价的总市值
            const marketValueInCNY =
              (record as any).marketValueCNY || record.marketValue || 0;
            const ratio = (marketValueInCNY / totalMarketValue) * 100;
            return `${ratio.toFixed(2)}%`;
          },
          width: 100,
          // className: 'number-cell', // Optional
        },
        {
          title: '当日盈亏',
          dataIndex: 'dailyChange',
          key: 'dailyChange',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_value: number, record: PositionWithStats) =>
            renderPnl(getDisplayDailyChange(record)),
          width: 120,
          // className: 'number-cell pnl-cell', // Optional
        },
        {
          title: '当日盈亏%',
          dataIndex: 'dailyChangePercent',
          key: 'dailyChangePercent',
          // align: 'right', // Removed for global center alignment in CSS
          render: (value) => renderPnl(value, true),
          width: 120,
          // className: 'number-cell pnl-cell', // Optional
        },
        {
          title: '总盈亏',
          dataIndex: 'totalPnl',
          key: 'totalPnl',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_value: number, record: PositionWithStats) =>
            renderPnl(getDisplayTotalPnl(record)),
          width: 120,
          // className: 'number-cell pnl-cell', // Optional
        },
        {
          title: '总盈亏%',
          dataIndex: 'totalPnlPercent',
          key: 'totalPnlPercent',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_value: number, record: PositionWithStats) =>
            renderPnl(getDisplayPnlPercent(record), true),
          width: 120,
          // className: 'number-cell pnl-cell', // Optional
        },
        {
          title: '周期涨幅',
          key: 'periodChange',
          // align: 'right', // Removed for global center alignment in CSS
          render: (_: any, record: PositionWithStats) =>
            renderPeriodChange(record),
          width: 90,
          // className: 'number-cell period-change-cell', // Optional
        },
      ],
      [formatNumber, renderPnl, renderPeriodChange]
    );

    // 为每个 position 添加明确的 key 属性
    const dataWithKeys = positions.map((position, index) => ({
      ...position,
      // 优先使用 asset.code 作为 key，若无则回退 index
      key: position.asset?.code ? String(position.asset.code) : String(index),
    }));

    // 判断是否为小屏幕，动态设置scroll属性
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 900;

    return (
      <Table
        columns={columns}
        dataSource={dataWithKeys}
        pagination={false} // Keep no pagination
        size="small" // Change size to small like TransactionList
        bordered // Keep bordered style
        style={{ width: '100%' }} // Keep full width
        // Remove custom rowClassName, use Antd default hover/styles for small table
        className="positions-table" // Keep class for CSS targeting
        scroll={isMobile ? { x: 900 } : undefined} // Keep responsive scroll
      />
    );
  }
);

export default PositionsTable;
