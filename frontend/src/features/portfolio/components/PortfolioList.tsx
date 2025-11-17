import { useState, useEffect } from 'react';
import { Typography, Popconfirm, Button } from 'antd';
import { DeleteOutlined, MenuOutlined } from '@ant-design/icons';
import type { Portfolio } from '../../../generated/api';
import { useDeletePortfolio } from '../../../shared/hooks/usePortfolios';
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
import styles from './PortfolioList.module.css';

const { Text } = Typography;

interface PortfolioListProps {
  portfolios: Portfolio[];
  onSelect: (id: string) => void;
  className?: string;
}

// 可排序的投资组合卡片组件
function SortablePortfolioItem({
  portfolio,
  onSelect,
  onDelete,
  isDeleting,
}: {
  portfolio: Portfolio;
  onSelect: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  isDeleting: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: portfolio.id || '',
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.portfolioItemWrapper}
      onClick={() => portfolio.id && onSelect(portfolio.id)}
    >
      <div className={styles.portfolioItem}>
        <div
          {...attributes}
          {...listeners}
          className={styles.dragHandle}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuOutlined />
        </div>
        <span className={styles.portfolioName}>
          {portfolio.name || '未命名组合'}
        </span>
        <div
          className={styles.deleteButton}
          onClick={(e) => e.stopPropagation()}
        >
          <Popconfirm
            title="确定删除这个投资组合？"
            description="删除后将无法恢复，包括所有交易记录。"
            onConfirm={(e) => portfolio.id && onDelete(e!, portfolio.id)}
            okText="确定删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={isDeleting}
            />
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}

export function PortfolioList({
  portfolios,
  onSelect,
  className,
}: PortfolioListProps) {
  const deletePortfolio = useDeletePortfolio();
  const [sortedPortfolios, setSortedPortfolios] = useState(portfolios);

  // 当 portfolios prop 变化时，更新排序后的列表
  useEffect(() => {
    setSortedPortfolios(portfolios);
  }, [portfolios]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    try {
      await deletePortfolio.mutateAsync(id);
      // 删除成功后，从排序列表中移除
      setSortedPortfolios((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      console.error('Delete portfolio error:', error);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedPortfolios.findIndex((p) => p.id === active.id);
    const newIndex = sortedPortfolios.findIndex((p) => p.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      setSortedPortfolios(arrayMove(sortedPortfolios, oldIndex, newIndex));
      // TODO: 如果需要持久化排序，可以在这里调用 API
    }
  };

  if (sortedPortfolios.length === 0) {
    return (
      <div className={className || styles.emptyContainer}>
        <Text type="secondary" style={{ fontSize: '14px' }}>
          暂无投资组合，点击上方按钮创建第一个投资组合
        </Text>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortedPortfolios.map((p) => p.id || '')}
        strategy={verticalListSortingStrategy}
      >
        <div className={className || styles.portfolioList}>
          {sortedPortfolios.map((portfolio) => (
            <SortablePortfolioItem
              key={portfolio.id}
              portfolio={portfolio}
              onSelect={onSelect}
              onDelete={handleDelete}
              isDeleting={deletePortfolio.isPending}
            />
          ))}
          {sortedPortfolios.length > 1 && (
            <div className={styles.dragHint}>
              提示：拖拽左侧 ☰ 图标可调整投资组合顺序
            </div>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}
