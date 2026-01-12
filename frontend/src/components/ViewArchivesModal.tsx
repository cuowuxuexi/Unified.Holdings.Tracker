import {
  Modal,
  Table,
  Button,
  Space,
  message,
  Popconfirm,
  Empty,
  Spin,
  Alert,
  Typography,
} from 'antd';
import {
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  HistoryOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useState, useEffect, useCallback } from 'react';
import apiClient, { BackupIndexEntry } from '../services/api';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

interface ViewArchivesModalProps {
  open: boolean;
  portfolioId?: string | null; // 改为可选，支持全局模式
  onClose: () => void;
  onRestoreSuccess?: (portfolioId?: string) => void; // 添加 portfolioId 参数
}

/**
 * 读取存档对话框
 * 显示备份列表，提供恢复、下载和删除功能
 */
export function ViewArchivesModal({
  open,
  portfolioId,
  onClose,
  onRestoreSuccess,
}: ViewArchivesModalProps) {
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<BackupIndexEntry[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // 获取备份列表
  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      // 根据是否有 portfolioId 决定调用哪个 API
      const response = portfolioId
        ? await apiClient.getBackups(portfolioId)
        : await apiClient.getAllBackups();
      setBackups(response.backups || []);
    } catch (error) {
      console.error('获取存档列表失败:', error);
      messageApi.error('获取存档列表失败');
    } finally {
      setLoading(false);
    }
  }, [portfolioId, messageApi]);

  // 当对话框打开时获取数据
  useEffect(() => {
    if (open) {
      fetchBackups();
    }
  }, [open, fetchBackups]);

  // 恢复备份
  const handleRestore = async (backup: BackupIndexEntry) => {
    setRestoringId(backup.backupId);
    try {
      let result;

      if (portfolioId) {
        // 有 portfolioId，使用原有的恢复逻辑
        result = await apiClient.restoreBackup(portfolioId, backup.backupId);
      } else {
        // 无 portfolioId，使用智能恢复
        result = await apiClient.restoreBackupSmart(backup.backupId);
      }

      if (result.success) {
        const countInfo = result.restoredTransactionCount
          ? `已恢复 ${result.restoredTransactionCount} 条交易记录`
          : '';
        const newPortfolioInfo = (result as any).isNewPortfolio
          ? '（已自动创建投资组合）'
          : '';
        messageApi.success(`存档恢复成功！${countInfo}${newPortfolioInfo}`);
        onRestoreSuccess?.((result as any).portfolioId);
        onClose();
      } else {
        messageApi.error(result.message || '恢复存档失败');
      }
    } catch (error) {
      console.error('恢复存档失败:', error);
      messageApi.error('恢复存档失败');
    } finally {
      setRestoringId(null);
    }
  };

  // 下载备份
  const handleDownload = async (backup: BackupIndexEntry) => {
    setDownloadingIds((prev) => new Set(prev).add(backup.backupId));
    try {
      const blob = await apiClient.downloadBackup(backup.backupId);

      // 创建下载链接
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const date = backup.createdAt.split('T')[0];
      link.download = `backup-${backup.portfolioName}-${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      messageApi.success('存档下载成功');
    } catch (error) {
      console.error('下载存档失败:', error);
      messageApi.error('下载存档失败');
    } finally {
      setDownloadingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(backup.backupId);
        return newSet;
      });
    }
  };

  // 删除备份
  const handleDelete = async (backup: BackupIndexEntry) => {
    setDeletingIds((prev) => new Set(prev).add(backup.backupId));
    try {
      await apiClient.deleteBackup(backup.backupId);
      messageApi.success('存档已删除');
      // 刷新列表
      fetchBackups();
    } catch (error) {
      console.error('删除存档失败:', error);
      messageApi.error('删除存档失败');
    } finally {
      setDeletingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(backup.backupId);
        return newSet;
      });
    }
  };

  // 格式化日期时间
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // 表格列定义
  const columns: ColumnsType<BackupIndexEntry> = [
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (createdAt: string) => formatDateTime(createdAt),
      sorter: (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      defaultSortOrder: 'ascend',
    },
    {
      title: '投资组合',
      dataIndex: 'portfolioName',
      key: 'portfolioName',
      width: 150,
      render: (name: string) => <Text>{name}</Text>,
      // 只在全局模式下显示
      hidden: !!portfolioId,
    },
    {
      title: '交易记录',
      dataIndex: 'transactionCount',
      key: 'transactionCount',
      width: 100,
      align: 'center',
      render: (count: number) => <Text>{count} 条</Text>,
    },
    {
      title: '资产数量',
      dataIndex: 'assetCount',
      key: 'assetCount',
      width: 100,
      align: 'center',
      render: (count: number) => <Text>{count} 个</Text>,
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      key: 'fileSize',
      width: 100,
      align: 'right',
      render: (size: number) => (
        <Text type="secondary">{formatFileSize(size)}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_: unknown, record: BackupIndexEntry) => (
        <Space size="small">
          <Popconfirm
            title="确定恢复存档？"
            description={
              <div style={{ maxWidth: 300 }}>
                <Text type="danger">
                  <ExclamationCircleOutlined style={{ marginRight: 4 }} />
                  警告：恢复操作将覆盖当前所有数据！
                </Text>
                <br />
                <Text type="secondary">
                  当前投资组合的所有交易记录将被删除，并替换为此存档中的数据。
                </Text>
              </div>
            }
            onConfirm={() => handleRestore(record)}
            okText="确定恢复"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="primary"
              size="small"
              icon={<HistoryOutlined />}
              loading={restoringId === record.backupId}
            >
              恢复
            </Button>
          </Popconfirm>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingIds.has(record.backupId)}
            onClick={() => handleDownload(record)}
          >
            下载
          </Button>
          <Popconfirm
            title="确定删除存档？"
            description="此操作不可恢复。"
            onConfirm={() => handleDelete(record)}
            okText="确定删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingIds.has(record.backupId)}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            读取存档
          </Space>
        }
        open={open}
        onCancel={onClose}
        footer={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={fetchBackups}
          >
            刷新
          </Button>,
          <Button key="close" type="primary" onClick={onClose}>
            关闭
          </Button>,
        ]}
        width={900}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            message="选择存档进行恢复"
            description="恢复存档将覆盖当前投资组合的所有数据。请在恢复前确认已备份重要数据。"
            type="warning"
            showIcon
          />

          <Spin spinning={loading}>
            {backups.length === 0 && !loading ? (
              <Empty
                description="暂无存档记录"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <Table
                columns={columns.filter((col) => !(col as any).hidden)}
                dataSource={backups}
                rowKey="backupId"
                size="small"
                pagination={false}
                scroll={{ x: 800 }}
              />
            )}
          </Spin>
        </Space>
      </Modal>
    </>
  );
}
