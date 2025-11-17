import React, { useState, useEffect } from 'react';
import { Typography, Card, Button, Tooltip, Skeleton } from 'antd'; // 引入 Card 组件
import { ReloadOutlined } from '@ant-design/icons';
import { PortfolioDetail, PortfolioStats, AttentionItem } from '../store/types'; // Adjust path if needed
import { formatPercent, formatDate as formatDateTime } from '../shared/utils/formatters';
import LeverageCostCard from './LeverageCostCard';
import useAppStore from '../store';
import useMessageApi from '../hooks/useMessageApi';
import { AttentionCard } from './AttentionCard';
import { AttentionFormModal } from './AttentionFormModal';
import { parseAttentionInfo, serializeAttentionInfo, generateId } from '../utils/attentionParser';

const { Text } = Typography;

interface PortfolioSummaryProps {
  portfolio: PortfolioDetail; // Keep basic info
  stats: PortfolioStats | null; // Add stats object
  isLoading?: boolean;
  isRefetching?: boolean;
  onRefresh?: () => void;
  lastUpdated?: number;
}

const normalizePeriodPercent = (
  value: number | null | undefined
): number | null => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  if (Math.abs(value) > 1) {
    console.warn(
      '[PortfolioSummary] periodReturnPercent 超出预期范围（-1~1），自动按百分比值转为小数：',
      value
    );
    return value / 100;
  }
  return value;
};

// 核心指标卡片样式
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

// 统一卡片样式，模仿 MarketIndices
const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fafbfc 0%, #f5f6fa 100%)',
  borderRadius: '4px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  height: '150px', // 调高卡片高度，适配多行数据
  minWidth: 180,
  maxWidth: 220, // 适当加宽，防止内容拥挤
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
  alignItems: 'flex-start', // 顶部对齐
  justifyContent: 'flex-start', // 顶部对齐
  gap: '6px',
};

const PortfolioSummarySkeleton: React.FC = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
    {[0, 1, 2, 3].map((idx) => (
      <Card key={idx} style={cardStyle} styles={{ body: cardBodyStyle }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    ))}
  </div>
);

const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({
  portfolio,
  stats,
  isLoading,
  isRefetching,
  onRefresh,
  lastUpdated,
}) => {
  const updateAttentionInfo = useAppStore((state) => state.updateAttentionInfo);
  const messageApi = useMessageApi();
  
  // 注意信息列表状态
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<AttentionItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (isLoading && !stats) {
    return <PortfolioSummarySkeleton />;
  }

  // 初始化注意信息列表
  useEffect(() => {
    const items = parseAttentionInfo(portfolio.attentionInfo);
    setAttentionItems(items);
  }, [portfolio.attentionInfo]);

  const formatNumber = (value: number | undefined | null, decimals = 2) => {
    if (value === undefined || value === null) return 'N/A';
    return value.toFixed(decimals);
  };

  // 自定义格式化数字，不带人民币符号
  const formatNumberNoSymbol = (value: number | undefined | null, decimals = 2) => {
    if (value === undefined || value === null) return 'N/A';
    return value.toFixed(decimals);
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

  /**
   * 渲染周期收益，区分数据缺失/零涨幅/正常三种状态
   */
  const renderPeriodReturn = (
    amount: number | null | undefined,
    percent: number | null | undefined,
    label: string,
    meta?: PortfolioStats['weeklyStats']
  ): React.ReactNode => {
    if (percent === null || percent === undefined || Number.isNaN(percent)) {
      return (
        <Tooltip title={`${label}数据暂不可用，可能因为假期、停牌或新上市股票`}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, color: '#999', fontSize: '14px' }}>N/A</div>
            <div style={{ fontSize: '11px', color: '#bbb' }}>数据缺失</div>
          </div>
        </Tooltip>
      );
    }

    const safeAmount = amount ?? 0;

    if (percent === 0 && safeAmount === 0) {
      return (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: '#888', fontSize: '14px' }}>0.00</div>
          <div style={{ fontSize: '11px', color: '#888' }}>0.00%</div>
        </div>
      );
    }

    const color = safeAmount > 0 ? '#f5222d' : safeAmount < 0 ? '#52c41a' : '#888';
    const prefix = safeAmount > 0 ? '+' : '';

    const tooltipContent = meta ? (
      <div>
        <div>基准：{meta.baseDate ?? `${label}默认基准`}</div>
        <div>估值来源：{getSourceLabel(meta.baseDateSource)}</div>
        {meta.fallbackDays !== undefined && meta.fallbackDays > 0 ? (
          <div>最大回溯 {meta.fallbackDays} 天</div>
        ) : null}
      </div>
    ) : null;

    const content = (
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 700, color, fontSize: '14px' }}>
          {prefix}{formatNumber(safeAmount)}
        </div>
        <div style={{ fontSize: '11px', color }}>
          {formatPercent(percent)}
        </div>
      </div>
    );

    return tooltipContent ? (
      <Tooltip title={tooltipContent}>
        {content}
      </Tooltip>
    ) : (
      content
    );
  };

  // 添加注意事项
  const handleAdd = () => {
    setEditingItem(null);
    setModalVisible(true);
  };

  // 编辑注意事项
  const handleEdit = (id: string) => {
    const item = attentionItems.find((i) => i.id === id);
    if (item) {
      setEditingItem(item);
      setModalVisible(true);
    }
  };

  // 删除注意事项
  const handleDelete = async (id: string) => {
    const newItems = attentionItems.filter((i) => i.id !== id);
    setAttentionItems(newItems);
    const serialized = serializeAttentionInfo(newItems);
    
    setIsSaving(true);
    try {
      await updateAttentionInfo(portfolio.id, serialized);
      messageApi.success('删除成功');
    } catch (error) {
      console.error('Failed to delete attention item:', error);
      messageApi.error('删除失败');
      // 回滚
      setAttentionItems(attentionItems);
    } finally {
      setIsSaving(false);
    }
  };

  // 保存（添加或编辑）
  const handleSave = async (formData: Omit<AttentionItem, 'id' | 'createdAt'>) => {
    let newItems: AttentionItem[];
    
    if (editingItem) {
      // 编辑模式
      newItems = attentionItems.map((item) =>
        item.id === editingItem.id
          ? { ...item, ...formData, updatedAt: new Date().toISOString() }
          : item
      );
    } else {
      // 添加模式
      const newItem: AttentionItem = {
        id: generateId(),
        ...formData,
        createdAt: new Date().toISOString(),
      };
      newItems = [...attentionItems, newItem];
    }
    
    setAttentionItems(newItems);
    setModalVisible(false);
    const serialized = serializeAttentionInfo(newItems);
    
    setIsSaving(true);
    try {
      await updateAttentionInfo(portfolio.id, serialized);
      messageApi.success(editingItem ? '更新成功' : '添加成功');
    } catch (error) {
      console.error('Failed to save attention item:', error);
      messageApi.error('保存失败');
      // 回滚
      setAttentionItems(attentionItems);
    } finally {
      setIsSaving(false);
    }
  };

  // 现金相关展示直接使用API返回字段
  const netDepositedCash = portfolio.netDepositedCash;
  const availableCash = portfolio.cash;

  // 融资相关计算
  const leverage = portfolio.leverageInfo || (portfolio as any).leverage;
  const totalCredit = leverage?.totalCredit || leverage?.totalAmount || 0;
  const usedCredit = leverage?.usedCredit || leverage?.usedAmount || 0;
  // 杠杆比例 = 已用杠杆 / 总市值
  const totalMarketValueNum = stats?.totalMarketValue || 0;
  const leveragePercent = totalMarketValueNum > 0 ? (usedCredit / totalMarketValueNum) : 0;

  // 直接使用 stats 的数值，确保与实际仓位一致
  const totalMarketValue = stats ? (stats.totalMarketValue !== undefined ? stats.totalMarketValue.toFixed(2) : 'N/A') : '加载中...';
  const totalAssets = stats ? (stats.totalAssets !== undefined ? stats.totalAssets.toFixed(2) : 'N/A') : '加载中...';
  const netAssets = stats ? (stats.netAssets !== undefined ? stats.netAssets.toFixed(2) : 'N/A') : '加载中...';
  const dailyPnl = stats ? (stats.dailyPnl !== undefined ? stats.dailyPnl.toFixed(2) : 'N/A') : '加载中...';
  const dailyPnlValue = stats?.dailyPnl || 0;
  const totalPnl = stats ? (stats.totalPnl !== undefined ? stats.totalPnl.toFixed(2) : 'N/A') : '加载中...';
  const totalPnlValue = stats?.totalPnl || 0;
  const totalMarketChangePercent =
    stats && typeof stats.totalMarketValue === 'number' && stats.totalMarketValue !== 0
      ? (stats.dailyPnl ?? 0) / stats.totalMarketValue
      : null;
  const totalPnlChangePercent =
    stats && typeof stats.totalPnl === 'number'
      ? stats.totalPnl !== 0
        ? (stats.dailyPnl ?? 0) / Math.abs(stats.totalPnl)
        : 0
      : null;

  const weeklyReturnPercent = normalizePeriodPercent(
    stats?.weeklyStats?.periodReturnPercent
  );
  const weeklyReturnAmount = stats?.weeklyStats?.periodPnl ?? null;
  const monthlyReturnPercent = normalizePeriodPercent(
    stats?.monthlyStats?.periodReturnPercent
  );
  const monthlyReturnAmount = stats?.monthlyStats?.periodPnl ?? null;

  // Helper to get color based on value
  const getColor = (value: number) => {
    if (value > 0) return '#f5222d'; // 红色表示盈利/上涨
    if (value < 0) return '#52c41a'; // 绿色表示亏损/下跌
    return undefined;
  };

  // 统计融资成本 - 使用API返回的数据
  const leverageCost = stats?.leverageCost ?? 0;
  
  // 统计手续费合计
  const totalCommission = stats?.totalCommission ?? '--';
  
  // 获取总股息收入
  const totalDividendIncome = stats?.totalDividendIncome;

  // 添加调试日志
  console.log('[PortfolioSummary] stats对象:', stats);
  console.log('[PortfolioSummary] totalCommission值:', totalCommission);
  console.log('[PortfolioSummary] leverageCost值:', leverageCost);

  const updatedAtValue = stats?.timestamp ?? lastUpdated;
  const updatedAtDisplay =
    typeof updatedAtValue === 'number'
      ? formatDateTime(new Date(updatedAtValue).toISOString())
      : '—';
  const refreshDisabled = !onRefresh;
  const refreshLoading = Boolean(isRefetching && stats);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#888' }}>数据更新时间：{updatedAtDisplay}</div>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          disabled={refreshDisabled}
          loading={refreshLoading}
        >
          刷新
        </Button>
      </div>
      {/* 原有的卡片部分可以保留或根据需要调整 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
        {/* 现金信息卡片 */}
        <Card
          style={cardStyle}
          styles={{ body: cardBodyStyle }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
        >
          {/* 左侧色条 */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#1890ff'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            {/* 卡片标题+虚线下划线 */}
            <div style={{
              fontWeight: 700,
              fontSize: '14px',
              marginBottom: '4px',
              color: '#222',
              position: 'relative',
              paddingBottom: '6px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>现金信息</div>
            
            {/* 主数据与净入金备注同一行 */}
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
              <span style={{ fontWeight: 700, fontSize: '18px', color: '#111' }}>{formatNumber(netDepositedCash)}</span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>净入金</span>
            </div>
            {/* 详细数据 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
              <Text type="secondary">可用现金:</Text>
              <Text strong>{formatNumber(availableCash)}</Text>
            </div>
          </div>
        </Card>

        {/* 融资信息卡片 */}
        <Card
          style={cardStyle}
          styles={{ body: cardBodyStyle }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#722ed1'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            {/* 卡片标题+虚线下划线 */}
            <div style={{
              fontWeight: 700,
              fontSize: '14px',
              marginBottom: '4px',
              color: '#222',
              position: 'relative',
              paddingBottom: '6px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>融资信息</div>
            {/* 主数据与小字备注同一行 */}
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
              <span style={{ fontWeight: 700, fontSize: '18px', color: '#111' }}>{formatNumber(totalCredit)}</span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>总额度</span>
            </div>
            {/* 详细数据（全部用完整数字） */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">已用:</Text>
              <Text strong>{formatNumber(usedCredit)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">杠杆比例:</Text>
              <Text strong>{formatPercent(leveragePercent, 2)}</Text>
            </div>
          </div>
        </Card>

        {/* 资产信息卡片 */}
        <Card
          style={cardStyle}
          styles={{ body: cardBodyStyle }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#13c2c2'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: '14px',
              marginBottom: '4px',
              color: '#222',
              position: 'relative',
              paddingBottom: '6px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>资产信息</div>
            {/* 主数据与小字备注同一行 */}
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
              <span style={{ fontWeight: 700, fontSize: '18px', color: '#111' }}>{totalAssets}</span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>总资产</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">总市值:</Text>
              <Text strong>{totalMarketValue}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">净资产:</Text>
              <Text strong>{netAssets}</Text>
            </div>
          </div>
        </Card>

        {/* 盈亏信息卡片 */}
        <Card
          style={cardStyle}
          styles={{ body: cardBodyStyle }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: totalPnlValue >= 0 ? '#f5222d' : '#52c41a'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: '14px',
              marginBottom: '4px',
              color: '#222',
              position: 'relative',
              paddingBottom: '6px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>盈亏信息</div>
            {/* 主数据与小字备注同一行 */}
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
              <span style={{ fontWeight: 700, fontSize: '18px', color: getColor(totalPnlValue) }}>{totalPnl}</span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>总盈亏</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">已实现:</Text>
              <Text strong style={{ color: getColor(stats?.realizedPnl || 0) }}>
                {stats?.realizedPnl !== undefined ? formatNumber(stats.realizedPnl) : 'N/A'}
              </Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">未实现:</Text>
              <Text strong style={{ color: getColor(stats?.unrealizedPnl || 0) }}>
                {stats?.unrealizedPnl !== undefined ? formatNumber(stats.unrealizedPnl) : 'N/A'}
              </Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">当日盈亏:</Text>
              <Text strong style={{ color: getColor(dailyPnlValue) }}>{dailyPnl}</Text>
            </div>
          </div>
        </Card>
        {/* 周/月收益卡片 */}
        <Card
          style={cardStyle}
          styles={{ body: cardBodyStyle }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#fa8c16'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: '14px',
              marginBottom: '4px',
              color: '#222',
              position: 'relative',
              paddingBottom: '6px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>周期收益</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: 4 }}>
              <Text type="secondary">周度收益:</Text>
              {renderPeriodReturn(weeklyReturnAmount, weeklyReturnPercent, '周度', stats?.weeklyStats)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: 8 }}>
              <Text type="secondary">月度收益:</Text>
              {renderPeriodReturn(monthlyReturnAmount, monthlyReturnPercent, '月度', stats?.monthlyStats)}
            </div>
          </div>
        </Card>
        {/* 融资成本卡片 */}
        <LeverageCostCard portfolioId={portfolio.id} />
        {/* 交易手续费合计卡片 */}
        <Card
          style={cardStyle}
          styles={{ body: cardBodyStyle }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#722ed1'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: '14px',
              marginBottom: '4px',
              color: '#222',
              position: 'relative',
              paddingBottom: '6px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>交易手续费合计</div>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
              <span style={{ fontWeight: 700, fontSize: '18px', color: '#722ed1' }}>{typeof totalCommission === 'number' ? totalCommission.toFixed(2) : totalCommission}</span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>手续费合计</span>
            </div>
          </div>
        </Card>
      </div>
      
      {/* 注意信息卡片单独一行，宽度撑满 */}
      <div style={{ marginTop: 16, display: 'flex' }}>
        <div style={{ 
          ...coreCardStyle, 
          flex: 1, 
          minHeight: '180px',
          height: 'auto',
          padding: '16px 20px'
        }}>
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#1890ff'
          }} />
          
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: 700,
            fontSize: '16px',
            marginBottom: '15px',
            color: '#222',
            paddingBottom: '10px',
            borderBottom: '1px dashed #d9d9d9',
          }}>
            <span>📌 重要提醒</span>
            <Button type="primary" size="small" onClick={handleAdd} loading={isSaving}>
              + 添加
            </Button>
          </div>
          
          <div>
            {attentionItems.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', padding: '20px 0' }}>
                暂无注意事项，点击"添加"按钮创建
              </div>
            ) : (
              attentionItems.map((item) => (
                <AttentionCard
                  key={item.id}
                  item={item}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
          
          <AttentionFormModal
            visible={modalVisible}
            editingItem={editingItem}
            onSave={handleSave}
            onCancel={() => setModalVisible(false)}
          />
        </div>
      </div>
      
      {/* 核心投资指标卡片 - 放置在注意信息下面 */}
      <div style={{
        ...coreCardStyle,
        height: 'auto',
        padding: '20px',
        maxWidth: 'none'
      }} onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'; }}
         onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}>
        {/* 左侧色条 */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '3px',
          borderRadius: '2px',
          background: '#1890ff'
        }} />
        
        <div style={{ 
          fontWeight: 700,
          fontSize: '16px',
          marginBottom: '15px',
          color: '#222',
          position: 'relative',
          paddingBottom: '10px',
          borderBottom: '1px dashed #d9d9d9',
          width: '100%'
        }}>
          核心投资指标
        </div>
        
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap',
          justifyContent: 'space-between', 
          gap: '30px' 
        }}>
          {/* 总市值(CNY) */}
          <div style={{ flex: '1', minWidth: '250px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>总市值(CNY)</div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>¥{formatNumberNoSymbol(stats?.totalMarketValue)}</div>
            {renderDailyChangeIndicator(totalMarketChangePercent)}
          </div>

          {/* 总盈亏(CNY) */}
          <div style={{ flex: '1', minWidth: '250px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>累计盈亏(CNY)</div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>¥{formatNumberNoSymbol(stats?.totalPnl)}</div>
            {renderDailyChangeIndicator(totalPnlChangePercent)}
          </div>

          {/* 当前股息收入(CNY) */}
          <div style={{ flex: '1', minWidth: '250px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>当前股息收入(CNY)</div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>¥{formatNumberNoSymbol(totalDividendIncome)}</div>
            {/* 可以添加一个占位符或描述，因为"较昨日变化"不适用 */}
            <div style={{ fontSize: '14px', color: '#888', height: '21px' }}>累计获得</div> 
          </div>

          {/* 资金状况 */}
          <div style={{ flex: '1', minWidth: '250px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>资金状况</div>
            <div style={{ fontSize: '15px', marginBottom: '10px' }}>
              可用现金: <span style={{ fontWeight: 700 }}>{formatNumber(availableCash)}</span>
            </div>
            <div style={{ fontSize: '15px', marginBottom: '10px' }}>
              已用杠杆: <span style={{ fontWeight: 700 }}>{formatNumber(usedCredit)}</span>
            </div>
            <div style={{ fontSize: '15px' }}>
              杠杆比例: <span style={{ fontWeight: 700 }}>{formatPercent(leveragePercent, 2)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PortfolioSummary;
