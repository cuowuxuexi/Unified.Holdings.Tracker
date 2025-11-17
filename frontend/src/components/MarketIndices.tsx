import React, { useEffect, useMemo, useState } from 'react';
import { Card, Typography, Spin, Divider, Alert, Button, Modal, Input, Space, Tag } from 'antd';
import { SettingOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import useAppStore from '../store';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SelectedIndexItem, IndexCategory } from '../store/types';
import { formatPercent } from '../shared/utils/formatters';
import useMessageApi from '../hooks/useMessageApi';

const { Title, Text } = Typography;

const PERIOD_UP_COLOR = '#fa541c';
const PERIOD_DOWN_COLOR = '#52c41a';
const PERIOD_FLAT_COLOR = '#999';

const renderPeriodChangeTag = (label: string, value?: number | null) => {
  if (value === undefined || value === null) return null;
  const color = value > 0 ? PERIOD_UP_COLOR : value < 0 ? PERIOD_DOWN_COLOR : PERIOD_FLAT_COLOR;

  return (
    <span style={{ color, fontWeight: 600 }}>
      {label}
      {/* 后端返回的周期涨幅已经是百分比数值，不需要再乘以100 */}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
};

// 验证指数代码格式
const validateIndexCode = (code: string): boolean => {
  // 支持的格式：sh/sz/hk开头的数字，hk开头的字母，或us开头加字母
  return /^(sh|sz)\d+$/.test(code) || /^hk(\d+|[A-Za-z]+)$/.test(code) || /^us[A-Za-z]+$/.test(code);
};

// SortableItem组件，包裹Tag
const SortableItem: React.FC<{ item: SelectedIndexItem; children: React.ReactNode }> = ({ item, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${item.categoryId}-${item.code}`
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

// 可排序的分类标签组件
const SortableCategoryTab: React.FC<{ category: IndexCategory; isActive: boolean; onClick: () => void }> = ({ category, isActive, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'inline-block',
    marginRight: 12,
  };
  
  // 处理点击事件，确保点击能够触发
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };
  
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <span
        style={{
          fontWeight: 700,
          fontSize: 18,
          color: isActive ? '#222' : '#888',
          cursor: 'pointer',
          borderBottom: isActive ? '2px solid #1890ff' : 'none',
          paddingBottom: 2,
          transition: 'color 0.2s',
          display: 'inline-block',
        }}
        onClick={handleClick}
      >
        {category.label}
      </span>
      {/* 拖拽手柄，使用单独的元素 */}
      <span {...listeners} style={{ display: 'inline-block', width: 0, height: 0, position: 'absolute' }} />
    </div>
  );
};

const MarketIndices: React.FC = () => {
  // Store state
  const marketIndicesData = useAppStore((state) => state.marketIndicesData);
  const isLoadingMarketIndices = useAppStore((state) => state.isLoadingMarketIndices);
  const marketIndicesError = useAppStore((state) => state.marketIndicesError);
  const fetchMarketIndices = useAppStore((state) => state.fetchMarketIndices);
  const selectedIndices = useAppStore((state) => state.selectedIndices);
  const setSelectedIndices = useAppStore((state) => state.setSelectedIndices);
  const indexCategories = useAppStore((state) => state.indexCategories);
  const setIndexCategories = useAppStore((state) => state.setIndexCategories);
  const addIndexCategory = useAppStore((state) => state.addIndexCategory);
  const updateIndexCategory = useAppStore((state) => state.updateIndexCategory);
  const deleteIndexCategory = useAppStore((state) => state.deleteIndexCategory);
  const reorderIndexCategories = useAppStore((state) => state.reorderIndexCategories);

  // Local state
  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);
  const [isAddCategoryModalVisible, setIsAddCategoryModalVisible] = useState(false);
  const [isEditCategoryModalVisible, setIsEditCategoryModalVisible] = useState(false);
  const [customIndexCode, setCustomIndexCode] = useState('');
  const [customCodeError, setCustomCodeError] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<IndexCategory | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [draftCategories, setDraftCategories] = useState<IndexCategory[]>([]);
  const [draftIndices, setDraftIndices] = useState<SelectedIndexItem[]>([]);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isEditingDraftCategory, setIsEditingDraftCategory] = useState(false);
  
  // 获取可见的分类，并按 order 排序
  const visibleCategories = indexCategories
    .filter(cat => cat.visible)
    .sort((a, b) => a.order - b.order);
  
  // 当前激活的分类 ID
  const [activeCategoryId, setActiveCategoryId] = useState<string>(
    visibleCategories.length > 0 ? visibleCategories[0].id : ''
  );

  const messageApi = useMessageApi();

  // 同步草稿状态到最新 store 数据
  useEffect(() => {
    if (isSettingsModalVisible) {
      setDraftCategories(indexCategories.map(cat => ({ ...cat })));
      setDraftIndices(selectedIndices.map(item => ({ ...item })));
      setIsDraftDirty(false);
    }
  }, [isSettingsModalVisible, indexCategories, selectedIndices]);

  // 当分类列表变化时，确保 activeCategoryId 仍然有效
  useEffect(() => {
    if (!visibleCategories.find(cat => cat.id === activeCategoryId)) {
      if (visibleCategories.length > 0) {
        setActiveCategoryId(visibleCategories[0].id);
      }
    }
  }, [visibleCategories, activeCategoryId]);

  const activeCategoryIndices = useMemo(
    () => selectedIndices.filter((item) => item.categoryId === activeCategoryId),
    [selectedIndices, activeCategoryId]
  );

  const modalCategoryIndices = useMemo(
    () =>
      (isSettingsModalVisible ? draftIndices : selectedIndices).filter(
        (item) => item.categoryId === activeCategoryId
      ),
    [isSettingsModalVisible, draftIndices, selectedIndices, activeCategoryId]
  );

  const settingsCategories = isSettingsModalVisible ? draftCategories : indexCategories;
  const activeCategoryLabel = settingsCategories.find(cat => cat.id === activeCategoryId)?.label || '';

  // Fetch data when selectedIndices change
  useEffect(() => {
    if (isSettingsModalVisible || selectedIndices.length === 0) return;
    const timer = setTimeout(() => {
      fetchMarketIndices();
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedIndices, fetchMarketIndices, isSettingsModalVisible]);

  const showSettingsModal = () => {
    setIsSettingsModalVisible(true);
  };

  const closeSettingsModal = () => {
    setIsSettingsModalVisible(false);
    setDraftCategories([]);
    setDraftIndices([]);
    setIsDraftDirty(false);
  };

  const handleSettingsSave = () => {
    if (isDraftDirty) {
      const normalizedCategories = draftCategories.map((cat, index) => ({ ...cat, order: index }));
      setIndexCategories(normalizedCategories);
      setSelectedIndices(draftIndices);
    }
    closeSettingsModal();
  };

  const handleSettingsCancel = () => {
    if (!isDraftDirty) {
      closeSettingsModal();
      return;
    }
    Modal.confirm({
      title: '放弃未保存的修改？',
      okText: '放弃',
      cancelText: '继续编辑',
      onOk: closeSettingsModal,
    });
  };

  // 添加新分类
  const handleAddCategory = () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      messageApi.warning('请输入栏目名称');
      return;
    }

    if (isSettingsModalVisible) {
      setDraftCategories((prev) => {
        const nextOrder = prev.length > 0 ? Math.max(...prev.map((c) => c.order)) + 1 : 0;
        setIsDraftDirty(true);
        return [
          ...prev,
          {
            id: `category_${Date.now()}`,
            label: trimmedName,
            visible: true,
            order: nextOrder,
          },
        ];
      });
    } else {
      addIndexCategory({ label: trimmedName, visible: true });
    }

    setNewCategoryName('');
    setIsAddCategoryModalVisible(false);
  };

  // 编辑分类
  const handleEditCategory = (category: IndexCategory) => {
    setEditingCategory(category);
    setEditCategoryName(category.label);
    setIsEditingDraftCategory(isSettingsModalVisible);
    setIsEditCategoryModalVisible(true);
  };

  const handleSaveEditCategory = () => {
    if (!editCategoryName.trim() || !editingCategory) {
      messageApi.warning('请输入栏目名称');
      return;
    }
    const updatedLabel = editCategoryName.trim();
    if (isSettingsModalVisible || isEditingDraftCategory) {
      setDraftCategories((prev) => {
        setIsDraftDirty(true);
        return prev.map((cat) =>
          cat.id === editingCategory.id ? { ...cat, label: updatedLabel } : cat
        );
      });
    } else {
      updateIndexCategory(editingCategory.id, { label: updatedLabel });
    }
    setIsEditCategoryModalVisible(false);
    setEditingCategory(null);
    setIsEditingDraftCategory(false);
  };

  // 删除分类
  const handleDeleteCategory = (categoryId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除该栏目将同时删除该栏目下的所有指数，是否继续？',
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        if (isSettingsModalVisible) {
          setDraftCategories((prev) => {
            setIsDraftDirty(true);
            const filtered = prev.filter((cat) => cat.id !== categoryId);
            return filtered.map((cat, index) => ({ ...cat, order: index }));
          });
          setDraftIndices((prev) => {
            setIsDraftDirty(true);
            return prev.filter((item) => item.categoryId !== categoryId);
          });
        } else {
          deleteIndexCategory(categoryId);
        }
      },
    });
  };

  // 添加自定义指数
  const handleAddCustomIndex = () => {
    setCustomCodeError('');
    const trimmedCode = customIndexCode.trim();
    if (!trimmedCode) {
      setCustomCodeError('请输入指数代码');
      return;
    }
    if (!validateIndexCode(trimmedCode)) {
      setCustomCodeError('格式无效，请使用正确的指数代码格式（如 sh000001, hkHSI, usNDAQ）');
      return;
    }
    if (!activeCategoryId) {
      setCustomCodeError('请先选择栏目');
      return;
    }
    const workingIndices = isSettingsModalVisible ? draftIndices : selectedIndices;
    if (workingIndices.some(item => item.code === trimmedCode && item.categoryId === activeCategoryId)) {
      setCustomCodeError('该指数已在当前栏目列表中');
      return;
    }
    const updated = [...workingIndices, { code: trimmedCode, name: '', visible: true, categoryId: activeCategoryId }];
    if (isSettingsModalVisible) {
      setDraftIndices(updated);
      setIsDraftDirty(true);
    } else {
      setSelectedIndices(updated);
    }
    setCustomIndexCode('');
  };

  // 删除指数
  const handleRemoveIndex = (indexCode: string) => {
    const workingIndices = isSettingsModalVisible ? draftIndices : selectedIndices;
    const updated = workingIndices.filter(item => !(item.code === indexCode && item.categoryId === activeCategoryId));
    if (isSettingsModalVisible) {
      setDraftIndices(updated);
      setIsDraftDirty(true);
    } else {
      setSelectedIndices(updated);
    }
  };

  // Tag点击切换visible
  const handleToggleVisible = (indexCode: string) => {
    const workingIndices = isSettingsModalVisible ? draftIndices : selectedIndices;
    const updated = workingIndices.map(item =>
      (item.code === indexCode && item.categoryId === activeCategoryId)
        ? { ...item, visible: !item.visible }
        : item
    );
    if (isSettingsModalVisible) {
      setDraftIndices(updated);
      setIsDraftDirty(true);
    } else {
      setSelectedIndices(updated);
    }
  };

  // 拖拽排序处理 - 指数标签
  const handleDragEndIndices = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // 提取 code
    const activeCode = activeId.split('-').slice(1).join('-');
    const overCode = overId.split('-').slice(1).join('-');

    const sourceIndices = isSettingsModalVisible ? draftIndices : selectedIndices;
    // 只对当前分类下的指数进行排序
    const currentCategoryIndices = sourceIndices.filter(item => item.categoryId === activeCategoryId);
    const otherIndices = sourceIndices.filter(item => item.categoryId !== activeCategoryId);

    const oldIndex = currentCategoryIndices.findIndex(item => item.code === activeCode);
    const newIndex = currentCategoryIndices.findIndex(item => item.code === overCode);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedCurrent = arrayMove(currentCategoryIndices, oldIndex, newIndex);
      const next = [...otherIndices, ...reorderedCurrent];
      if (isSettingsModalVisible) {
        setDraftIndices(next);
        setIsDraftDirty(true);
      } else {
        setSelectedIndices(next);
      }
    }
  };

  // 拖拽排序处理 - 分类标签
  const handleDragEndCategories = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const oldIndex = indexCategories.findIndex(cat => cat.id === activeId);
    const newIndex = indexCategories.findIndex(cat => cat.id === overId);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedCategories = arrayMove(indexCategories, oldIndex, newIndex);
      reorderIndexCategories(reorderedCategories);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 当前分类下的指数（用于主卡片区域）
  const currentCategoryIndices = activeCategoryIndices;

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* 顶部分类标签栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndCategories}>
            <SortableContext items={visibleCategories.map(cat => cat.id)} strategy={horizontalListSortingStrategy}>
              {visibleCategories.map(category => (
                <SortableCategoryTab
                  key={category.id}
                  category={category}
                  isActive={activeCategoryId === category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setIsAddCategoryModalVisible(true)}
            style={{ marginLeft: 4 }}
          >
            添加栏目
          </Button>
        </div>
        
        <Button type="text" shape="circle" icon={<SettingOutlined />} onClick={showSettingsModal} />
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
          {currentCategoryIndices.filter(item => item.visible).map((item) => {
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
                  background: index.changePercent >= 0 ? PERIOD_UP_COLOR : PERIOD_DOWN_COLOR
                }} />

                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  height: '100%',
                  justifyContent: 'space-around'
                }}>
                  {/* 指数名称 */}
                  <div style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    color: '#222',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.2',
                  }}>
                    {index.name}
                  </div>

                  {/* 当前价格 */}
                  <div style={{
                    fontWeight: 700,
                    fontSize: '20px',
                    color: '#111',
                    lineHeight: '1.2',
                  }}>
                    {index.currentPrice.toFixed(2)}
                  </div>

                  {/* 涨跌幅和涨跌额 */}
                  <div>
                    <Text
                      style={{
                        color: index.changePercent >= 0 ? PERIOD_UP_COLOR : PERIOD_DOWN_COLOR,
                        fontWeight: 600,
                        fontSize: '13px',
                        lineHeight: '1.2',
                      }}
                    >
                      {index.changeAmount >= 0 ? '+' : ''}{index.changeAmount.toFixed(2)} ({formatPercent(index.changePercent)})
                    </Text>
                  </div>

                  {/* 周期涨跌幅 */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-start', 
                    gap: '6px', 
                    fontSize: '11px',
                    lineHeight: '1.2',
                  }}>
                    {renderPeriodChangeTag('W', index.weekChangePercent)}
                    {renderPeriodChangeTag('M', index.monthChangePercent)}
                    {renderPeriodChangeTag('Y', index.yearChangePercent)}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 设置模态框 - 管理当前分类下的指数 */}
      <Modal
        title={`管理 ${activeCategoryLabel} 指数`}
        open={isSettingsModalVisible}
        onCancel={handleSettingsCancel}
        width={700}
        footer={[
          <Button key="cancel" onClick={handleSettingsCancel}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={handleSettingsSave} disabled={!isDraftDirty}>
            保存
          </Button>
        ]}
      >
        {/* 栏目管理区 */}
        <div style={{ marginBottom: 24 }}>
          <Title level={5}>栏目管理</Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {settingsCategories.map(category => (
              <div key={category.id} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '8px 12px',
                background: '#f5f5f5',
                borderRadius: '4px'
              }}>
                <span style={{ fontWeight: 600 }}>{category.label}</span>
                <Space>
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<EditOutlined />}
                    onClick={() => handleEditCategory(category)}
                  >
                    编辑
                  </Button>
                  {settingsCategories.length > 1 && (
                    <Button 
                      type="text" 
                      size="small" 
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteCategory(category.id)}
                    >
                      删除
                    </Button>
                  )}
                </Space>
              </div>
            ))}
          </Space>
        </div>

        <Divider />

        {/* 添加自定义指数 */}
        <div style={{ marginBottom: 16 }}>
          <Title level={5}>添加指数到当前栏目</Title>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="输入指数代码 (如 sh000001, hkHSI, usNDAQ)"
              value={customIndexCode}
              onChange={e => setCustomIndexCode(e.target.value)}
              onPressEnter={handleAddCustomIndex}
              status={customCodeError ? 'error' : ''}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddCustomIndex}>
              添加
            </Button>
          </Space.Compact>
          {customCodeError && <Text type="danger" style={{ fontSize: 12 }}>{customCodeError}</Text>}
        </div>

        {/* 当前栏目指数列表 */}
        <Title level={5}>当前栏目指数列表（拖拽排序，点击隐藏/显示）</Title>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndIndices}>
          <SortableContext items={modalCategoryIndices.map(item => `${item.categoryId}-${item.code}`)} strategy={verticalListSortingStrategy}>
            <div>
              {modalCategoryIndices.map(item => (
                <SortableItem key={`${item.categoryId}-${item.code}`} item={item}>
                  <Tag
                    closable
                    onClose={() => handleRemoveIndex(item.code)}
                    onClick={() => handleToggleVisible(item.code)}
                    color={item.visible ? 'blue' : 'default'}
                    style={{ cursor: 'move', marginBottom: 8 }}
                  >
                    {item.name || item.code} {!item.visible && '(已隐藏)'}
                  </Tag>
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </Modal>

      {/* 添加栏目模态框 */}
      <Modal
        title="添加新栏目"
        open={isAddCategoryModalVisible}
        onOk={handleAddCategory}
        onCancel={() => {
          setIsAddCategoryModalVisible(false);
          setNewCategoryName('');
        }}
        okText="添加"
        cancelText="取消"
      >
        <Input
          placeholder="输入栏目名称（如：港股自选、美股科技）"
          value={newCategoryName}
          onChange={e => setNewCategoryName(e.target.value)}
          onPressEnter={handleAddCategory}
        />
      </Modal>

      {/* 编辑栏目模态框 */}
      <Modal
        title="编辑栏目"
        open={isEditCategoryModalVisible}
        onOk={handleSaveEditCategory}
        onCancel={() => {
          setIsEditCategoryModalVisible(false);
          setEditingCategory(null);
        }}
        okText="保存"
        cancelText="取消"
      >
        <Input
          placeholder="输入栏目名称"
          value={editCategoryName}
          onChange={e => setEditCategoryName(e.target.value)}
          onPressEnter={handleSaveEditCategory}
        />
      </Modal>
    </div>
  );
};

export default MarketIndices;
