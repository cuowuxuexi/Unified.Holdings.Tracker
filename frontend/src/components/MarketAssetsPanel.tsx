import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Spin,
  Button,
  Modal,
  Input,
  Space,
  Select,
} from 'antd'; // 添加更多 UI 组件
import {
  SettingOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons'; // 添加图标
import TransactionList from './legacy/TransactionList';
import PositionsTable from './legacy/PositionsTable';
import { fetchExchangeRates, FALLBACK_EXCHANGE_RATES } from '../services/api';
import apiClient from '../services/api'; // 添加 apiClient 导入
import {
  PositionWithStats,
  PortfolioStats,
  Quote,
  Transaction,
} from '../store/types'; // Import PositionWithStats type
import useAppStore from '../store'; // 导入 store
import useMessageApi from '../hooks/useMessageApi';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { MarketConfig } from '../store/types';

const { Text } = Typography;

const MARKET_TO_CURRENCY: Record<string, string> = {
  HK: 'HKD',
  US: 'USD',
  CN: 'CNY',
};

const inferPositionCurrency = (position: PositionWithStats): string => {
  const market = position.asset?.market;
  if (!market) return 'CNY';
  return MARKET_TO_CURRENCY[market] || 'CNY';
};

const shouldDisplayLocalCurrency = (position: PositionWithStats) =>
  inferPositionCurrency(position) !== 'CNY';

const getMarketValueInDisplayCurrency = (
  position: PositionWithStats
): number => {
  if (shouldDisplayLocalCurrency(position)) {
    // For non-CNY assets, use currentPrice * quantity for local currency display
    if (typeof position.currentPrice === 'number') {
      return position.currentPrice * position.quantity;
    }
  }
  // Otherwise use the CNY market value from backend
  return position.marketValue ?? 0;
};

interface MarketSummary {
  totalMarketValueLocal: number;
  totalMarketValueCNY: number;
  totalPnlLocal: number;
  totalPnlCNY: number;
  currencySymbol: string;
  currencyCode: string;
}

// 汇率展示组件
const ExchangeRateBar: React.FC<{
  rates: Record<string, number>;
  updatedAt: string;
  error?: boolean;
}> = ({ rates, updatedAt, error }) => (
  <div
    style={{
      marginBottom: 24,
      padding: '12px 16px',
      background: '#f5f5f5',
      borderRadius: '8px',
      fontSize: 14,
      color: error ? '#cf1322' : '#666',
    }}
  >
    <Text strong>汇率：</Text>1 USD = {rates.USD.toFixed(4)} CNY，1 HKD ={' '}
    {rates.HKD.toFixed(4)} CNY
    <span style={{ marginLeft: 16, fontSize: 12, color: '#999' }}>
      更新时间：{updatedAt}
    </span>
    {error && (
      <span style={{ marginLeft: 16, color: '#cf1322' }}>
        获取失败，以上为估算值
      </span>
    )}
  </div>
);

// 市场标题组件
const MarketTitle: React.FC<{
  marketName: string;
  summary: MarketSummary;
}> = ({ marketName, summary }) => {
  // 固定宽度样式，确保所有市场标题整齐对齐
  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 16,
    width: '60px',
    textAlign: 'left',
  };

  const labelValueStyle: React.CSSProperties = {
    fontWeight: 500,
    fontSize: 15,
    display: 'inline-block',
    marginRight: 12,
    minWidth: '200px',
  };

  const shouldShowApprox = summary.currencyCode !== 'CNY';
  const symbol = summary.currencySymbol;
  const formatWithSymbol = (value: number) =>
    `${symbol}${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span style={labelStyle}>{marketName}</span>
      <div style={{ display: 'flex', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 40 }}>
          <Text strong style={{ width: 70, textAlign: 'right' }}>
            总市值：
          </Text>
          <Text style={labelValueStyle}>
            {formatWithSymbol(summary.totalMarketValueLocal)}
            {shouldShowApprox && (
              <Text
                type="secondary"
                style={{ fontSize: '12px', marginLeft: '4px' }}
              >
                (约 ¥
                {summary.totalMarketValueCNY.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                )
              </Text>
            )}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Text strong style={{ width: 70, textAlign: 'right' }}>
            总盈亏：
          </Text>
          <Text
            style={{
              ...labelValueStyle,
              color: summary.totalPnlLocal >= 0 ? '#f5222d' : '#52c41a',
            }}
          >
            {formatWithSymbol(summary.totalPnlLocal)}
            {shouldShowApprox && (
              <Text
                type="secondary"
                style={{ fontSize: '12px', marginLeft: '4px' }}
              >
                (约 ¥
                {summary.totalPnlCNY.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                )
              </Text>
            )}
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
}

// 可排序市场配置项组件
const SortableMarketItem: React.FC<{
  market: MarketConfig;
  children: React.ReactNode;
}> = ({ market, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: market.key,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

// 主组件
const MarketAssetsPanel: React.FC<{
  portfolioId: string;
  positions: PositionWithStats[]; // Use specific type from store/types
  transactions: Transaction[];
  stats?: PortfolioStats | null;
}> = ({ portfolioId, positions, transactions, stats }) => {
  console.log(
    '[MarketAssetsPanel] Received positions prop:',
    JSON.stringify(positions)
  ); // Log received positions
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [rates, setRates] = useState<{
    USD: number;
    HKD: number;
    CNY: number;
  } | null>(null); // Use specific type or Record<string, number>
  const [updatedAt, setUpdatedAt] = useState('');
  const [loadingRates, setLoadingRates] = useState(true); // Add loading state
  const [rateError, setRateError] = useState(false);

  // 添加行情数据状态
  const [quoteMap, setQuoteMap] = useState<Record<string, Quote>>({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const messageApi = useMessageApi();

  // 从 store 获取市场配置和组合统计数据
  const marketConfigs = useAppStore((state) => state.marketConfigs);
  const setMarketConfigs = useAppStore((state) => state.setMarketConfigs);

  // 市场配置管理模态框状态
  const [isConfigModalVisible, setIsConfigModalVisible] = useState(false);
  const [editingMarket, setEditingMarket] = useState<MarketConfig | null>(null);
  const [newMarketKey, setNewMarketKey] = useState('');
  const [newMarketLabel, setNewMarketLabel] = useState('');
  const [newMarketCurrency, setNewMarketCurrency] = useState('CNY');
  const [newMarketSymbol, setNewMarketSymbol] = useState('¥');
  const [newMarketPrefix, setNewMarketPrefix] = useState('');

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    setLoadingRates(true);
    setRateError(false);
    const loadRates = async () => {
      try {
        // Use the correctly imported function name
        const fetchedData = await fetchExchangeRates();
        if (fetchedData.error) {
          setRateError(true);
          // fetchExchangeRates 失败时已返回统一兜底值
          setRates({
            USD: fetchedData.USD,
            HKD: fetchedData.HKD,
            CNY: 1.0,
          });
          setUpdatedAt(new Date(fetchedData.updatedAt).toLocaleString()); // Use fallback time
          messageApi.error('获取实时汇率失败，使用估算值。');
        } else {
          setRateError(false);
          // Ensure CNY rate is included if missing from API response
          setRates({ ...fetchedData, CNY: 1.0 });
          setUpdatedAt(new Date(fetchedData.updatedAt).toLocaleString());
        }
      } catch (err) {
        console.error('Error in loadRates (MarketAssetsPanel):', err);
        setRateError(true);
        setRates({ ...FALLBACK_EXCHANGE_RATES });
        setUpdatedAt(new Date().toLocaleString());
        messageApi.error('获取实时汇率时发生错误，使用估算值。');
      } finally {
        setLoadingRates(false);
      }
    };
    loadRates();
  }, [messageApi]); // Fetch rates on mount

  // 加载行情数据
  useEffect(() => {
    const loadQuotes = async () => {
      if (!positions.length) return;

      setLoadingQuotes(true);
      setQuoteError(false);

      try {
        // 提取所有持仓的股票代码
        const positionCodes = positions
          .map((p) => p.asset?.code)
          .filter(Boolean);

        // 从交易记录中提取股票代码
        const transactionCodes = transactions
          .map((t) => t.assetCode)
          .filter(Boolean);

        // 合并并去重所有股票代码
        const allRelevantCodes = Array.from(
          new Set([...positionCodes, ...transactionCodes])
        );

        if (!allRelevantCodes.length) return;

        console.log(
          '[MarketAssetsPanel DEBUG] Codes sent to fetchQuotes:',
          JSON.stringify(allRelevantCodes)
        );

        // 使用完整的代码列表调用行情接口获取数据
        const quotes = await apiClient.fetchQuotes(allRelevantCodes);
        console.log(
          '[MarketAssetsPanel DEBUG] Quotes received from API:',
          JSON.stringify(quotes)
        );

        // 创建以股票代码为键的映射表
        const newQuoteMap = quotes.reduce(
          (acc, quote) => {
            acc[quote.code] = quote;
            return acc;
          },
          {} as Record<string, Quote>
        );

        setQuoteMap(newQuoteMap);
        console.log(
          '[MarketAssetsPanel DEBUG] Final quoteMap passed to TransactionList:',
          JSON.stringify(newQuoteMap)
        );
      } catch (err) {
        console.error('[MarketAssetsPanel] 加载行情数据失败:', err);
        setQuoteError(true);
        messageApi.error('获取行情数据失败，周期涨幅可能无法正确显示。');
      } finally {
        setLoadingQuotes(false);
      }
    };

    loadQuotes();
  }, [positions, transactions, messageApi]); // 当持仓或交易数据变化时重新加载

  // 市场配置管理函数
  const handleAddMarket = () => {
    if (
      !newMarketKey.trim() ||
      !newMarketLabel.trim() ||
      !newMarketPrefix.trim()
    ) {
      messageApi.error('请填写所有必填字段');
      return;
    }
    if (marketConfigs.some((m) => m.key === newMarketKey)) {
      messageApi.error('市场标识已存在');
      return;
    }
    const newMarket: MarketConfig = {
      key: newMarketKey,
      label: newMarketLabel,
      currency: newMarketCurrency,
      symbol: newMarketSymbol,
      codePrefix: newMarketPrefix
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      visible: true,
    };
    setMarketConfigs([...marketConfigs, newMarket]);
    messageApi.success('市场添加成功');
    // 清空表单
    setNewMarketKey('');
    setNewMarketLabel('');
    setNewMarketCurrency('CNY');
    setNewMarketSymbol('¥');
    setNewMarketPrefix('');
  };

  const handleUpdateMarket = (key: string, updates: Partial<MarketConfig>) => {
    setMarketConfigs(
      marketConfigs.map((m) => (m.key === key ? { ...m, ...updates } : m))
    );
    messageApi.success('市场配置已更新');
  };

  const handleDeleteMarket = (key: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除市场 "${marketConfigs.find((m) => m.key === key)?.label}" 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setMarketConfigs(marketConfigs.filter((m) => m.key !== key));
        messageApi.success('市场已删除');
      },
    });
  };

  const handleToggleMarketVisible = (key: string) => {
    setMarketConfigs(
      marketConfigs.map((m) =>
        m.key === key ? { ...m, visible: !m.visible } : m
      )
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = marketConfigs.findIndex((m) => m.key === active.id);
      const newIndex = marketConfigs.findIndex((m) => m.key === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(marketConfigs, oldIndex, newIndex);
        setMarketConfigs(newOrder);
      }
    }
  };

  const handleEditMarket = (market: MarketConfig) => {
    setEditingMarket(market);
    setNewMarketKey(market.key);
    setNewMarketLabel(market.label);
    setNewMarketCurrency(market.currency);
    setNewMarketSymbol(market.symbol);
    setNewMarketPrefix(market.codePrefix.join(', '));
  };

  const handleSaveEdit = () => {
    if (!editingMarket || !newMarketLabel.trim() || !newMarketPrefix.trim()) {
      messageApi.error('请填写所有必填字段');
      return;
    }
    handleUpdateMarket(editingMarket.key, {
      label: newMarketLabel,
      currency: newMarketCurrency,
      symbol: newMarketSymbol,
      codePrefix: newMarketPrefix
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setEditingMarket(null);
    setNewMarketKey('');
    setNewMarketLabel('');
    setNewMarketCurrency('CNY');
    setNewMarketSymbol('¥');
    setNewMarketPrefix('');
  };

  const handleCancelEdit = () => {
    setEditingMarket(null);
    setNewMarketKey('');
    setNewMarketLabel('');
    setNewMarketCurrency('CNY');
    setNewMarketSymbol('¥');
    setNewMarketPrefix('');
  };

  // 将原始持仓转换为含人民币价值和周期涨幅
  // 注意：后端返回的 marketValue, costPrice, totalCost 等字段已经是人民币金额
  // 不需要再次乘以汇率，否则会导致数据错误
  const positionsWithCny: EnhancedPosition[] = positions.map((p) => {
    // 从行情数据中获取周期涨幅
    const quote = p.asset?.code ? quoteMap[p.asset.code] : null;

    // Currency is inferred from asset market, not stored in position

    // 后端已经将所有数据转换为人民币，这里直接使用即可
    // 不要再次乘以汇率！
    const marketValue =
      p.marketValue || (p.currentPrice ?? 0) * (p.quantity ?? 0);
    const costValue = (p.costPrice ?? 0) * (p.quantity ?? 0);

    // ✅ 修复：直接使用后端返回的人民币数据，不再乘以汇率
    const marketValueCNY = marketValue; // 后端已是人民币
    const costValueCNY = costValue; // 后端已是人民币
    const pnlCNY = marketValueCNY - costValueCNY;

    return {
      ...p,
      marketValueCNY,
      costValueCNY,
      pnlCNY,
      pnlRateCNY: costValueCNY > 0 ? (pnlCNY / costValueCNY) * 100 : 0,
      // 添加周期涨幅字段，优先使用行情数据
      weeklyChangePercent:
        quote?.weeklyChangePercent ?? p.weeklyChangePercent ?? undefined,
      monthlyChangePercent:
        quote?.monthlyChangePercent ?? p.monthlyChangePercent ?? undefined,
      yearlyChangePercent:
        quote?.yearlyChangePercent ?? p.yearlyChangePercent ?? undefined,
    };
  });

  // 计算各市场汇总（使用可配置的市场）
  const marketSummaries = marketConfigs.reduce(
    (acc, market) => {
      // Filter positions based on assetCode prefix for market grouping
      const marketPositions = positionsWithCny.filter((p) => {
        if (!p.asset?.code) return false; // 如果没有 code，直接过滤掉
        return market.codePrefix.some((prefix) =>
          p.asset.code.startsWith(prefix)
        );
      });
      const totalMarketValueLocal = marketPositions.reduce(
        (sum, p) => sum + getMarketValueInDisplayCurrency(p),
        0
      );
      const totalMarketValueCNY = marketPositions.reduce(
        (sum, p) => sum + (p.marketValue ?? p.marketValueCNY ?? 0),
        0
      );
      const totalPnlCNY = marketPositions.reduce(
        (sum, p) => sum + (p.totalPnl ?? p.pnlCNY ?? 0),
        0
      );

      // 将CNY盈亏转换为本地货币
      // 对于港股/美股：盈亏CNY / 汇率 = 盈亏本地货币
      // 对于A股：盈亏CNY = 盈亏本地货币
      const exchangeRate =
        rates?.[market.currency as 'USD' | 'HKD' | 'CNY'] ?? 1.0;
      const totalPnlLocal =
        market.currency === 'CNY' ? totalPnlCNY : totalPnlCNY / exchangeRate;

      return {
        ...acc,
        [market.key]: {
          totalMarketValueLocal,
          totalMarketValueCNY,
          totalPnlLocal,
          totalPnlCNY,
          currencySymbol: market.symbol,
          currencyCode: market.currency,
        },
      };
    },
    {} as Record<string, MarketSummary>
  );

  // 新增：根据 positionsWithCny 汇总全局统计
  const toggleMarket = (market: string) => {
    setCollapsed((prev) => ({ ...prev, [market]: !prev[market] }));
  };

  // 统一卡片样式
  const cardStyle = {
    marginBottom: 20,
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    borderRadius: '8px',
  };

  const cardHeadStyle = {
    borderBottom: 0,
    background: '#fafafa',
    padding: '12px 24px',
    height: '60px',
  };

  return (
    <div>
      {/* 市场配置按钮 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: '16px',
        }}
      >
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => setIsConfigModalVisible(true)}
        >
          管理市场分类
        </Button>
      </div>

      {/* 添加行情数据加载状态指示 */}
      {loadingQuotes && (
        <div style={{ margin: '10px 0' }}>
          <Spin size="small" /> 加载行情数据中...
        </div>
      )}
      {quoteError && (
        <div style={{ margin: '10px 0', color: '#ff4d4f' }}>
          行情数据加载失败，周期涨幅可能无法正确显示。
        </div>
      )}

      {/* Pass loading state to potentially show a spinner or placeholder */}
      {loadingRates ? (
        <Spin tip="加载汇率中...">
          <div style={{ height: '36px', marginBottom: '20px' }}>
            <ExchangeRateBar
              rates={{ USD: 0, HKD: 0, CNY: 1 }}
              updatedAt="-"
              error={true}
            />
          </div>
        </Spin>
      ) : (
        <ExchangeRateBar
          rates={rates ?? { USD: 0, HKD: 0, CNY: 1 }}
          updatedAt={updatedAt}
          error={rateError}
        />
      )}

      {marketConfigs
        .filter((m) => m.visible)
        .map((market) => {
          const summary = marketSummaries[market.key] ?? {
            totalMarketValueLocal: 0,
            totalMarketValueCNY: 0,
            totalPnlLocal: 0,
            totalPnlCNY: 0,
            currencySymbol: market.symbol,
            currencyCode: market.currency,
          };
          // Filter positions for the current market before logging and rendering
          const marketPositions = positionsWithCny.filter((p) => {
            if (!p.asset?.code) return false; // 如果没有 code，直接过滤掉

            // 开启日志以便调试
            console.log(
              `[MarketAssetsPanel] 检查持仓: market=${market.key}, code=${p.asset.code}`
            );

            const match = market.codePrefix.some((prefix) =>
              p.asset.code.startsWith(prefix)
            );
            console.log(`[MarketAssetsPanel] 过滤结果: match=${match}`);
            return match;
          });

          return (
            <Card
              key={market.key}
              title={
                <MarketTitle marketName={market.label} summary={summary} />
              }
              extra={
                <a
                  onClick={() => toggleMarket(market.key)}
                  style={{ fontSize: 13 }}
                >
                  {collapsed[market.key] ? '展开' : '折叠'}
                </a>
              }
              style={cardStyle}
              bodyStyle={{
                display: collapsed[market.key] ? 'none' : 'block',
                padding: 0,
                borderTop: '1px solid #f0f0f0',
              }}
              headStyle={cardHeadStyle}
            >
              <PositionsTable
                positions={marketPositions} // Pass the filtered positions
                totalMarketValue={stats?.totalMarketValue} // 传递后端计算的总市值
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

      {/* 市场配置管理模态框 */}
      <Modal
        title="管理市场分类"
        open={isConfigModalVisible}
        onCancel={() => {
          setIsConfigModalVisible(false);
          handleCancelEdit();
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setIsConfigModalVisible(false);
              handleCancelEdit();
            }}
          >
            关闭
          </Button>,
        ]}
        width={700}
      >
        {/* 已有市场列表 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>
            已配置市场（拖拽排序）
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={marketConfigs.map((m) => m.key)}
              strategy={verticalListSortingStrategy}
            >
              {marketConfigs.map((market) => (
                <SortableMarketItem key={market.key} market={market}>
                  <Card
                    size="small"
                    style={{
                      marginBottom: 8,
                      cursor: 'move',
                      background: market.visible ? '#fff' : '#f5f5f5',
                      opacity: market.visible ? 1 : 0.6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {market.label} ({market.key})
                        </div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                          货币: {market.currency} {market.symbol} | 代码前缀:{' '}
                          {market.codePrefix.join(', ')}
                        </div>
                      </div>
                      <Space>
                        <Button
                          size="small"
                          type={market.visible ? 'default' : 'primary'}
                          onClick={() => handleToggleMarketVisible(market.key)}
                        >
                          {market.visible ? '隐藏' : '显示'}
                        </Button>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => handleEditMarket(market)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeleteMarket(market.key)}
                        >
                          删除
                        </Button>
                      </Space>
                    </div>
                  </Card>
                </SortableMarketItem>
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* 添加/编辑市场表单 */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>
            {editingMarket ? '编辑市场' : '添加新市场'}
          </div>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {!editingMarket && (
              <Input
                placeholder="市场标识 (唯一键，如: 日股)"
                value={newMarketKey}
                onChange={(e) => setNewMarketKey(e.target.value)}
                disabled={!!editingMarket}
              />
            )}
            <Input
              placeholder="显示名称 (如: 日本股票)"
              value={newMarketLabel}
              onChange={(e) => setNewMarketLabel(e.target.value)}
            />
            <Space.Compact style={{ width: '100%' }}>
              <Select
                style={{ width: '50%' }}
                value={newMarketCurrency}
                onChange={setNewMarketCurrency}
                options={[
                  { label: 'CNY (人民币)', value: 'CNY' },
                  { label: 'USD (美元)', value: 'USD' },
                  { label: 'HKD (港币)', value: 'HKD' },
                  { label: 'JPY (日元)', value: 'JPY' },
                  { label: 'EUR (欧元)', value: 'EUR' },
                  { label: 'GBP (英镑)', value: 'GBP' },
                ]}
              />
              <Input
                style={{ width: '50%' }}
                placeholder="货币符号 (如: ¥)"
                value={newMarketSymbol}
                onChange={(e) => setNewMarketSymbol(e.target.value)}
              />
            </Space.Compact>
            <Input
              placeholder="代码前缀 (多个用逗号分隔，如: jp, nikkei)"
              value={newMarketPrefix}
              onChange={(e) => setNewMarketPrefix(e.target.value)}
            />
            {editingMarket ? (
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={handleSaveEdit}
                >
                  保存修改
                </Button>
                <Button onClick={handleCancelEdit}>取消</Button>
              </Space>
            ) : (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAddMarket}
                block
              >
                添加市场
              </Button>
            )}
          </Space>
        </div>
      </Modal>
    </div>
  );
};

export default MarketAssetsPanel;
