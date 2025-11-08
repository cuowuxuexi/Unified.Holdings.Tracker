import React from 'react';
import { Typography, Card, Input } from 'antd'; // 引入 Card 组件和 Input 组件
import { PortfolioDetail, PortfolioStats } from '../store/types'; // Adjust path if needed
import { formatPercent } from './utils/format';
import LeverageCostCard from './LeverageCostCard';

const { Text } = Typography;
const { TextArea } = Input;

interface PortfolioSummaryProps {
  portfolio: PortfolioDetail; // Keep basic info
  stats: PortfolioStats | null; // Add stats object
}

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

const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({ portfolio, stats }) => {
  const formatNumber = (value: number | undefined | null, decimals = 2) => {
    if (value === undefined || value === null) return 'N/A';
    return value.toFixed(decimals);
  };

  // 自定义格式化数字，不带人民币符号
  const formatNumberNoSymbol = (value: number | undefined | null, decimals = 2) => {
    if (value === undefined || value === null) return 'N/A';
    return value.toFixed(decimals);
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
  const periodReturn = stats && stats.periodReturnPercent !== undefined ? formatPercent(stats.periodReturnPercent, 2) : 'N/A';
  const periodReturnValue = stats?.periodReturnPercent || 0;

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


  return (
    <>
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
              <Text strong>{formatPercent(leveragePercent * 100, 2)}</Text>
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
            background: dailyPnlValue >= 0 ? '#f5222d' : '#52c41a'
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
              <span style={{ fontWeight: 700, fontSize: '18px', color: getColor(dailyPnlValue) }}>{dailyPnl}</span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>当日盈亏</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">总盈亏:</Text>
              <Text strong style={{ color: getColor(totalPnlValue) }}>{totalPnl}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <Text type="secondary">收益率:</Text>
              <Text strong style={{ color: getColor(periodReturnValue) }}>{periodReturn}</Text>
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
        <Card
          style={{ 
            ...cardStyle, 
            flex: 1, 
            minWidth: 300, 
            maxWidth: 'none',
            height: 'auto',
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
          }}
          styles={{ body: { ...cardBodyStyle, width: '100%', padding: '16px 20px' } }}
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
            background: '#faad14'
          }} />
          <div style={{ width: '100%', minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: '16px',
              marginBottom: '15px',
              color: '#222',
              position: 'relative',
              paddingBottom: '10px',
              borderBottom: '1px dashed #d9d9d9',
              width: '100%'
            }}>注意信息</div>
            <TextArea
              placeholder="请输入注意事项..."
              autoSize={{ minRows: 3, maxRows: 6 }}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        </Card>
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
            <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>¥{formatNumberNoSymbol(stats?.totalMarketValue)}</div>
          </div>

          {/* 总盈亏(CNY) */}
          <div style={{ flex: '1', minWidth: '250px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>累计盈亏(CNY)</div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>¥{formatNumberNoSymbol(stats?.totalPnl)}</div>
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
              杠杆比例: <span style={{ fontWeight: 700 }}>{formatPercent(leveragePercent * 100, 2)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PortfolioSummary;
