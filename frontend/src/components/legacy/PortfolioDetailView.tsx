import React, { useEffect, useState } from 'react'; // Import useEffect and useState
import { Spin, Alert, Typography, Empty, Card, Button, Modal, Input, Space } from 'antd'; // 添加 Space 组件
import useAppStore from '../../store'; // Adjust path if needed
import PortfolioSummary from '../PortfolioSummary';
import { fetchExchangeRates } from '../../services/api'; // Correctly import fetchExchangeRates
import useMessageApi from '../../hooks/useMessageApi';
import { usePortfolioStats } from '../../hooks/usePortfolioStats';

const { Title } = Typography;

import MarketIndices from '../MarketIndices';
import MarketAssetsPanel from '../MarketAssetsPanel';
import { ErrorBoundary } from '../ErrorBoundary';

const detailPagePadding = '0 32px';

interface PortfolioDetailViewProps {
  portfolioId: string | null;
}

// Removed local fetchExchangeRates definition, will use imported one from api.ts

const PortfolioDetailView: React.FC<PortfolioDetailViewProps> = ({ portfolioId }) => {
  // Use individual selectors for better performance
  const selectedPortfolioDetail = useAppStore((state) => state.selectedPortfolioDetail);
  const isLoadingPortfolioDetail = useAppStore((state) => state.isLoadingPortfolioDetail);
  const portfolioError = useAppStore((state) => state.portfolioError);
  const {
    data: stats,
    isLoading: isStatsLoading,
    isFetching: isStatsFetching,
    refetch: refetchStats,
    error: statsError,
  } = usePortfolioStats(portfolioId);

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const deletePortfolioAction = useAppStore((state) => (state as any).deletePortfolio); // Temporarily cast to any to bypass TS error, should be fixed in store definition
  const fetchPortfolios = useAppStore((state) => state.fetchPortfolios);
  const selectPortfolio = useAppStore((state) => state.selectPortfolio);
  const messageApi = useMessageApi();

  useEffect(() => {
    // Fetch exchange rates when component mounts
    const loadRates = async () => {
      try {
        const fetchedData = await fetchExchangeRates();
        if (fetchedData.error) {
          messageApi.error('获取实时汇率失败，使用默认值。');
        }
      } catch (error) {
        messageApi.error('获取实时汇率失败，使用默认值。');
      }
    };
    loadRates();
  }, [messageApi]); // Runs on mount (message API is stable but included for lint friendliness)

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!portfolioId) return;
    setDeleteLoading(true);
    try {
      // Assuming deletePortfolio action exists and is correctly typed in the store eventually
      await deletePortfolioAction(portfolioId);
      messageApi.success('投资组合已删除');
      setDeleteModalVisible(false);
      setDeleteInput('');
      await fetchPortfolios();
      selectPortfolio(null);
    } catch (err) {
      messageApi.error('删除失败，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  // --- Render Logic ---

  if (!portfolioId) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: detailPagePadding }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="请选择一个投资组合以查看详情。" />
        </div>
      </div>
    );
  }

  const waitingForStats =
    portfolioId &&
    (isStatsLoading || (!stats && !statsError && !portfolioError));

  // Show loading spinner while fetching initial detail OR stats
  if (isLoadingPortfolioDetail || waitingForStats) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: detailPagePadding }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" tip="加载详情和统计数据中...">
            <div style={{ padding: '50px', background: 'rgba(0, 0, 0, 0.05)', borderRadius: '4px', minWidth: '200px', textAlign: 'center' }}>
              <div>加载中...</div>
            </div>
          </Spin>
        </div>
      </div>
    );
  }

  const statsErrorMessage =
    statsError instanceof Error
      ? statsError.message
      : statsError
      ? String(statsError)
      : null;

  if (portfolioError || statsErrorMessage) {
    const errorMessage =
      portfolioError?.includes('statistics') ||
      portfolioError?.includes('stats') ||
      statsErrorMessage
        ? '加载投资组合统计数据时出错'
        : '加载投资组合详情时出错';
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: detailPagePadding }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Alert
            message={errorMessage}
            description={portfolioError || statsErrorMessage || '未知错误'}
            type="error"
            showIcon
          />
        </div>
      </div>
    );
  }

  // Handle case where detail might be missing even after loading (e.g., API error not caught by portfolioError state)
  if (!selectedPortfolioDetail) {
    // This check ensures selectedPortfolioDetail is not null below
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: detailPagePadding }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="所选投资组合无可用详情。" />
        </div>
      </div>
    );
  }

  // Handle case where stats are missing after loading and no error (should ideally not happen with current logic, but as fallback)
  if (!stats) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: detailPagePadding }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="投资组合统计数据不可用。" />
        </div>
      </div>
    );
  }

  // 汇率和更新时间示例（实际应从全局状态或API获取）
  // Use ratesUpdatedAt state for display
  // const updatedAt = new Date().toLocaleString();

  // Map positions to potentially translate market codes if needed
  const mappedPositions = stats.positions.map(p => {
      // Determine market string ('A股', '港股', '美股') based on asset.code prefix
      let marketDisplay = '未知';
      const code = p.asset?.code;
      if (code?.startsWith('sh') || code?.startsWith('sz')) marketDisplay = 'A股';
      else if (code?.startsWith('hk')) marketDisplay = '港股';
      else if (code?.startsWith('us')) marketDisplay = '美股';
      return {
          ...p,
          marketDisplay: marketDisplay,
      };
  });

  // 前端不再重新计算总览统计，直接使用后端数据
  console.log('positions:', mappedPositions); // 保留日志用于调试

  // --- Main Render ---
  // At this point, selectedPortfolioDetail and stats are guaranteed to be非空 due to checks above
  return (
    <div style={{ width: '100%', padding: detailPagePadding }} id="portfolio-report-area"> {/* Added ID for screenshot targeting */}
      {/* 顶部放置大盘指数，始终可见 */}
      <MarketIndices />

      {/* 标题和操作按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title level={2} style={{ margin: 0 }}>{selectedPortfolioDetail.name}</Title>
        <Space>
          <Button
            type="primary"
            onClick={() => {
              // 触发打开添加交易记录的抽屉
              const event = new CustomEvent('openAddTransaction', { detail: { portfolioId } });
              window.dispatchEvent(event);
            }}
          >
            添加交易记录
          </Button>
          <Button
            onClick={() => {
              // 触发打开批量导入的抽屉
              const event = new CustomEvent('openBatchImport', { detail: { portfolioId } });
              window.dispatchEvent(event);
            }}
          >
            批量导入
          </Button>
          <Button
            onClick={() => {
              // 返回主界面
              window.location.href = '/';
            }}
          >
            返回主界面
          </Button>
        </Space>
      </div>

      {/* 删除确认弹窗 */}
      <Modal
        title={`删除投资组合「${selectedPortfolioDetail.name}」`}
        open={deleteModalVisible}
        onOk={handleConfirmDelete}
        okText="确认删除"
        okButtonProps={{ disabled: deleteInput !== '确定', loading: deleteLoading, danger: true }}
        onCancel={() => setDeleteModalVisible(false)}
        cancelText="取消"
        destroyOnClose
      >
        <p>此操作不可恢复。请输入 <b>确定</b> 以确认删除。</p>
        <Input
          placeholder='请输入"确定"'
          value={deleteInput}
          onChange={e => setDeleteInput(e.target.value)}
          onPressEnter={() => deleteInput === '确定' && handleConfirmDelete()}
        />
      </Modal>

      {/* 投资组合标题和摘要信息 */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          <PortfolioSummary 
            portfolio={selectedPortfolioDetail}
            stats={stats} // 直接传递从后端获取的 stats
            isLoading={isStatsLoading && !stats}
            isRefetching={isStatsFetching && Boolean(stats)}
            onRefresh={() => refetchStats()}
            lastUpdated={stats?.timestamp}
          />
        </ErrorBoundary>
      </Card>
      
      {/* 资产明细分市场分组卡片式UI */}
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
          transactions={selectedPortfolioDetail.transactions}
          stats={stats}
        />
      </ErrorBoundary>
    </div>
  );
};

export default PortfolioDetailView;
