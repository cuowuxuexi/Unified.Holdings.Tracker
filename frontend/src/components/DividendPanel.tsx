import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Popconfirm,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import apiClient from '../services/api';
import useAppStore from '../store';
import { queryClient } from '../app/providers/queryClient';
import type {
  DividendItemState,
  DividendReport,
  DividendReportItem,
} from '../store/types';

const { Text } = Typography;

const STATE_TAGS: Record<DividendItemState, { color: string; label: string }> =
  {
    SETTLED: { color: 'green', label: '已自动入账' },
    MATCHED_MANUAL: { color: 'cyan', label: '已手工记录' },
    DISMISSED: { color: 'default', label: '已忽略' },
    TO_SETTLE: { color: 'blue', label: '待入账' },
    PENDING: { color: 'gold', label: '待派息' },
    BACKFILL_AVAILABLE: { color: 'orange', label: '待补录' },
  };

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  HKD: 'HK$',
  USD: 'US$',
};

function money(currency: string, value: number): string {
  return `${CURRENCY_SYMBOL[currency] ?? ''}${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pendingLabel(item: DividendReportItem): string {
  if (item.status === 'UPCOMING') return '未除权';
  if (item.status === 'PAY_DATE_UNKNOWN') return '派息日待公布';
  return STATE_TAGS[item.state].label;
}

function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

const columns: ColumnsType<DividendReportItem> = [
  {
    title: '除权日',
    key: 'exDate',
    render: (_, item) => (
      <Space direction="vertical" size={0}>
        <Text>{item.event.exDate}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          派息 {item.event.payDate ?? '待定'}
        </Text>
      </Space>
    ),
  },
  {
    title: '标的',
    key: 'asset',
    render: (_, item) => (
      <Space direction="vertical" size={0}>
        <Text>{item.assetName ?? item.event.assetCode}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {item.event.assetCode}
        </Text>
      </Space>
    ),
  },
  {
    title: '方案',
    key: 'plan',
    ellipsis: true,
    render: (_, item) => (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {item.event.description}
      </Text>
    ),
  },
  {
    title: '股数',
    dataIndex: 'quantity',
    align: 'right',
  },
  {
    title: '税前',
    key: 'gross',
    align: 'right',
    render: (_, item) => money(item.event.currency, item.grossAmount),
  },
  {
    title: '预扣税',
    key: 'tax',
    align: 'right',
    render: (_, item) =>
      item.taxRate > 0
        ? `${money(item.event.currency, item.taxAmount)}（${percent(item.taxRate)}）`
        : '—',
  },
  {
    title: '到账',
    key: 'net',
    align: 'right',
    render: (_, item) => (
      <Space direction="vertical" size={0} style={{ textAlign: 'right' }}>
        <Text>{money(item.event.currency, item.netAmount)}</Text>
        {item.amountCny !== null && item.event.currency !== 'CNY' ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            ≈ {money('CNY', item.amountCny)}
          </Text>
        ) : null}
      </Space>
    ),
  },
  {
    title: '状态',
    key: 'state',
    render: (_, item) => (
      <Tag color={STATE_TAGS[item.state].color}>{pendingLabel(item)}</Tag>
    ),
  },
];

function sumCny(items: DividendReportItem[]): number {
  return items.reduce((sum, item) => sum + (item.amountCny ?? 0), 0);
}

export function DividendPanel({ portfolioId }: { portfolioId: string }) {
  const fetchPortfolioDetail = useAppStore(
    (state) => state.fetchPortfolioDetail
  );
  const [syncing, setSyncing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery<DividendReport>({
    queryKey: ['portfolio-dividends', portfolioId],
    queryFn: () => apiClient.fetchPortfolioDividends(portfolioId),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const summary = useMemo(() => {
    const items = data?.items ?? [];
    const year = (data?.today ?? '').slice(0, 4);
    const booked = items.filter(
      (item) =>
        (item.state === 'SETTLED' || item.state === 'MATCHED_MANUAL') &&
        (item.event.payDate ?? '').startsWith(year)
    );
    const pending = items.filter((item) => item.state === 'PENDING');
    const backfill = items.filter(
      (item) => item.state === 'BACKFILL_AVAILABLE'
    );
    const toSettle = items.filter((item) => item.state === 'TO_SETTLE');
    return { booked, pending, backfill, toSettle };
  }, [data]);

  const sync = async (includeHistory: boolean) => {
    setSyncing(true);
    try {
      const report = await apiClient.syncPortfolioDividends(
        portfolioId,
        includeHistory
      );
      message.success(
        report.created + report.matched > 0
          ? `已入账 ${report.created} 笔，关联手工记录 ${report.matched} 笔`
          : '没有新的可入账分红'
      );
      queryClient.setQueryData(['portfolio-dividends', portfolioId], report);
      await fetchPortfolioDetail(portfolioId);
      queryClient.invalidateQueries({
        queryKey: ['portfolio-stats', portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ['portfolio-history-context', portfolioId],
      });
    } catch (syncError) {
      message.error(
        `分红同步失败：${syncError instanceof Error ? syncError.message : String(syncError)}`
      );
    } finally {
      setSyncing(false);
    }
  };

  const rows = useMemo(() => [...(data?.items ?? [])].reverse(), [data?.items]);

  return (
    <Card
      title="分红"
      extra={
        <Space>
          <Typography.Link onClick={() => refetch()}>刷新</Typography.Link>
          <Button
            size="small"
            loading={syncing}
            disabled={summary.toSettle.length === 0}
            onClick={() => sync(false)}
          >
            入账最近分红
          </Button>
        </Space>
      }
      style={{ width: '100%', marginBottom: 16 }}
      styles={{ header: { fontSize: 20, fontWeight: 'bold' } }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="分红数据加载失败"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : data ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic
                title={`${data.today.slice(0, 4)} 年已入账`}
                value={money('CNY', sumCny(summary.booked))}
              />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="已入账笔数" value={summary.booked.length} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="待派息" value={summary.pending.length} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="待补录" value={summary.backfill.length} />
            </Col>
          </Row>

          {summary.backfill.length > 0 && (
            <Alert
              type="info"
              showIcon
              message={`有 ${summary.backfill.length} 笔历史分红尚未入账`}
              description="这些分红的派息日早于自动入账窗口（最近 30 天），核对金额后可一次性补录；补录后若有不对，删除该笔交易即可，系统不会再自动建回。"
              action={
                <Popconfirm
                  title="补录历史分红"
                  description={`将按派息日新增 ${summary.backfill.length} 笔分红交易`}
                  onConfirm={() => sync(true)}
                  okText="补录"
                  cancelText="取消"
                >
                  <Button size="small" type="primary" loading={syncing}>
                    补录
                  </Button>
                </Popconfirm>
              }
            />
          )}

          {data.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="需要留意"
              description={
                <Space direction="vertical" size={2}>
                  {data.warnings.map((warning, index) => (
                    <Text key={`${warning.code}-${index}`}>
                      {warning.message}
                    </Text>
                  ))}
                </Space>
              }
            />
          )}

          <Table
            size="small"
            rowKey="eventKey"
            dataSource={rows}
            columns={columns}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            scroll={{ x: 900 }}
            locale={{ emptyText: '持仓期间没有现金分红' }}
          />

          <Text type="secondary" style={{ fontSize: 12 }}>
            应得股数取除权日前一交易日收盘持仓；按派息日入账，外币按派息日汇率折人民币。
            预扣税：A 股 {percent(data.taxRates.CN)}、港股{' '}
            {percent(data.taxRates.HK)}、美股 {percent(data.taxRates.US)}
            （A
            股持股不满一年的红利税在卖出时补扣，这里不计）。数据来源：东方财富。
          </Text>
        </Space>
      ) : null}
    </Card>
  );
}

export default DividendPanel;
