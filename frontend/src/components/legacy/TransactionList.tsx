import React, { useState, useCallback } from 'react';
import { Table, Button, Popconfirm, Tag, Input } from 'antd';
import type { TableProps } from 'antd';
import { Transaction, TransactionType } from '../../store/types'; // Adjust path if needed
import useAppStore from '../../store'; // Adjust path if needed
import dayjs from 'dayjs'; // For date formatting
import type { Quote } from '../../store/types';
import { TRANSACTION_TYPE_LABELS } from './AddTransactionForm';
import useMessageApi from '../../hooks/useMessageApi';
import { debounce } from 'lodash';

interface TransactionListProps {
  transactions: Transaction[];
  portfolioId: string; // Needed for delete action
  assetQuoteMap: Record<string, Quote>;
}

const getTransactionTypeColor = (type: TransactionType) => {
  switch (type) {
    case TransactionType.BUY: return 'green';
    case TransactionType.SELL: return 'red';
    case TransactionType.DEPOSIT: return 'blue';
    case TransactionType.WITHDRAW: return 'orange';
    case TransactionType.DIVIDEND: return 'purple';
    default: return 'default';
  }
};

const TransactionList: React.FC<TransactionListProps> = ({ transactions, portfolioId, assetQuoteMap }) => {
  const deleteTransaction = useAppStore((state) => state.deleteTransaction);
  const updateTransactionNotes = useAppStore((state) => state.updateTransactionNotes);
  const messageApi = useMessageApi();
  
  // 存储正在保存的交易ID
  const [savingNotes, setSavingNotes] = useState<Set<string>>(new Set());
  
  // 本地备注状态（用于即时显示用户输入）
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});

  const handleDelete = async (transactionId: string) => {
    try {
      await deleteTransaction(portfolioId, transactionId);
      messageApi.success('交易记录删除成功');
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      const backendMessage = (error as any)?.response?.data?.message;
      messageApi.error(backendMessage || '删除交易记录失败');
    }
  };

  // 防抖保存备注
  const debouncedSaveNotes = useCallback(
    debounce(async (transactionId: string, notes: string) => {
      setSavingNotes((prev) => new Set(prev).add(transactionId));
      try {
        await updateTransactionNotes(portfolioId, transactionId, notes);
        // 静默成功，不显示提示
      } catch (error) {
        console.error('Failed to update transaction notes:', error);
        const backendMessage = (error as any)?.response?.data?.message;
        messageApi.error(backendMessage || '保存备注失败');
      } finally {
        setSavingNotes((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transactionId);
          return newSet;
        });
      }
    }, 800), // 800ms 防抖延迟
    [portfolioId, updateTransactionNotes, messageApi]
  );

  const handleNotesChange = (transactionId: string, value: string) => {
    // 立即更新本地状态
    setLocalNotes((prev) => ({ ...prev, [transactionId]: value }));
    // 防抖调用保存
    debouncedSaveNotes(transactionId, value);
  };

  const columns: TableProps<Transaction>['columns'] = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'), // Format date
      sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: TransactionType) => (
        <Tag color={getTransactionTypeColor(type)}>
          {TRANSACTION_TYPE_LABELS[type] || type || '-'}
        </Tag>
      ),
      filters: Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => ({ text: v, value: k })),
      onFilter: (value, record) => record.type === value,
    },
    {
      title: '资产',
      dataIndex: 'assetCode',
      key: 'asset',
      render: (assetCode: string) => {
        if (!assetCode) return '-';
        const assetInfo = assetQuoteMap?.[assetCode];
        return assetInfo?.name || assetCode;
      },
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right',
      render: (qty) => qty ?? '-',
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      align: 'right',
      render: (price) => price?.toFixed(2) ?? '-',
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (amount) => amount ? amount.toFixed(2) : '-',
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      render: (notes: string | undefined, record: Transaction) => {
        const displayValue = localNotes[record.id] !== undefined 
          ? localNotes[record.id] 
          : (notes || '');
        const isSaving = savingNotes.has(record.id);
        
        return (
          <Input
            value={displayValue}
            onChange={(e) => handleNotesChange(record.id, e.target.value)}
            placeholder="添加备注..."
            size="small"
            style={{ 
              fontSize: '13px',
              opacity: isSaving ? 0.6 : 1,
            }}
            suffix={isSaving ? <span style={{ fontSize: '11px', color: '#999' }}>保存中...</span> : null}
          />
        );
      },
      width: 200,
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Popconfirm
          title="确定删除这条交易记录吗？"
          description="此操作无法撤销。"
          onConfirm={() => handleDelete(record.id)}
          okText="是"
          cancelText="否"
        >
          <Button type="link" danger size="small">
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];


  return (
    <Table
      columns={columns}
      dataSource={transactions}
      rowKey="id"
      pagination={{ pageSize: 10 }} // Enable pagination
      size="small"
      bordered
      // loading={isLoading} // Add loading state if implemented
    />
  );
};

export default TransactionList;
