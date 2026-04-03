import React from 'react';
import { Card, Typography } from 'antd';
import { PortfolioDetail, PortfolioStats } from '../../store/types';
import { formatPercent } from '../../shared/utils/formatters';
import LeverageCostCard from '../LeverageCostCard';

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

const coreCardStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fafbfc 0%, #f5f6fa 100%)',
  borderRadius: '4px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  padding: '16px 20px',
  width: '100%',
  position: 'relative',
  overflow: 'hidden',
  marginTop: '16px',
  transition: 'box-shadow 0.2s',
  cursor: 'default',
};

const formatNumber = (
  value: number | undefined | null,
  decimals = 2
): string => {
  if (value === undefined || value === null) return 'N/A';
  return value.toFixed(decimals);
};

const getColor = (value: number) => {
  if (value > 0) return '#f5222d';
  if (value < 0) return '#52c41a';
  return undefined;
};

const renderDailyChangeIndicator = (
  percent: number | null | undefined
): React.ReactNode => {
  if (percent === null || percent === undefined || Number.isNaN(percent)) {
    return (
      <div style={{ fontSize: '14px', color: '#999' }}>暂无较昨日数据</div>
    );
  }
  const isZero = percent === 0;
  const isPositive = percent > 0;
  const color = isZero ? '#999' : isPositive ? '#f5222d' : '#52c41a';
  const arrow = isZero ? '' : isPositive ? '↑' : '↓';
  const arrowText = arrow ? ` ${arrow}` : '';
  return (
    <div style={{ fontSize: '14px', color }}>
      {formatPercent(Math.abs(percent))}
      {arrowText} 较昨日变化
    </div>
  );
};

interface CoreIndicatorsCardProps {
  portfolio: PortfolioDetail;
  stats: PortfolioStats | null;
}

/**
 * 盈亏信息 + 融资成本 + 手续费 三张小卡片（Fragment，由父容器的单一 flex 容器排列）
 */
export const PnlCardsRow: React.FC<CoreIndicatorsCardProps> = ({
  portfolio,
  stats,
}) => {
  const dailyPnlValue = stats?.dailyPnl || 0;
  const totalPnl = stats
    ? stats.totalPnl !== undefined
      ? stats.totalPnl.toFixed(2)
      : 'N/A'
    : '加载中...';
  const totalPnlValue = stats?.totalPnl || 0;
  const totalCommission = stats?.totalCommission ?? '--';

  return (
    <>
      {/* 盈亏信息卡片 */}
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
            background: totalPnlValue >= 0 ? '#f5222d' : '#52c41a',
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
            盈亏信息
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              marginBottom: '2px',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '18px',
                color: getColor(totalPnlValue),
              }}
            >
              {totalPnl}
            </span>
            <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>
              总盈亏
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">已实现:</Text>
            <Text strong style={{ color: getColor(stats?.realizedPnl || 0) }}>
              {stats?.realizedPnl !== undefined
                ? formatNumber(stats.realizedPnl)
                : 'N/A'}
            </Text>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">未实现:</Text>
            <Text strong style={{ color: getColor(stats?.unrealizedPnl || 0) }}>
              {stats?.unrealizedPnl !== undefined
                ? formatNumber(stats.unrealizedPnl)
                : 'N/A'}
            </Text>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <Text type="secondary">当日盈亏:</Text>
            <Text strong style={{ color: getColor(dailyPnlValue) }}>
              {stats?.dailyPnl !== undefined
                ? stats.dailyPnl.toFixed(2)
                : '加载中...'}
            </Text>
          </div>
        </div>
      </Card>

      {/* 融资成本卡片 */}
      <LeverageCostCard portfolioId={portfolio.id} />

      {/* 交易手续费合计卡片 */}
      <Card style={cardStyle} styles={{ body: cardBodyStyle }}>
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
            交易手续费合计
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              marginBottom: '2px',
            }}
          >
            <span
              style={{ fontWeight: 700, fontSize: '18px', color: '#722ed1' }}
            >
              {typeof totalCommission === 'number'
                ? totalCommission.toFixed(2)
                : totalCommission}
            </span>
            <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>
              手续费合计
            </span>
          </div>
        </div>
      </Card>
    </>
  );
};

/**
 * 核心投资指标全宽区块
 */
const CoreIndicatorsSection: React.FC<CoreIndicatorsCardProps> = ({
  portfolio,
  stats,
}) => {
  const leverage = portfolio.leverageInfo || (portfolio as any).leverage;
  const usedCredit = leverage?.usedCredit || leverage?.usedAmount || 0;
  const totalMarketValueNum = stats?.totalMarketValue || 0;
  const leveragePercent =
    totalMarketValueNum > 0 ? (usedCredit / totalMarketValueNum) * 100 : 0;
  const availableCash = portfolio.cash;
  const totalDividendIncome = stats?.totalDividendIncome;

  const totalMarketChangePercent =
    stats &&
    typeof stats.totalMarketValue === 'number' &&
    stats.totalMarketValue !== 0
      ? ((stats.dailyPnl ?? 0) / stats.totalMarketValue) * 100
      : null;
  const totalPnlChangePercent =
    stats && typeof stats.totalPnl === 'number'
      ? stats.totalPnl !== 0
        ? ((stats.dailyPnl ?? 0) / Math.abs(stats.totalPnl)) * 100
        : 0
      : null;

  return (
    <div
      style={{
        ...coreCardStyle,
        height: 'auto',
        padding: '20px',
        maxWidth: 'none',
      }}
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
      <div
        style={{
          fontWeight: 700,
          fontSize: '16px',
          marginBottom: '15px',
          color: '#222',
          position: 'relative',
          paddingBottom: '10px',
          borderBottom: '1px dashed #d9d9d9',
          width: '100%',
        }}
      >
        核心投资指标
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: '30px',
        }}
      >
        <div style={{ flex: '1', minWidth: '250px' }}>
          <div
            style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}
          >
            总市值(CNY)
          </div>
          <div
            style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}
          >
            ¥{formatNumber(stats?.totalMarketValue)}
          </div>
          {renderDailyChangeIndicator(totalMarketChangePercent)}
        </div>
        <div style={{ flex: '1', minWidth: '250px' }}>
          <div
            style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}
          >
            累计盈亏(CNY)
          </div>
          <div
            style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}
          >
            ¥{formatNumber(stats?.totalPnl)}
          </div>
          {renderDailyChangeIndicator(totalPnlChangePercent)}
        </div>
        <div style={{ flex: '1', minWidth: '250px' }}>
          <div
            style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}
          >
            当前股息收入(CNY)
          </div>
          <div
            style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}
          >
            ¥{formatNumber(totalDividendIncome)}
          </div>
          <div style={{ fontSize: '14px', color: '#888', height: '21px' }}>
            累计获得
          </div>
        </div>
        <div style={{ flex: '1', minWidth: '250px' }}>
          <div
            style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}
          >
            资金状况
          </div>
          <div style={{ fontSize: '15px', marginBottom: '10px' }}>
            可用现金:{' '}
            <span style={{ fontWeight: 700 }}>
              {formatNumber(availableCash)}
            </span>
          </div>
          <div style={{ fontSize: '15px', marginBottom: '10px' }}>
            已用杠杆:{' '}
            <span style={{ fontWeight: 700 }}>{formatNumber(usedCredit)}</span>
          </div>
          <div style={{ fontSize: '15px' }}>
            杠杆比例:{' '}
            <span style={{ fontWeight: 700 }}>
              {formatPercent(leveragePercent, 2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoreIndicatorsSection;
