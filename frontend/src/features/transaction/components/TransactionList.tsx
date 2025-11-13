import { Table, Tag, Button, Popconfirm } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { Transaction } from '../../../generated/api';
import { formatDate, formatCurrency } from '../../../shared/utils/formatters';
import { useDeleteTransaction } from '../../../shared/hooks/useTransactions';

interface TransactionListProps {
  portfolioId: string;
  transactions: Transaction[];
}

const transactionTypeMap: Record<string, { text: string; color: string }> = {
  BUY: { text: '买入', color: 'green' },
  SELL: { text: '卖出', color: 'red' },
  DEPOSIT: { text: '入金', color: 'blue' },
  WITHDRAW: { text: '出金', color: 'orange' },
  DIVIDEND: { text: '分红', color: 'cyan' },
  LEVERAGE_ADD: { text: '融资', color: 'purple' },
  LEVERAGE_REMOVE: { text: '还款', color: 'magenta' },
  LEVERAGE_COST: { text: '融资成本', color: 'volcano' },
};

export function TransactionList({ portfolioId, transactions }: TransactionListProps) {
  const deleteTransaction = useDeleteTransaction();

  const handleDelete = async (txId: string) => {
    try {
      await deleteTransaction.mutateAsync({ portfolioId, txId });
    } catch (error) {
      console.error('Delete transaction error:', error);
    }
  };

  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => formatDate(date, 'YYYY-MM-DD HH:mm'),
      width: 150,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeInfo = transactionTypeMap[type] || { text: type, color: 'default' };
        return <Tag color={typeInfo.color}>{typeInfo.text}</Tag>;
      },
      width: 100,
    },
    {
      title: '资产代码',
      dataIndex: 'assetCode',
      key: 'assetCode',
      render: (code: string | null) => code || '-',
      width: 120,
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      render: (qty: number | null) => (qty !== null ? qty.toLocaleString() : '-'),
      width: 100,
      align: 'right' as const,
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      render: (price: number | null) => (price !== null ? formatCurrency(price) : '-'),
      width: 120,
      align: 'right' as const,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number | null) => (amount !== null ? formatCurrency(amount) : '-'),
      width: 120,
      align: 'right' as const,
    },
    {
      title: '手续费',
      dataIndex: 'commission',
      key: 'commission',
      render: (commission: number | null) =>
        commission !== null ? formatCurrency(commission) : '-',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      render: (notes: string | null) => notes || '-',
      ellipsis: true,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: Transaction) => (
        <Popconfirm
          title="确定删除这条交易记录？"
          onConfirm={() => record.id && handleDelete(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deleteTransaction.isPending}
          />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={transactions}
      rowKey="id"
      pagination={{
        pageSize: 20,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 条记录`,
      }}
      scroll={{ x: 1200 }}
    />
  );
}

