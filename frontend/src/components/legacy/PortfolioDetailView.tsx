import React, { useEffect, useState } from 'react'; // Import useEffect and useState
import { useNavigate } from 'react-router-dom';
import {
  Skeleton,
  Alert,
  Typography,
  Empty,
  Button,
  Modal,
  Input,
  Space,
} from 'antd'; // 将 Spin 替换为 Skeleton
import useAppStore from '../../store'; // Adjust path if needed
import { fetchExchangeRates } from '../../services/api'; // Correctly import fetchExchangeRates
import useMessageApi from '../../hooks/useMessageApi';
import { usePortfolioStats } from '../../hooks/usePortfolioStats';
import MarketIndices from '../MarketIndices';
import DashboardGrid from '../DashboardGrid';

const { Title } = Typography;

const detailPagePadding = '0 32px';

interface PortfolioDetailViewProps {
  portfolioId: string | null;
}

// Removed local fetchExchangeRates definition, will use imported one from api.ts

const PortfolioDetailView: React.FC<PortfolioDetailViewProps> = ({
  portfolioId,
}) => {
  const navigate = useNavigate();
  // Use individual selectors for better performance
  const selectedPortfolioDetail = useAppStore(
    (state) => state.selectedPortfolioDetail
  );
  const isLoadingPortfolioDetail = useAppStore(
    (state) => state.isLoadingPortfolioDetail
  );
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

  const deletePortfolioAction = useAppStore(
    (state) => (state as any).deletePortfolio
  ); // Temporarily cast to any to bypass TS error, should be fixed in store definition
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
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: detailPagePadding,
        }}
      >
        <MarketIndices />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Empty description="请选择一个投资组合以查看详情。" />
        </div>
      </div>
    );
  }

  const waitingForStats =
    portfolioId &&
    (isStatsLoading || (!stats && !statsError && !portfolioError));

  // Show loading skeleton while fetching initial detail OR stats
  if (isLoadingPortfolioDetail || waitingForStats) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
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
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: detailPagePadding,
        }}
      >
        <MarketIndices />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
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
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: detailPagePadding,
        }}
      >
        <MarketIndices />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Empty description="所选投资组合无可用详情。" />
        </div>
      </div>
    );
  }

  // Handle case where stats are missing after loading and no error (should ideally not happen with current logic, but as fallback)
  if (!stats) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: detailPagePadding,
        }}
      >
        <MarketIndices />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Empty description="投资组合统计数据不可用。" />
        </div>
      </div>
    );
  }

  // 汇率和更新时间示例（实际应从全局状态或API获取）
  // Use ratesUpdatedAt state for display
  // const updatedAt = new Date().toLocaleString();

  // Map positions to potentially translate market codes if needed
  const mappedPositions = stats.positions.map((p) => {
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

  // --- Main Render ---
  // At this point, selectedPortfolioDetail and stats are guaranteed to be非空 due to checks above
  return (
    <div
      style={{ width: '100%', padding: detailPagePadding }}
      id="portfolio-report-area"
    >
      {/* Added ID for screenshot targeting */}
      {/* 标题和操作按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          {selectedPortfolioDetail.name}
        </Title>
        <Space>
          <Button
            type="primary"
            onClick={() => {
              const event = new CustomEvent('openAddTransaction', {
                detail: { portfolioId },
              });
              window.dispatchEvent(event);
            }}
          >
            添加交易记录
          </Button>
          <Button
            onClick={() => {
              const event = new CustomEvent('openBatchImport', {
                detail: { portfolioId },
              });
              window.dispatchEvent(event);
            }}
          >
            批量导入
          </Button>
          <Button onClick={() => navigate('/')}>返回主界面</Button>
        </Space>
      </div>
      {/* 删除确认弹窗 */}
      <Modal
        title={`删除投资组合「${selectedPortfolioDetail.name}」`}
        open={deleteModalVisible}
        onOk={handleConfirmDelete}
        okText="确认删除"
        okButtonProps={{
          disabled: deleteInput !== '确定',
          loading: deleteLoading,
          danger: true,
        }}
        onCancel={() => setDeleteModalVisible(false)}
        cancelText="取消"
        destroyOnClose
      >
        <p>
          此操作不可恢复。请输入 <b>确定</b> 以确认删除。
        </p>
        <Input
          placeholder='请输入"确定"'
          value={deleteInput}
          onChange={(e) => setDeleteInput(e.target.value)}
          onPressEnter={() => deleteInput === '确定' && handleConfirmDelete()}
        />
      </Modal>
      {/* 仪表盘：大盘指数 + 概览卡片 + 资产明细 */}
      <DashboardGrid
        portfolioId={portfolioId}
        portfolio={selectedPortfolioDetail}
        stats={stats}
        isLoading={isStatsLoading && !stats}
        isRefetching={isStatsFetching && Boolean(stats)}
        onRefresh={() => refetchStats()}
        lastUpdated={stats?.timestamp}
        mappedPositions={mappedPositions}
        transactions={selectedPortfolioDetail.transactions}
      />
    </div>
  );
};

export default PortfolioDetailView;
