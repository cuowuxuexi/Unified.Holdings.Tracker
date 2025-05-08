import React, { useEffect, useState } from 'react';
import { Card, Typography, Spin, Divider, Alert, Button, Modal, Input, Space, Tag, message } from 'antd'; // Removed Col, Row, Checkbox, Form
import { SettingOutlined, PlusOutlined } from '@ant-design/icons';
import useAppStore from '../store'; // Import the Zustand store
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SelectedIndexItem } from '../store/types';
import { formatPercent } from './utils/format';

const { Title, Text } = Typography;

// 验证指数代码格式
const validateIndexCode = (code: string): boolean => {
  // 支持的格式：sh/sz/hk开头的数字，hk开头的字母，或us开头加字母
  return /^(sh|sz)\d+$/.test(code) || /^hk(\d+|[A-Za-z]+)$/.test(code) || /^us[A-Za-z]+$/.test(code);
};

// SortableItem组件，包裹Tag
const SortableItem: React.FC<{ item: SelectedIndexItem; children: React.ReactNode }> = ({ item, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${item.type}-${item.code}`
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'inline-block',
    marginRight: 8,
    marginBottom: 8,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

const MarketIndices: React.FC = () => {
  // MODIFIED: Select state and actions individually to prevent infinite loops
  const marketIndicesData = useAppStore((state) => state.marketIndicesData);
  const isLoadingMarketIndices = useAppStore((state) => state.isLoadingMarketIndices);
  const marketIndicesError = useAppStore((state) => state.marketIndicesError);
  const fetchMarketIndices = useAppStore((state) => state.fetchMarketIndices);
  const selectedIndices = useAppStore((state) => state.selectedIndices);
  const setSelectedIndices = useAppStore((state) => state.setSelectedIndices);

  // State for modal visibility
  const [isModalVisible, setIsModalVisible] = useState(false);
  // 新增状态用于自定义指数输入
  const [customIndexCode, setCustomIndexCode] = useState('');
  const [customCodeError, setCustomCodeError] = useState('');
  // 1. 新增 activeTab 状态
  const [activeTab, setActiveTab] = useState<'market' | 'stock'>('market');

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleOk = () => {
    setIsModalVisible(false);
    // Data is refetched by the useEffect hook below based on selectedIndices change
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  // handleCheckboxChange is removed as Checkbox group is replaced by Tags

  // 添加自定义指数的处理函数
  const handleAddCustomIndex = () => {
    setCustomCodeError('');
    if (!customIndexCode.trim()) {
      setCustomCodeError('请输入指数代码');
      return;
    }
    if (!validateIndexCode(customIndexCode)) {
      setCustomCodeError('格式无效，请使用正确的指数代码格式（如 sh000001, hkHSI, usNDAQ）');
      return;
    }
    if (selectedIndices.some(item => item.code === customIndexCode && item.type === activeTab)) {
      setCustomCodeError('该指数已在当前区块列表中');
      return;
    }
    setSelectedIndices([...selectedIndices, { code: customIndexCode, name: '', visible: true, type: activeTab }]);
    setCustomIndexCode('');
    message.success('成功添加指数');
  };

  // 删除指数的处理函数
  const handleRemoveIndex = (indexCode: string) => {
    setSelectedIndices(selectedIndices.filter(item => !(item.code === indexCode && item.type === activeTab)));
  };

  // Tag点击切换visible
  const handleToggleVisible = (indexCode: string) => {
    setSelectedIndices(selectedIndices.map(item =>
      item.code === indexCode && item.type === activeTab ? { ...item, visible: !item.visible } : item
    ));
  };

  // 拖拽排序
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      // 只对当前区块的type进行排序
      const filtered = selectedIndices.filter(item => item.type === activeTab);
      const other = selectedIndices.filter(item => item.type !== activeTab);
      // 新的唯一id
      const getId = (item: typeof filtered[0]) => `${item.type}-${item.code}`;
      const oldIndex = filtered.findIndex(item => getId(item) === active.id);
      const newIndex = filtered.findIndex(item => getId(item) === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(filtered, oldIndex, newIndex);
        setSelectedIndices([...other, ...newOrder]);
      } else {
        console.error('Could not find dragged item indices in selectedIndices array.');
      }
    }
  };

  // Fetch data when the component mounts or selectedIndices change
  useEffect(() => {
    // Check if selectedIndices is actually defined and has changed if needed,
    // though Zustand handles shallow equality checks for primitives/arrays now.
    // The dependency array correctly triggers fetch when selectedIndices changes.
    fetchMarketIndices();
  }, [fetchMarketIndices, selectedIndices]); // Keep dependencies

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* 顶部切换标签 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 18,
              color: activeTab === 'market' ? '#222' : '#888',
              cursor: activeTab === 'market' ? 'default' : 'pointer',
              marginRight: 12,
              borderBottom: activeTab === 'market' ? '2px solid #1890ff' : 'none',
              paddingBottom: 2,
              transition: 'color 0.2s'
            }}
            onClick={() => setActiveTab('market')}
          >
            大盘
          </span>
          <span
            style={{
              fontWeight: 700,
              fontSize: 18,
              color: activeTab === 'stock' ? '#222' : '#888',
              cursor: activeTab === 'stock' ? 'default' : 'pointer',
              marginLeft: 0,
              borderBottom: activeTab === 'stock' ? '2px solid #1890ff' : 'none',
              paddingBottom: 2,
              transition: 'color 0.2s'
            }}
            onClick={() => setActiveTab('stock')}
          >
            ➡️个股
          </span>
        </div>
        <Button type="text" shape="circle" icon={<SettingOutlined />} onClick={showModal} />
      </div>
      <Divider />
      {isLoadingMarketIndices ? (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Spin size="large" />
        </div>
      ) : marketIndicesError ? (
        <Alert message="加载指数数据失败" description={marketIndicesError} type="error" showIcon />
      ) : (
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '16px',
          justifyContent: 'flex-start',
          margin: '0 auto',
          maxWidth: '98%'
        }}>
          {selectedIndices.filter(item => item.visible && item.type === activeTab).map((item) => {
            const index = marketIndicesData.find(idx => idx.code === item.code);
            if (!index) return null;
            return (
              <Card
                key={index.code}
                style={{
                  background: 'linear-gradient(135deg, #fafbfc 0%, #f5f6fa 100%)',
                  borderRadius: '4px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  height: '110px',
                  minWidth: 155,
                  maxWidth: 170,
                  flex: '0 0 auto',
                  position: 'relative',
                  paddingLeft: '10px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  transition: 'box-shadow 0.2s',
                  cursor: 'default',
                }}
                styles={{ body: { padding: '8px 10px 8px 0', height: '100%' } }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)';
                }}
              >
                {/* 左侧色条 */}
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '3px',
                  borderRadius: '2px',
                  background: index.changePercent >= 0 ? '#f5222d' : '#52c41a'
                }} />
                <div style={{ width: '100%', minWidth: 0 }}>
                  {/* 指数名称 */}
                  <div style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    marginBottom: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: '#222'
                  }}>{index.name || item.code}</div>
                  {/* 价格单独一行 */}
                  <div style={{
                    fontWeight: 700,
                    fontSize: '16px',
                    color: '#111',
                    marginBottom: '2px',
                    lineHeight: 1.1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0
                  }}>
                    {typeof index.currentPrice === 'number' ? index.currentPrice.toFixed(2) : 'N/A'}
                  </div>
                  {/* 日涨跌单独一行 */}
                  <div style={{
                    color: index.changePercent >= 0 ? '#f5222d' : '#52c41a',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '13px',
                    marginBottom: '2px',
                    minWidth: 0
                  }}>
                    {typeof index.changeAmount === 'number' ? Math.abs(index.changeAmount).toFixed(2) : 'N/A'}
                    &nbsp;({typeof index.changePercent === 'number' ? Math.abs(index.changePercent).toFixed(2) + '%' : 'N/A'})
                    <span style={{ fontSize: '11px', marginLeft: 2 }}>
                      {typeof index.changePercent === 'number' ? (index.changePercent >= 0 ? '▲' : '▼') : ''}
                    </span>
                  </div>
                  {/* 分隔线 */}
                  <div style={{ borderTop: '1px dashed #eee', margin: '2px 0 3px 0' }} />
                  {/* W/M/Y+数字一行展示 */}
                  <div style={{
                    fontSize: '11px',
                    color: '#999',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0 16px',
                    letterSpacing: 0,
                    minWidth: 0
                  }}>
                    <span style={{ color: typeof index.weekChangePercent !== 'number' ? '#ccc' : (index.weekChangePercent >= 0 ? '#f5222d' : '#52c41a'), minWidth: 0 }}>
                      W{typeof index.weekChangePercent === 'number' ? formatPercent(Math.abs(index.weekChangePercent), 2) : 'N/A'}
                    </span>
                    <span style={{ color: typeof index.monthChangePercent !== 'number' ? '#ccc' : (index.monthChangePercent >= 0 ? '#f5222d' : '#52c41a'), minWidth: 0 }}>
                      M{typeof index.monthChangePercent === 'number' ? formatPercent(Math.abs(index.monthChangePercent), 2) : 'N/A'}
                    </span>
                    <span style={{ color: typeof index.yearChangePercent !== 'number' ? '#ccc' : (index.yearChangePercent >= 0 ? '#f5222d' : '#52c41a'), minWidth: 0 }}>
                      Y{typeof index.yearChangePercent === 'number' ? formatPercent(Math.abs(index.yearChangePercent), 2) : 'N/A'}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal
        title={`管理和排序${activeTab === 'market' ? '大盘' : '个股'}`}
        open={isModalVisible}
        onOk={handleOk}
        onCancel={handleCancel}
        footer={[
          <Button key="back" onClick={handleCancel}>
            关闭
          </Button>,
        ]}
        width={600}
      >
        {/* 仅保留已选指数管理区 */}
        <div>
          <Title level={5}>已选{activeTab === 'market' ? '大盘' : '个股'}（拖拽排序）</Title>
          <div style={{ marginTop: '16px', padding: '10px', border: '1px dashed #d9d9d9', borderRadius: '4px', minHeight: '100px' }}>
            {selectedIndices.filter(item => item.type === activeTab).length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={selectedIndices.filter(item => item.type === activeTab).map(item => `${item.type}-${item.code}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {selectedIndices.filter(item => item.type === activeTab).map(item => {
                    const index = marketIndicesData.find(idx => idx.code === item.code);
                    return (
                      <SortableItem key={`${item.type}-${item.code}`} item={item}>
                        <Tag
                          color={item.visible ? 'blue' : undefined}
                          style={{
                            cursor: 'pointer',
                            background: item.visible ? undefined : '#f5f5f5',
                            color: item.visible ? undefined : '#aaa',
                            borderColor: item.visible ? undefined : '#d9d9d9',
                            userSelect: 'none',
                          }}
                          closable
                          onClose={e => {
                            e.stopPropagation();
                            handleRemoveIndex(item.code);
                          }}
                          onClick={() => handleToggleVisible(item.code)}
                        >
                          {index?.name || item.code}
                        </Tag>
                      </SortableItem>
                    );
                  })}
                </SortableContext>
              </DndContext>
            ) : (
              <Text type="secondary">暂未选择任何{activeTab === 'market' ? '大盘' : '个股'}。请添加。</Text>
            )}
          </div>
        </div>
        {/* 添加新指数入口可根据 activeTab 区分 */}
        <div style={{ marginTop: 24 }}>
          <Title level={5}>添加{activeTab === 'market' ? '大盘' : '个股'}</Title>
          <Space.Compact style={{ width: '100%', marginTop: '8px' }}>
            <Input
              placeholder={`输入${activeTab === 'market' ? '大盘' : '个股'}代码 (如 sh000001)`}
              value={customIndexCode}
              onChange={e => {
                setCustomIndexCode(e.target.value);
                setCustomCodeError('');
              }}
              status={customCodeError ? 'error' : ''}
              onPressEnter={handleAddCustomIndex}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddCustomIndex}
            >
              添加
            </Button>
          </Space.Compact>
          {customCodeError && (
            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '4px' }}>
              {customCodeError}
            </div>
          )}
          <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            格式指南：上证/深证指数使用 sh/sz 前缀 (如 sh000001)，港股用 hk 前缀，美股用 us 前缀
          </div>
        </div>
      </Modal>
    </div>
  );
};

export { MarketIndices as default };
