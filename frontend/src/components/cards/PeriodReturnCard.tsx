import React from 'react';
import { Card, Typography, Tooltip } from 'antd';
import { PortfolioStats } from '../../store/types';
import { formatPercent } from '../../shared/utils/formatters';

const { Text } = Typography;

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fafbfc 0%, #f5f6fa 100%)',
  borderRadius: '4px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  height: '150px',
  minWidth: 180,
  maxWidth: 220,
  position: 'relative',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  transition: 'box-shadow 0.2s',
  cursor: 'default',
};

const cardBodyStyle: React.CSSProperties = {
  padding: '16px 16px',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  gap: '6px',
};

const formatNumber = (
  value: number | undefined | null,
  decimals = 2
): string => {
  if (value === undefined || value === null) return 'N/A';
  return value.toFixed(decimals);
};

const getSourceLabel = (source?: string | null) => {
  switch (source) {
    case 'realtime':
      return '实时行情';
    case 'cost':
      return '成本估值';
    case 'kline':
    default:
      return 'K线数据';
  }
};

interface PeriodReturnCardProps {
  stats: PortfolioStats | null;
}

const renderPeriodReturn = (
  label: string,
  meta?: {
    totalValueChange?: number | null;
    totalValueChangePercent?: number | null;
    periodReturnPercent?: number | null;
    baseDate?: string | null;
    baseDateSource?: string;
    fallbackDays?: number;
  }
): React.ReactNode => {
  if (
    !meta ||
    meta.totalValueChangePercent === null ||
    meta.totalValueChangePercent === undefined
  ) {
    return (
      <Tooltip title={`${label}数据暂不可用，可能因为假期、停牌或新上市股票`}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: '#999', fontSize: '14px' }}>
            N/A
          </div>
          <div style={{ fontSize: '11px', color: '#bbb' }}>数据缺失</div>
        </div>
      </Tooltip>
    );
  }

  if (meta.totalValueChange === 0 && meta.totalValueChangePercent === 0) {
    return (
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 700, color: '#888', fontSize: '14px' }}>
          0.00
        </div>
        <div style={{ fontSize: '11px', color: '#888' }}>0.00%</div>
      </div>
    );
  }

  const color =
    (meta.totalValueChange || 0) > 0
      ? '#f5222d'
      : (meta.totalValueChange || 0) < 0
        ? '#52c41a'
        : '#888';
  const prefix = (meta.totalValueChange || 0) > 0 ? '+' : '';

  const tooltipTitle = (
    <div>
      <div>基准日期: {meta.baseDate || 'N/A'}</div>
      <div>数据来源: {getSourceLabel(meta.baseDateSource)}</div>
      {meta.fallbackDays && meta.fallbackDays > 0 && (
        <div>回溯天数: {meta.fallbackDays}天</div>
      )}
      <div style={{ marginTop: 8, borderTop: '1px solid #555', paddingTop: 4 }}>
        <div>净值变化: 包含存取款影响（净值=总资产-已用杠杆）</div>
        <div>投资收益率: 排除存取款，仅反映投资表现（基于净值）</div>
      </div>
    </div>
  );

  return (
    <Tooltip title={tooltipTitle} placement="left">
      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontWeight: 700,
            color,
            fontSize: '13px',
            lineHeight: '18px',
          }}
        >
          {prefix}
          {formatNumber(meta.totalValueChange)} ({prefix}
          {formatPercent(meta.totalValueChangePercent)})
        </div>
        <div style={{ fontSize: '10px', color: '#888', lineHeight: '14px' }}>
          投资{' '}
          {meta.periodReturnPercent !== null &&
          meta.periodReturnPercent !== undefined
            ? `${(meta.periodReturnPercent || 0) > 0 ? '+' : ''}${formatPercent(meta.periodReturnPercent)}`
            : 'N/A'}
        </div>
      </div>
    </Tooltip>
  );
};

const PeriodReturnCard: React.FC<PeriodReturnCardProps> = ({ stats }) => {
  return (
    <Card
      style={cardStyle}
      styles={{ body: cardBodyStyle }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)';
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '3px',
          borderRadius: '2px',
          background: '#fa8c16',
        }}
      />
      <div style={{ width: '100%', minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: '14px',
            marginBottom: '4px',
            color: '#222',
            position: 'relative',
            paddingBottom: '6px',
            borderBottom: '1px dashed #d9d9d9',
            width: '100%',
          }}
        >
          周期收益
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            fontSize: '12px',
            marginTop: 6,
          }}
        >
          <Text type="secondary" style={{ lineHeight: '18px' }}>
            周度:
          </Text>
          {renderPeriodReturn('周度', stats?.weeklyStats)}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            fontSize: '12px',
            marginTop: 8,
          }}
        >
          <Text type="secondary" style={{ lineHeight: '18px' }}>
            月度:
          </Text>
          {renderPeriodReturn('月度', stats?.monthlyStats)}
        </div>
      </div>
    </Card>
  );
};

export default PeriodReturnCard;
