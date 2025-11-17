import { Card, Descriptions, Typography } from 'antd';
import { formatCurrency } from '../../../shared/utils/formatters';
import type { PortfolioDetail } from '../../../generated/api';

const { Title } = Typography;

interface PortfolioDetailViewProps {
  portfolio: PortfolioDetail;
}

export function PortfolioDetailView({ portfolio }: PortfolioDetailViewProps) {
  return (
    <div>
      <Title level={2}>{portfolio.name || '未命名组合'}</Title>

      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2}>
          <Descriptions.Item label="组合ID">
            {portfolio.id || 'N/A'}
          </Descriptions.Item>
          <Descriptions.Item label="现金余额">
            {formatCurrency(portfolio.cash)}
          </Descriptions.Item>
          {portfolio.initialCash !== undefined && (
            <Descriptions.Item label="初始资金">
              {formatCurrency(portfolio.initialCash)}
            </Descriptions.Item>
          )}
          {portfolio.totalMarketValue !== undefined && (
            <Descriptions.Item label="持仓市值">
              {formatCurrency(portfolio.totalMarketValue)}
            </Descriptions.Item>
          )}
          {portfolio.totalAssets !== undefined && (
            <Descriptions.Item label="总资产">
              {formatCurrency(portfolio.totalAssets)}
            </Descriptions.Item>
          )}
          {portfolio.netAssets !== undefined && (
            <Descriptions.Item label="净资产">
              {formatCurrency(portfolio.netAssets)}
            </Descriptions.Item>
          )}
          {portfolio.dailyPnl !== undefined && (
            <Descriptions.Item label="日盈亏">
              <span
                style={{ color: portfolio.dailyPnl >= 0 ? 'green' : 'red' }}
              >
                {formatCurrency(portfolio.dailyPnl)}
              </span>
            </Descriptions.Item>
          )}
          {portfolio.totalPnl !== undefined && (
            <Descriptions.Item label="总盈亏">
              <span
                style={{ color: portfolio.totalPnl >= 0 ? 'green' : 'red' }}
              >
                {formatCurrency(portfolio.totalPnl)}
              </span>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* TODO: 添加持仓列表、交易记录等 */}
    </div>
  );
}

