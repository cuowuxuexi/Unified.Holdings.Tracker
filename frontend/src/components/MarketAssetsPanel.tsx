import React, { useState, useEffect } from 'react';
import { Card, Typography, message, Spin } from 'antd'; // Import message and Spin
import TransactionList from './TransactionList';
import PositionsTable from './PositionsTable';
import { fetchExchangeRates } from '../services/api'; // Correctly import fetchExchangeRates
import apiClient from '../services/api'; // 添加 apiClient 导入
import { PositionWithStats } from '../store/types'; // Import PositionWithStats type
const { Text } = Typography;

// 市场类型
const MARKETS = [
  { key: 'A股', label: 'A股', currency: 'CNY', symbol: '¥' },
  { key: '港股', label: '港股', currency: 'HKD', symbol: 'HK$' },
  { key: '美股', label: '美股', currency: 'USD', symbol: '$' },
];

// 汇率展示组件
const ExchangeRateBar: React.FC<{ rates: Record<string, number>; updatedAt: string; error?: boolean }> = ({ rates, updatedAt, error }) => (
  <div style={{ marginBottom: 24, padding: '12px 16px', background: '#f5f5f5', borderRadius: '8px', fontSize: 14, color: error ? '#cf1322' : '#666' }}>
    <Text strong>汇率：</Text>1 USD = {rates.USD.toFixed(4)} CNY，1 HKD = {rates.HKD.toFixed(4)} CNY
    <span style={{ marginLeft: 16, fontSize: 12, color: '#999' }}>更新时间：{updatedAt}</span>
    {error && <span style={{ marginLeft: 16, color: '#cf1322' }}>已使用上次数据</span>}
  </div>
);

// 市场标题组件
const MarketTitle: React.FC<{
  marketName: string;
  summary: any;
  symbol: string;
}> = ({ marketName, summary, symbol }) => {
  // 固定宽度样式，确保所有市场标题整齐对齐
  const labelStyle: React.CSSProperties = { 
    fontWeight: 600, 
    fontSize: 16, 
    width: '60px', 
    textAlign: 'left' 
  };
  
  const labelValueStyle: React.CSSProperties = {
    fontWeight: 500,
    fontSize: 15,
    display: 'inline-block',
    marginRight: 12,
    minWidth: '200px'
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span style={labelStyle}>{marketName}</span>
      <div style={{ display: 'flex', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 40 }}>
          <Text strong style={{ width: 70, textAlign: 'right' }}>总市值：</Text>
          <Text style={labelValueStyle}>
            {symbol}{summary.totalMarketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {marketName !== 'A股' && (
              <Text type="secondary" style={{ fontSize: '12px', marginLeft: '4px' }}>
                (约 ¥{summary.totalMarketValueCNY.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </Text>
            )}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Text strong style={{ width: 70, textAlign: 'right' }}>总盈亏：</Text>
          <Text 
            style={{
              ...labelValueStyle,
              color: summary.totalPnl >= 0 ? '#f5222d' : '#52c41a'
            }}
          >
            {symbol}{summary.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        </div>
      </div>
    </div>
  );
};

// Removed local mock fetchExchangeRates function

// 定义扩展的持仓类型，包含周期涨幅字段
interface EnhancedPosition extends PositionWithStats {
  currentPrice: number;
  marketValue: number;
  dailyChange?: number;
  dailyChangePercent?: number;
  totalPnl?: number;
  totalPnlPercent?: number;
  weeklyChangePercent?: number;
  monthlyChangePercent?: number;
  yearlyChangePercent?: number;
  marketValueCNY?: number;
  costValueCNY?: number;
  pnlCNY?: number;
  pnlRateCNY?: number;
  weekChangePercent?: number | null;
  monthChangePercent?: number | null;
  yearChangePercent?: number | null;
}

// 主组件
const MarketAssetsPanel: React.FC<{
  portfolioId: string;
  positions: PositionWithStats[]; // Use specific type from store/types
  transactions: any[];
}> = ({ portfolioId, positions, transactions }) => {
  console.log('[MarketAssetsPanel] Received positions prop:', JSON.stringify(positions)); // Log received positions
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [rates, setRates] = useState<{ USD: number; HKD: number; CNY: number } | null>(null); // Use specific type or Record<string, number>
  const [updatedAt, setUpdatedAt] = useState('');
  const [loadingRates, setLoadingRates] = useState(true); // Add loading state
  const [rateError, setRateError] = useState(false);
  
  // 添加行情数据状态
  const [quoteMap, setQuoteMap] = useState<Record<string, any>>({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quoteError, setQuoteError] = useState(false);

  useEffect(() => {
    setLoadingRates(true);
    setRateError(false);
    const loadRates = async () => {
      try {
        // Use the correctly imported function name
        const fetchedData = await fetchExchangeRates();
        if (fetchedData.error) {
          setRateError(true);
          // Use fallback rates if API fails
          setRates({ USD: 7.25, HKD: 0.92, CNY: 1.0 });
          setUpdatedAt(new Date(fetchedData.updatedAt).toLocaleString()); // Use fallback time
          message.error('获取实时汇率失败，使用默认值。');
        } else {
          setRateError(false);
          // Ensure CNY rate is included if missing from API response
          setRates({ ...fetchedData, CNY: 1.0 });
          setUpdatedAt(new Date(fetchedData.updatedAt).toLocaleString());
        }
      } catch (err) {
         console.error("Error in loadRates (MarketAssetsPanel):", err);
         setRateError(true);
         setRates({ USD: 7.25, HKD: 0.92, CNY: 1.0 }); // Use fallback
         setUpdatedAt(new Date().toLocaleString());
         message.error('获取实时汇率时发生错误，使用默认值。');
      } finally {
        setLoadingRates(false);
      }
    };
    loadRates();
  }, []); // Fetch rates on mount
  
  // 加载行情数据
  useEffect(() => {
    const loadQuotes = async () => {
      if (!positions.length) return;

      setLoadingQuotes(true);
      setQuoteError(false);

      try {
        // 提取所有持仓的股票代码
        const positionCodes = positions.map(p => p.asset?.code).filter(Boolean);
        
        // 从交易记录中提取股票代码
        const transactionCodes = transactions.map(t => t.assetCode).filter(Boolean);
        
        // 合并并去重所有股票代码
        const allRelevantCodes = Array.from(new Set([...positionCodes, ...transactionCodes]));
        
        if (!allRelevantCodes.length) return;

        console.log('[MarketAssetsPanel DEBUG] Codes sent to fetchQuotes:', JSON.stringify(allRelevantCodes));

        // 使用完整的代码列表调用行情接口获取数据
        const quotes = await apiClient.fetchQuotes(allRelevantCodes);
        console.log('[MarketAssetsPanel DEBUG] Quotes received from API:', JSON.stringify(quotes));

        // 创建以股票代码为键的映射表
        const newQuoteMap = quotes.reduce((acc, quote) => {
          acc[quote.code] = quote;
          return acc;
        }, {} as Record<string, any>);

        setQuoteMap(newQuoteMap);
        console.log('[MarketAssetsPanel DEBUG] Final quoteMap passed to TransactionList:', JSON.stringify(newQuoteMap));
      } catch (err) {
        console.error('[MarketAssetsPanel] 加载行情数据失败:', err);
        setQuoteError(true);
        message.error('获取行情数据失败，周期涨幅可能无法正确显示。');
      } finally {
        setLoadingQuotes(false);
      }
    };

    loadQuotes();
  }, [positions]); // 当持仓数据变化时重新加载

  // 将原始持仓转换为含人民币价值和周期涨幅
  const positionsWithCny: EnhancedPosition[] = positions.map(p => {
    // 从行情数据中获取周期涨幅
    const quote = p.asset?.code ? quoteMap[p.asset.code] : null;

    // Determine currency based on asset code prefix
    let currencyKey: 'USD' | 'HKD' | 'CNY' = 'CNY'; // Default to CNY
    if (p.asset?.code?.startsWith('hk')) currencyKey = 'HKD';
    else if (p.asset?.code?.startsWith('us')) currencyKey = 'USD';

    // Ensure rates is not null before accessing keys
    const rate = rates ? (rates[currencyKey] ?? 1) : 1; // Access rate using determined currencyKey
    
    const marketValue = p.marketValue || (p.currentPrice ?? 0) * (p.quantity ?? 0);
    const costValue = (p.costPrice ?? 0) * (p.quantity ?? 0);
    
    const marketValueCNY = marketValue * rate;
    const costValueCNY = costValue * rate;
    const pnlCNY = marketValueCNY - costValueCNY;
    
    return { 
      ...p, 
      marketValueCNY,
      costValueCNY, 
      pnlCNY,
      pnlRateCNY: costValueCNY > 0 ? pnlCNY / costValueCNY * 100 : 0,
      // 添加周期涨幅字段，优先使用行情数据
      // 使用 PositionsTable 期望的键名
      weeklyChangePercent: quote?.weekChangePercent ?? p.weeklyChangePercent,
      monthlyChangePercent: quote?.monthChangePercent ?? p.monthlyChangePercent,
      yearlyChangePercent: quote?.yearChangePercent ?? p.yearlyChangePercent
    };
  });

  // 计算各市场汇总
  const marketSummaries = MARKETS.reduce((acc, market) => {
    // Filter positions based on assetCode prefix for market grouping
    const marketPositions = positionsWithCny.filter(p => {
        if (!p.asset?.code) return false;  // 如果没有 code，直接过滤掉
        if (market.key === 'A股') return p.asset.code.startsWith('sh') || p.asset.code.startsWith('sz');
        if (market.key === '港股') return p.asset.code.startsWith('hk');
        if (market.key === '美股') return p.asset.code.startsWith('us');
        return false;
    });
    const totalMarketValue = marketPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const totalPnl = marketPositions.reduce((sum, p) => sum + (p.totalPnl || 0), 0);
    const totalMarketValueCNY = marketPositions.reduce((sum, p) => sum + (p.marketValueCNY || 0), 0);
    const totalPnlCNY = marketPositions.reduce((sum, p) => sum + (p.pnlCNY || 0), 0);
    
    return {
      ...acc,
      [market.key]: {
        totalMarketValue,
        totalPnl,
        totalMarketValueCNY,
        totalPnlCNY,
        currencySymbol: market.symbol
      }
    };
  }, {} as Record<string, any>);

  // 新增：根据 positionsWithCny 汇总全局统计
  const toggleMarket = (market: string) => {
    setCollapsed((prev) => ({ ...prev, [market]: !prev[market] }));
  };

  // 统一卡片样式
  const cardStyle = {
    marginBottom: 20,
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    borderRadius: '8px'
  };

  const cardHeadStyle = {
    borderBottom: 0,
    background: '#fafafa',
    padding: '12px 24px',
    height: '60px'
  };

  return (
    <div>
      {/* 添加行情数据加载状态指示 */}
      {loadingQuotes && <div style={{ margin: '10px 0' }}><Spin size="small" /> 加载行情数据中...</div>}
      {quoteError && <div style={{ margin: '10px 0', color: '#ff4d4f' }}>行情数据加载失败，周期涨幅可能无法正确显示。</div>}

      {/* Pass loading state to potentially show a spinner or placeholder */}
      {loadingRates
        ? <Spin tip="加载汇率中..."><div style={{ height: '36px', marginBottom: '20px' }}><ExchangeRateBar rates={{ USD: 0, HKD: 0, CNY: 1 }} updatedAt="-" error={true} /></div></Spin> 
        : <ExchangeRateBar rates={rates ?? { USD: 0, HKD: 0, CNY: 1 }} updatedAt={updatedAt} error={rateError} />}
      
      {MARKETS.map(({ key, label, symbol }) => {
        const summary = marketSummaries[key];
        // Filter positions for the current market before logging and rendering
        const marketPositions = positionsWithCny.filter((p) => {
          if (!p.asset?.code) return false;  // 如果没有 code，直接过滤掉

          // 开启日志以便调试
          console.log(`[MarketAssetsPanel] 检查持仓: market=${key}, code=${p.asset.code}`);

          let match = false;
          if (key === 'A股') {
            match = p.asset.code.startsWith('sh') || p.asset.code.startsWith('sz');
          } else if (key === '港股') {
            match = p.asset.code.startsWith('hk');
          } else if (key === '美股') {
            match = p.asset.code.startsWith('us');
          }

          console.log(`[MarketAssetsPanel] 过滤结果: match=${match}`);
          return match;
        });

        return (
          <Card
            key={key}
            title={<MarketTitle marketName={label} summary={summary} symbol={symbol} />}
            extra={
              <a onClick={() => toggleMarket(key)} style={{ fontSize: 13 }}>
                {collapsed[key] ? '展开' : '折叠'}
              </a>
            }
            style={cardStyle}
            bodyStyle={{
              display: collapsed[key] ? 'none' : 'block',
              padding: 0,
              borderTop: '1px solid #f0f0f0'
            }}
            headStyle={cardHeadStyle}
          >
            <PositionsTable 
              positions={marketPositions} // Pass the filtered positions
            />
          </Card>
        );
      })}
      
      <Card 
        title="全部交易记录" 
        style={{ ...cardStyle, marginTop: 32 }}
        headStyle={cardHeadStyle}
      >
        <TransactionList 
          transactions={transactions}
          portfolioId={portfolioId}
          assetQuoteMap={quoteMap}
        />
      </Card>
    </div>
  );
};

export default MarketAssetsPanel; 