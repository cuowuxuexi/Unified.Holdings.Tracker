import React from 'react';
import { Table, Button, Popconfirm, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { Transaction, TransactionType } from '../store/types'; // Adjust path if needed
import useAppStore from '../store'; // Adjust path if needed
import dayjs from 'dayjs'; // For date formatting
import type { Quote } from '../store/types';
import { TRANSACTION_TYPE_LABELS } from './AddTransactionForm';

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
  // Add loading state if needed: const isLoading = useAppStore(...)

  const handleDelete = async (transactionId: string) => {
    try {
      await deleteTransaction(portfolioId, transactionId);
      message.success('交易记录删除成功');
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      message.error('删除交易记录失败');
    }
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
      render: (amount) => amount.toFixed(2),
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: (note) => note || '-',
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