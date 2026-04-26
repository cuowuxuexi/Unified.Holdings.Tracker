import React from 'react';
import { Alert, Button, Card, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  PortfolioDetail,
  PortfolioStats,
  PositionWithStats,
  Transaction,
} from '../store/types';
import { formatDate as formatDateTime } from '../shared/utils/formatters';
import { ErrorBoundary } from './ErrorBoundary';
import MarketIndices from './MarketIndices';
import MarketAssetsPanel from './MarketAssetsPanel';
import SummaryCard from './cards/SummaryCard';
import PeriodReturnCard from './cards/PeriodReturnCard';
import { PnlCardsRow } from './cards/CoreIndicatorsCard';
import CoreIndicatorsSection from './cards/CoreIndicatorsCard';
import AttentionSection from './cards/AttentionSection';
import PortfolioHistoryPanel from './PortfolioHistoryPanel';

interface DashboardGridProps {
  portfolioId: string;
  portfolio: PortfolioDetail;
  stats: PortfolioStats | null;
  isLoading: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
  lastUpdated?: number;
  mappedPositions: (PositionWithStats & { marketDisplay: string })[];
  transactions: Transaction[];
}

const DashboardGrid: React.FC<DashboardGridProps> = ({
  portfolioId,
  portfolio,
  stats,
  isLoading,
  isRefetching,
  onRefresh,
  lastUpdated,
  mappedPositions,
  transactions,
}) => {
  const updatedAtValue = stats?.timestamp ?? lastUpdated;
  const updatedAtDisplay =
    typeof updatedAtValue === 'number'
      ? formatDateTime(new Date(updatedAtValue).toISOString())
      : '—';
  const refreshLoading = Boolean(isRefetching && stats);

  if (isLoading && !stats) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  return (
    <>
      {/* 大盘指数 */}
      <MarketIndices />

      {/* 投资组合概览卡片 */}
      <Card
        title={
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>投资组合概览(按汇率折算CNY)</span>
          </div>
        }
        style={{ width: '100%', marginBottom: '16px' }}
        styles={{ header: { fontSize: '20px', fontWeight: 'bold' } }}
      >
        <ErrorBoundary
          fallback={
            <Alert
              type="error"
              showIcon
              message="概览渲染失败"
              description="刷新页面或稍后重试。"
            />
          }
        >
          {/* 刷新头部 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 12, color: '#888' }}>
              数据更新时间：{updatedAtDisplay}
            </div>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={onRefresh}
              disabled={!onRefresh}
              loading={refreshLoading}
            >
              刷新
            </Button>
          </div>

          {/* 全部 7 张小卡片统一放在同一个 flex-wrap 容器，与原 PortfolioSummary 行为一致 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <SummaryCard portfolio={portfolio} stats={stats} />
            <PeriodReturnCard stats={stats} />
            <PnlCardsRow portfolio={portfolio} stats={stats} />
          </div>

          {/* 核心投资指标全宽区块 */}
          <CoreIndicatorsSection portfolio={portfolio} stats={stats} />

          {/* 注意事项 */}
          <AttentionSection portfolio={portfolio} />
        </ErrorBoundary>
      </Card>

      <ErrorBoundary
        fallback={
          <Alert
            type="error"
            showIcon
            message="年度历史渲染失败"
            description="请刷新页面或检查控制台日志。"
          />
        }
      >
        <PortfolioHistoryPanel portfolioId={portfolioId} />
      </ErrorBoundary>

      {/* 资产明细 */}
      <ErrorBoundary
        fallback={
          <Alert
            type="error"
            showIcon
            message="资产面板渲染失败"
            description="请刷新页面或检查控制台日志。"
          />
        }
      >
        <MarketAssetsPanel
          portfolioId={portfolioId}
          positions={mappedPositions}
          transactions={transactions}
          stats={stats}
        />
      </ErrorBoundary>
    </>
  );
};

export default DashboardGrid;
