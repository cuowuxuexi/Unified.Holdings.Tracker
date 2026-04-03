import React, { useState, useEffect } from 'react';
import { Button } from 'antd';
import { PortfolioDetail, AttentionItem } from '../../store/types';
import useAppStore from '../../store';
import useMessageApi from '../../hooks/useMessageApi';
import { AttentionCard } from '../AttentionCard';
import { AttentionFormModal } from '../AttentionFormModal';
import {
  parseAttentionInfo,
  serializeAttentionInfo,
  generateId,
} from '../../utils/attentionParser';

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

interface AttentionSectionProps {
  portfolio: PortfolioDetail;
}

const AttentionSection: React.FC<AttentionSectionProps> = ({ portfolio }) => {
  const updateAttentionInfo = useAppStore((state) => state.updateAttentionInfo);
  const messageApi = useMessageApi();

  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<AttentionItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const items = parseAttentionInfo(portfolio.attentionInfo);
    setAttentionItems(items);
  }, [portfolio.attentionInfo]);

  const handleAdd = () => {
    setEditingItem(null);
    setModalVisible(true);
  };

  const handleEdit = (id: string) => {
    const item = attentionItems.find((i) => i.id === id);
    if (item) {
      setEditingItem(item);
      setModalVisible(true);
    }
  };

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
      setAttentionItems(attentionItems);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (
    formData: Omit<AttentionItem, 'id' | 'createdAt'>
  ) => {
    let newItems: AttentionItem[];
    if (editingItem) {
      newItems = attentionItems.map((item) =>
        item.id === editingItem.id
          ? { ...item, ...formData, updatedAt: new Date().toISOString() }
          : item
      );
    } else {
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
      setAttentionItems(attentionItems);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 16, display: 'flex' }}>
      <div
        style={{
          ...coreCardStyle,
          flex: 1,
          minHeight: '180px',
          height: 'auto',
          padding: '16px 20px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '3px',
            borderRadius: '2px',
            background: '#1890ff',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: 700,
            fontSize: '16px',
            marginBottom: '15px',
            color: '#222',
            paddingBottom: '10px',
            borderBottom: '1px dashed #d9d9d9',
          }}
        >
          <span>📌 重要提醒</span>
          <Button
            type="primary"
            size="small"
            onClick={handleAdd}
            loading={isSaving}
          >
            + 添加
          </Button>
        </div>
        <div>
          {attentionItems.length === 0 ? (
            <div
              style={{ textAlign: 'center', color: '#999', padding: '20px 0' }}
            >
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
  );
};

export default AttentionSection;
