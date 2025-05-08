import React, { useState, useEffect } from 'react';
import { Card, Select, Spin } from 'antd';
import dayjs from 'dayjs';
import apiClient from '../services/api';

const { Option } = Select;

interface LeverageCostCardProps {
  portfolioId: string;
}

const getRange = (type: 'year') => {
  const today = dayjs();
  if (type === 'year') {
    return {
      start: today.startOf('year').format('YYYY-MM-DD'),
      end: today.format('YYYY-MM-DD'),
    };
  }
  // No need for month/day logic anymore
  // Default case or error handling could be added if needed, but since type is fixed to 'year', it's unreachable.
  // Returning a default or throwing an error might be safer in a more complex scenario.
  // For now, we rely on TypeScript ensuring type is always 'year'.
  // Explicitly return something or handle unreachable code based on project standards if necessary.
  // As type is fixed to 'year', the if condition will always be true.
};

const LeverageCostCard: React.FC<LeverageCostCardProps> = ({ portfolioId }) => {
  const [rangeType] = useState<'year'>('year');
  const [leverageCost, setLeverageCost] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState(getRange('year'));

  useEffect(() => {
    setRange(getRange(rangeType));
  }, [rangeType]);

  useEffect(() => {
    if (!portfolioId || !range) {
      // 如果没有 portfolioId 或 range，则不进行 API 调用
      setLeverageCost(null); // 重置融资成本
      setLoading(false); // 确保 loading 状态为 false
      return;
    }

    setLoading(true);

    apiClient.fetchPortfolioStats(portfolioId, undefined, range.start, range.end)
      .then(data => {
        setLeverageCost(typeof data.leverageCost === 'number' ? data.leverageCost : null);
      })
      .catch(error => {
        console.error('Error fetching leverage cost:', error);
        setLeverageCost(null); // 错误时也重置
      })
      .finally(() => setLoading(false));
  }, [portfolioId, range]);

  return (
    <Card
      style={{ // 统一使用 PortfolioSummary 的 cardStyle 关键属性
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
        // justifyContent: 'center', // 移除，改为 flex-start in body
        transition: 'box-shadow 0.2s',
        cursor: 'default',
      }}
      styles={{ // 统一使用 PortfolioSummary 的 cardBodyStyle
        body: {
          padding: '16px 16px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start', // 改为 flex-start
          justifyContent: 'flex-start', // 改为 flex-start
          gap: '6px', // 添加 gap
        }
      }}
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
        background: '#fa541c',
      }} />
      {/* 移除外层 div，直接使用 Card body 的 flex 布局 */}
      {/* 卡片标题+虚线下划线 (与 PortfolioSummary 统一) */}
      <div style={{
        fontWeight: 700,
        fontSize: '14px',
        // marginBottom: '4px', // 使用 gap 控制
        color: '#222',
        position: 'relative',
        paddingBottom: '6px',
        borderBottom: '1px dashed #d9d9d9',
        width: '100%',
        display: 'flex', // 使 Select 右对齐
        justifyContent: 'space-between', // 使 Select 右对齐
        alignItems: 'center' // 垂直居中对齐
      }}>
        <span>融资成本</span> {/* 将文本放入 span */}
        <Select
          size="small"
          value={rangeType}
          style={{ width: 70 }} // 移除 marginLeft
          disabled={true}
        >
          <Option value="year">本年</Option>
        </Select>
      </div>
      {/* 主数据与备注同一行 (与 PortfolioSummary 统一) */}
      <div style={{ display: 'flex', alignItems: 'baseline' /*, marginBottom: '2px'*/ }}>
        {loading ? <Spin size="small"/> : ( // Spin size small for consistency
          <span style={{ fontWeight: 700, fontSize: '18px', color: '#fa541c' }}> {/* 字体调小 */}
            {leverageCost !== null ? leverageCost.toFixed(2) : '--'}
          </span>
        )}
        <span style={{ fontSize: '12px', color: '#888', marginLeft: 8 }}>融资成本</span>
      </div>
      {/* 区间信息 (与 PortfolioSummary 详细数据对齐) */}
      <div style={{ fontSize: 12, color: '#888', width: '100%' /* 确保宽度 */ }}>
        区间：{range ? `${range.start} ~ ${range.end}` : '--'}
      </div>
    </Card>
  );
};

export default LeverageCostCard; 