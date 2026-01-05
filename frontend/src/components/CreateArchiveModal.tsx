import { Modal, message, Typography, Space, Alert } from 'antd';
import { useState } from 'react';
import { SaveOutlined, DatabaseOutlined } from '@ant-design/icons';
import apiClient from '../services/api';

const { Text, Paragraph } = Typography;

interface CreateArchiveModalProps {
  open: boolean;
  portfolioId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * 创建存档对话框（备份功能）
 * 直接创建当前日期的完整数据备份
 */
export function CreateArchiveModal({
  open,
  portfolioId,
  onClose,
  onSuccess,
}: CreateArchiveModalProps) {
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const handleSubmit = async () => {
    if (!portfolioId) {
      messageApi.error('请先选择投资组合');
      return;
    }

    try {
      setLoading(true);

      const response = await apiClient.createBackup(portfolioId);

      if (response.success) {
        const date = new Date().toLocaleDateString('zh-CN');
        messageApi.success(`存档创建成功！备份日期: ${date}`);
        onClose();
        onSuccess?.();
      } else {
        messageApi.error('创建存档失败');
      }
    } catch (error: unknown) {
      console.error('创建存档失败:', error);
      // 处理后端返回的错误信息
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        (error as { response?: { data?: { message?: string } } }).response?.data
          ?.message
      ) {
        messageApi.error(
          (error as { response: { data: { message: string } } }).response.data
            .message
        );
      } else {
        messageApi.error('创建存档失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const currentDate = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      {contextHolder}
      <Modal
        title={
          <Space>
            <SaveOutlined />
            创建存档
          </Space>
        }
        open={open}
        onOk={handleSubmit}
        onCancel={handleCancel}
        confirmLoading={loading}
        okText="创建存档"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            message="数据备份"
            description="存档将保存当前投资组合的完整数据，包括账户设置、资产信息和所有交易记录。"
            type="info"
            showIcon
            icon={<DatabaseOutlined />}
          />

          <div style={{ padding: '16px', background: '#fafafa', borderRadius: '8px' }}>
            <Paragraph style={{ marginBottom: 8 }}>
              <Text strong>备份日期：</Text>
              <Text>{currentDate}</Text>
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text type="secondary">
                存档文件将保存在 data/backups 目录中，可用于在数据丢失或项目重建后恢复。
              </Text>
            </Paragraph>
          </div>
        </Space>
      </Modal>
    </>
  );
}