import React from 'react';
import { Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import { PositionWithStats } from '../store/types'; // Import the updated type
import './PositionsTable.css';
import { formatPercent } from './utils/format';

interface PositionsTableProps {
  positions: PositionWithStats[]; // Use the type with stats
}

const PositionsTable: React.FC<PositionsTableProps> = React.memo(({ positions }) => {
  // Helper function for formatting and coloring P/L
  const renderPnl = React.useCallback((value: number | undefined | null, isPercent = false) => {
    if (value === undefined || value === null) return '-'; // Match TransactionList 'N/A' style
    const color = value > 0 ? 'red' : value < 0 ? 'green' : 'default'; // Use Antd Tag colors
    const formattedValue = isPercent ? `${value.toFixed(2)}%` : value.toFixed(2);
    return (
      <Tag color={color} className="pnl-tag"> {/* Use class for potential fine-tuning */}
        {formattedValue}
      </Tag>
    );
  }, []);

  const formatNumber = React.useCallback((value: number | undefined | null, decimals = 2) => {
    if (value === undefined || value === null) return '-'; // Match TransactionList 'N/A' style
    return value.toFixed(decimals);
  }, []);

  const renderPeriodChange = React.useCallback((record: PositionWithStats) => {
    const getColor = (v: number | undefined | null) => v == null ? '#999' : v > 0 ? '#f5222d' : v < 0 ? '#52c41a' : '#999';
    const format = (label: string, v: number | undefined | null) => {
      if (v == null) return `${label}：--`;
      return `${label}： ${formatPercent(Math.abs(v), 2)}`;
    };
    // 优先读取 weekChangePercent/monthChangePercent/yearChangePercent 字段
    const week = record.weeklyChangePercent;
    const month = record.monthlyChangePercent;
    const year = record.yearlyChangePercent;
    return (
      <div style={{ minWidth: 100, padding: '6px 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ color: getColor(week), fontSize: 15, lineHeight: '1.1', fontWeight: 500, letterSpacing: 1 }}>{format('W', week)}</div>
        <div style={{ color: getColor(month), fontSize: 15, lineHeight: '1.1', fontWeight: 500, letterSpacing: 1 }}>{format('M', month)}</div>
        <div style={{ color: getColor(year), fontSize: 15, lineHeight: '1.1', fontWeight: 500, letterSpacing: 1 }}>{format('Y', year)}</div>
      </div>
    );
  }, []);

  const columns: TableProps<PositionWithStats>['columns'] = React.useMemo(() => [
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
      title: '成本价',
      dataIndex: 'costPrice',
      key: 'costPrice',
      // align: 'right', // Removed for global center alignment in CSS
      render: (price) => formatNumber(price), // Keep format function
      width: 100,
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
      render: (value) => formatNumber(value), // Keep format function
      width: 120,
      // className: 'number-cell', // Optional
    },
    {
      title: '当日盈亏',
      dataIndex: 'dailyChange',
      key: 'dailyChange',
      // align: 'right', // Removed for global center alignment in CSS
      render: (value) => renderPnl(value),
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
      render: (value) => renderPnl(value),
      width: 120,
      // className: 'number-cell pnl-cell', // Optional
    },
    {
      title: '总盈亏%',
      dataIndex: 'totalPnlPercent',
      key: 'totalPnlPercent',
      // align: 'right', // Removed for global center alignment in CSS
      render: (value) => renderPnl(value, true),
      width: 120,
      // className: 'number-cell pnl-cell', // Optional
    },
    {
      title: '周期涨幅',
      key: 'periodChange',
      // align: 'right', // Removed for global center alignment in CSS
      render: (_: any, record: PositionWithStats) => renderPeriodChange(record),
      width: 90,
      // className: 'number-cell period-change-cell', // Optional
    },
  ], [formatNumber, renderPnl, renderPeriodChange]);

  // 为每个 position 添加明确的 key 属性
  const dataWithKeys = positions.map((position, index) => ({
    ...position,
    // 优先使用 asset.code 作为 key，若无则回退 index
    key: position.asset?.code ? String(position.asset.code) : String(index)
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
});

export default PositionsTable;