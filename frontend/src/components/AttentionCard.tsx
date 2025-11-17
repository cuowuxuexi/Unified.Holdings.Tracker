import React from 'react';
import { Card, Button, Space } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { AttentionItem } from '../store/types';

interface AttentionCardProps {
  item: AttentionItem;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export const AttentionCard: React.FC<AttentionCardProps> = ({ item, onEdit, onDelete }) => {
  return (
    <Card
      size="small"
      style={{
        marginBottom: '12px',
        borderRadius: '8px',
        border: '1px solid #e8e8e8',
      }}
      bodyStyle={{ padding: '12px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '20px', marginRight: '8px' }}>{item.icon}</span>
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#222' }}>{item.title}</span>
          </div>
          <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.6' }}>
            {item.content}
          </div>
        </div>
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onEdit(item.id)}
          >
            编辑
          </Button>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete(item.id)}
          >
            删除
          </Button>
        </Space>
      </div>
    </Card>
  );
};
