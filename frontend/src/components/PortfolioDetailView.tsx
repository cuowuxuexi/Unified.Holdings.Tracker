import React, { useEffect, useState } from 'react'; // Import useEffect and useState
import { Spin, Alert, Typography, Empty, Card, Button, Modal, Input } from 'antd'; // 添加 Card, Button, Modal, and Input components
import useAppStore from '../store'; // Adjust path if needed
import PortfolioSummary from './PortfolioSummary';
import { DeleteOutlined } from '@ant-design/icons';
import { message } from 'antd';
import { fetchExchangeRates } from '../services/api'; // Correctly import fetchExchangeRates

const { Title } = Typography;

import MarketIndices from './MarketIndices';
import MarketAssetsPanel from './MarketAssetsPanel';

interface PortfolioDetailViewProps {
  portfolioId: string | null;
}

// Removed local fetchExchangeRates definition, will use imported one from api.ts

const PortfolioDetailView: React.FC<PortfolioDetailViewProps> = ({ portfolioId }) => {
  // Use individual selectors for better performance
  const selectedPortfolioDetail = useAppStore((state) => state.selectedPortfolioDetail);
  const isLoadingPortfolioDetail = useAppStore((state) => state.isLoadingPortfolioDetail);
  const portfolioError = useAppStore((state) => state.portfolioError);
  const currentPortfolioStats = useAppStore((state) => state.currentPortfolioStats);
  const fetchCurrentPortfolioStats = useAppStore((state) => state.fetchCurrentPortfolioStats);

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const deletePortfolioAction = useAppStore((state) => (state as any).deletePortfolio); // Temporarily cast to any to bypass TS error, should be fixed in store definition
  const fetchPortfolios = useAppStore((state) => state.fetchPortfolios);
  const selectPortfolio = useAppStore((state) => state.selectPortfolio);

  // 汇率状态
  const [ratesError, setRatesError] = useState(false);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    // Fetch exchange rates when component mounts
    const loadRates = async () => {
      try {
        const fetchedData = await fetchExchangeRates();
        if (fetchedData.error) {
          setRatesError(true);
          message.error('获取实时汇率失败，使用默认值。');
          setRatesUpdatedAt(new Date().toLocaleString()); // Use fallback time
        } else {
          setRatesError(false);
          setRatesUpdatedAt(new Date().toLocaleString());
        }
      } catch (error) {
        setRatesError(true);
        setRatesUpdatedAt(new Date().toLocaleString());
        message.error('获取实时汇率失败，使用默认值。');
      }
    };
    loadRates();
  }, []); // Empty dependency array ensures this runs only once on mount

  // Fetch stats when portfolioId changes (Moved to top level)
  useEffect(() => {
    if (portfolioId) {
      fetchCurrentPortfolioStats(portfolioId);
      // Optionally, set an interval to refresh stats periodically
      // const intervalId = setInterval(() => fetchCurrentPortfolioStats(portfolioId), 30000); // e.g., every 30 seconds
      // return () => clearInterval(intervalId); // Cleanup interval on unmount or ID change
    }
  }, [portfolioId, fetchCurrentPortfolioStats]); // Restore original dependency array if needed, or keep fetch function if stable

  // 删除按钮点击
  const handleDeleteClick = () => {
    setDeleteModalVisible(true);
    setDeleteInput('');
  };

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!portfolioId) return;
    setDeleteLoading(true);
    try {
      // Assuming deletePortfolio action exists and is correctly typed in the store eventually
      await deletePortfolioAction(portfolioId);
      message.success('投资组合已删除');
      setDeleteModalVisible(false);
      setDeleteInput('');
      await fetchPortfolios();
      selectPortfolio(null);
    } catch (err) {
      message.error('删除失败，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  // --- Render Logic ---

  if (!portfolioId) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="请选择一个投资组合以查看详情。" />
        </div>
      </div>
    );
  }

  // Show loading spinner while fetching initial detail OR stats
  // Consider a more granular loading state for stats if needed
  if (isLoadingPortfolioDetail || (portfolioId && !currentPortfolioStats && !portfolioError)) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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

  if (portfolioError) {
    // Display error specific to stats fetching if possible, otherwise general error
    const errorMessage = portfolioError?.includes('statistics') || portfolioError?.includes('stats')
      ? "加载投资组合统计数据时出错"
      : "加载投资组合详情时出错";
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Alert message={errorMessage} description={portfolioError || '未知错误'} type="error" showIcon />
        </div>
      </div>
    );
  }

  // Handle case where detail might be missing even after loading (e.g., API error not caught by portfolioError state)
  if (!selectedPortfolioDetail) {
    // This check ensures selectedPortfolioDetail is not null below
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <MarketIndices />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="所选投资组合无可用详情。" />
        </div>
      </div>
    );
  }

  // Handle case where stats are missing after loading and no error (should ideally not happen with current logic, but as fallback)
  if (!currentPortfolioStats) {
    // This check ensures currentPortfolioStats is not null below
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
  const mappedPositions = currentPortfolioStats.positions.map(p => {
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
  // At this point, selectedPortfolioDetail and currentPortfolioStats are guaranteed to be non-null due to checks above
  return (
    <div style={{ width: '100%' }} id="portfolio-report-area"> {/* Added ID for screenshot targeting */}
      {/* 顶部放置大盘指数，始终可见 */}
      <MarketIndices />

      {/* 标题和删除按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title level={2} style={{ margin: 0 }}>{selectedPortfolioDetail.name}</Title>
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={handleDeleteClick}
          title="删除投资组合"
        />
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
            <span style={{ fontSize: '14px', fontWeight: 'normal', color: ratesError ? '#ff4d4f' : '#8c8c8c' }}>
              {ratesError ? '汇率获取失败，使用默认值' : `汇率更新时间: ${ratesUpdatedAt || '加载中...'}`}
            </span>
          </div>
        }
        style={{ width: '100%', marginBottom: '16px' }}
        styles={{ header: { fontSize: '20px', fontWeight: 'bold' } }}
      >
        <PortfolioSummary 
          portfolio={selectedPortfolioDetail}
          stats={currentPortfolioStats} // 直接传递从后端获取的 stats
        />
      </Card>
      
      {/* 资产明细分市场分组卡片式UI */}
      <MarketAssetsPanel
        portfolioId={portfolioId}
        positions={mappedPositions}
        transactions={selectedPortfolioDetail.transactions}
      />
    </div>
  );
};

export default PortfolioDetailView;
