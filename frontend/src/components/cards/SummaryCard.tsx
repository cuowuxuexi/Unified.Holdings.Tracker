import React from 'react';
import { Card, Typography } from 'antd';
import { PortfolioDetail, PortfolioStats } from '../../store/types';
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

interface SummaryCardProps {
  portfolio: PortfolioDetail;
  stats: PortfolioStats | null;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ portfolio, stats }) => {
  const netDepositedCash = portfolio.netDepositedCash;
  const availableCash = portfolio.cash;

  const leverage = portfolio.leverageInfo || (portfolio as any).leverage;
  const totalCredit = leverage?.totalCredit || leverage?.totalAmount || 0;
  const usedCredit = leverage?.usedCredit || leverage?.usedAmount || 0;
  const totalMarketValueNum = stats?.totalMarketValue || 0;
  const leveragePercent =
    totalMarketValueNum > 0 ? (usedCredit / totalMarketValueNum) * 100 : 0;

  const totalMarketValue = stats
    ? stats.totalMarketValue !== undefined
      ? stats.totalMarketValue.toFixed(2)
      : 'N/A'
    : '加载中...';
  const totalAssets = stats
    ? stats.totalAssets !== undefined
      ? stats.totalAssets.toFixed(2)
      : 'N/A'
    : '加载中...';
  const netAssets = stats
    ? stats.netAssets !== undefined
      ? stats.netAssets.toFixed(2)
      : 'N/A'
    : '加载中...';

  return (
    <>
      {/* 现金信息卡片 */}
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
            background: '#1890ff',
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
            现金信息
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              marginBottom: '2px',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '18px', color: '#111' }}>
              {formatNumber(netDepositedCash)}
            </span>
            <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>
              净入金
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              marginTop: '4px',
            }}
          >
            <Text type="secondary">可用现金:</Text>
            <Text strong>{formatNumber(availableCash)}</Text>
          </div>
        </div>
      </Card>

      {/* 融资信息卡片 */}
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
            background: '#722ed1',
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
            融资信息
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              marginBottom: '2px',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '18px', color: '#111' }}>
              {formatNumber(totalCredit)}
            </span>
            <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>
              总额度
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">已用:</Text>
            <Text strong>{formatNumber(usedCredit)}</Text>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">杠杆比例:</Text>
            <Text strong>{formatPercent(leveragePercent, 2)}</Text>
          </div>
        </div>
      </Card>

      {/* 资产信息卡片 */}
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
            background: '#13c2c2',
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
            资产信息
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              marginBottom: '2px',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '18px', color: '#111' }}>
              {totalAssets}
            </span>
            <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>
              总资产
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">总市值:</Text>
            <Text strong>{totalMarketValue}</Text>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">净资产:</Text>
            <Text strong>{netAssets}</Text>
          </div>
        </div>
      </Card>
    </>
  );
};

export default SummaryCard;
