import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  Alert,
  Card,
  Col,
  Divider,
  Empty,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import '../lib/echarts';
import { usePortfolioHistoryContext } from '../hooks/usePortfolioHistoryContext';
import type {
  ApiContractWarning,
  PortfolioHistoryContextData,
  PortfolioHistorySeriesPoint,
} from '../store/types';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../shared/utils/formatters';

const { Text, Title } = Typography;

const FIRST_HISTORY_YEAR = 2024;

type PortfolioHistoryPanelProps = {
  portfolioId: string;
};

export function PortfolioHistoryPanel({
  portfolioId,
}: PortfolioHistoryPanelProps) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const { data, isLoading, isFetching, error, refetch } =
    usePortfolioHistoryContext(portfolioId, selectedYear);

  const history = data?.data ?? null;
  const warnings = useMemo(
    () => collectWarnings(data?.warnings ?? [], history),
    [data?.warnings, history]
  );
  const yearOptions = useMemo(
    () =>
      Array.from(
        { length: Math.max(1, currentYear - FIRST_HISTORY_YEAR + 1) },
        (_, index) => {
          const year = currentYear - index;
          return { label: `${year}`, value: year };
        }
      ),
    [currentYear]
  );
  const chartOption = useMemo(
    () => buildPortfolioSeriesOption(history?.portfolio.series ?? []),
    [history?.portfolio.series]
  );

  return (
    <Card
      title={
        <Space size={12}>
          <span>年度历史</span>
          {isFetching && !isLoading ? (
            <Tag color="processing">刷新中</Tag>
          ) : null}
        </Space>
      }
      extra={
        <Space>
          <Select
            value={selectedYear}
            options={yearOptions}
            onChange={setSelectedYear}
            style={{ width: 104 }}
          />
          <Typography.Link onClick={() => refetch()}>刷新</Typography.Link>
        </Space>
      }
      style={{ width: '100%', marginBottom: 16 }}
      styles={{ header: { fontSize: 20, fontWeight: 'bold' } }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="年度历史加载失败"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : !history ? (
        <Empty description="该年度暂无历史数据" />
      ) : (
        <>
          <HistoryWindowSummary
            history={history}
            warningCount={warnings.length}
          />

          {warnings.length > 0 && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              message="历史数据存在缺口"
              description={
                <Space direction="vertical" size={4}>
                  {warnings.slice(0, 5).map((warning, index) => (
                    <Text key={`${warning.code}-${index}`}>
                      {warning.code}: {warning.message}
                    </Text>
                  ))}
                  {warnings.length > 5 && (
                    <Text type="secondary">
                      还有 {warnings.length - 5} 条缺口记录。
                    </Text>
                  )}
                </Space>
              }
            />
          )}

          {history.portfolio.series.length > 0 ? (
            <ReactECharts
              option={chartOption}
              style={{ height: 320, width: '100%' }}
              notMerge
              lazyUpdate
            />
          ) : (
            <Empty
              style={{ margin: '32px 0' }}
              description="该年度暂无组合快照，不能生成资产曲线"
            />
          )}

          <Divider />

          <Row gutter={[24, 20]}>
            <Col xs={24} xl={12}>
              <FxHistoryTable history={history} />
            </Col>
            <Col xs={24} xl={12}>
              <YieldMacroSummary history={history} />
            </Col>
            <Col xs={24} xl={12}>
              <MarketCoverageSummary history={history} />
            </Col>
            <Col xs={24} xl={12}>
              <SourceHealthSummary history={history} />
            </Col>
          </Row>

          {history.portfolio.cashflows.length > 0 && (
            <>
              <Divider />
              <Title level={5}>现金流</Title>
              <Table
                size="small"
                rowKey={(row) =>
                  row.transaction_id ?? `${row.date}-${row.type}`
                }
                dataSource={history.portfolio.cashflows}
                pagination={{ pageSize: 5 }}
                columns={[
                  { title: '日期', dataIndex: 'date' },
                  { title: '类型', dataIndex: 'type' },
                  { title: '币种', dataIndex: 'currency' },
                  {
                    title: '原币金额',
                    dataIndex: 'amount',
                    render: (value: number | null) =>
                      formatNullableNumber(value),
                  },
                  {
                    title: '折 CNY',
                    dataIndex: 'amount_cny',
                    render: (value: number | null) =>
                      formatNullableCurrency(value),
                  },
                ]}
              />
            </>
          )}
        </>
      )}
    </Card>
  );
}

function HistoryWindowSummary({
  history,
  warningCount,
}: {
  history: PortfolioHistoryContextData;
  warningCount: number;
}) {
  const window = history.portfolio_year_window;
  const latestPoint =
    history.portfolio.series[history.portfolio.series.length - 1] ?? null;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={12} md={6}>
        <Statistic title="有效起点" value={window.effective_start} />
      </Col>
      <Col xs={12} md={6}>
        <Statistic title="可用日期" value={window.resolved_end ?? 'N/A'} />
      </Col>
      <Col xs={12} md={6}>
        <Statistic title="快照天数" value={window.snapshot_days} />
      </Col>
      <Col xs={12} md={6}>
        <Statistic title="缺口数" value={warningCount} />
      </Col>
      {latestPoint && (
        <>
          <Col xs={12} md={6}>
            <Statistic
              title="最新净资产"
              value={formatCurrency(latestPoint.net_assets)}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="最新总市值"
              value={formatCurrency(latestPoint.total_market_value)}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="累计盈亏"
              value={formatCurrency(latestPoint.total_pnl)}
              valueStyle={{
                color: latestPoint.total_pnl >= 0 ? '#cf1322' : '#3f8600',
              }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="YTD"
              value={formatNullablePercent(latestPoint.ytd_return_percent)}
            />
          </Col>
        </>
      )}
    </Row>
  );
}

function FxHistoryTable({ history }: { history: PortfolioHistoryContextData }) {
  if (history.fx.pairs.length === 0) {
    return <Empty description="暂无汇率历史" />;
  }

  return (
    <>
      <Title level={5}>汇率</Title>
      <Table
        size="small"
        pagination={false}
        rowKey="pair"
        dataSource={history.fx.pairs}
        columns={[
          { title: '货币对', dataIndex: 'pair' },
          { title: '日期', dataIndex: 'current_date' },
          {
            title: '汇率',
            dataIndex: 'current_rate',
            render: (value: number | null) => formatNullableNumber(value, 4),
          },
          {
            title: '7d',
            dataIndex: 'change_7d_percent',
            render: (value: number | null) => formatNullablePercent(value),
          },
          {
            title: '30d',
            dataIndex: 'change_30d_percent',
            render: (value: number | null) => formatNullablePercent(value),
          },
          {
            title: 'YTD',
            dataIndex: 'change_ytd_percent',
            render: (value: number | null) => formatNullablePercent(value),
          },
        ]}
      />
    </>
  );
}

function YieldMacroSummary({
  history,
}: {
  history: PortfolioHistoryContextData;
}) {
  const spreads = history.yield.spreads;
  const macroEntries = Object.entries(history.macro.latest_values);

  return (
    <>
      <Title level={5}>利率与宏观</Title>
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        <Row gutter={12}>
          <Col span={8}>
            <Statistic
              title="US 10Y-2Y"
              value={formatBasisPoint(spreads.us_10y_2y_bp)}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="CN 10Y-2Y"
              value={formatBasisPoint(spreads.cn_10y_2y_bp)}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="CN-US 10Y"
              value={formatBasisPoint(spreads.cn_us_10y_bp)}
            />
          </Col>
        </Row>
        <Table
          size="small"
          pagination={false}
          rowKey="indicator"
          dataSource={macroEntries.map(([indicator, value]) => ({
            indicator,
            ...value,
          }))}
          columns={[
            { title: '指标', dataIndex: 'indicator' },
            {
              title: '值',
              dataIndex: 'value',
              render: (value: number | undefined) =>
                formatNullableNumber(value),
            },
            { title: '日期', dataIndex: 'date', render: renderNullableText },
            { title: '状态', dataIndex: 'status', render: renderStatusTag },
          ]}
        />
      </Space>
    </>
  );
}

function MarketCoverageSummary({
  history,
}: {
  history: PortfolioHistoryContextData;
}) {
  const quoteCoverage = history.market.quote_coverage;
  const benchmarkCoverage = history.market.benchmark_index_coverage;

  return (
    <>
      <Title level={5}>行情覆盖</Title>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Row gutter={16}>
          <Col span={12}>
            <Statistic
              title="持仓行情"
              value={`${quoteCoverage.found.length}/${quoteCoverage.requested.length}`}
            />
          </Col>
          <Col span={12}>
            <Statistic
              title="核心指数"
              value={`${benchmarkCoverage.found.length}/${benchmarkCoverage.requested.length}`}
            />
          </Col>
        </Row>
        {benchmarkCoverage.missing.length > 0 && (
          <Text type="secondary">
            缺失指数：{benchmarkCoverage.missing.join(', ')}
          </Text>
        )}
        {quoteCoverage.missing.length > 0 && (
          <Text type="secondary">
            缺失持仓：{quoteCoverage.missing.join(', ')}
          </Text>
        )}
      </Space>
    </>
  );
}

function SourceHealthSummary({
  history,
}: {
  history: PortfolioHistoryContextData;
}) {
  if (history.source_health.run_summary.length === 0) {
    return <Empty description="本年度尚未记录源健康历史" />;
  }

  return (
    <>
      <Title level={5}>数据源运行</Title>
      <Table
        size="small"
        pagination={false}
        rowKey={(row) => `${row.domain}-${row.source_id}`}
        dataSource={history.source_health.run_summary}
        columns={[
          { title: '域', dataIndex: 'domain' },
          { title: '源', dataIndex: 'source_id' },
          { title: '运行', dataIndex: 'total_runs' },
          { title: '写入', dataIndex: 'rows_written' },
          {
            title: '最新状态',
            dataIndex: 'latest_status',
            render: renderStatusTag,
          },
        ]}
      />
    </>
  );
}

function buildPortfolioSeriesOption(series: PortfolioHistorySeriesPoint[]) {
  return {
    tooltip: { trigger: 'axis' },
    legend: {
      top: 0,
      data: ['净资产', '总市值', '现金', '累计盈亏'],
    },
    grid: { left: 64, right: 24, top: 44, bottom: 54 },
    xAxis: {
      type: 'category',
      data: series.map((point) => point.date),
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value: number) => `${Math.round(value / 10000)}万`,
      },
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 16 }],
    series: [
      {
        name: '净资产',
        type: 'line',
        smooth: true,
        data: series.map((point) => point.net_assets),
      },
      {
        name: '总市值',
        type: 'line',
        smooth: true,
        data: series.map((point) => point.total_market_value),
      },
      {
        name: '现金',
        type: 'line',
        smooth: true,
        data: series.map((point) => point.cash),
      },
      {
        name: '累计盈亏',
        type: 'line',
        smooth: true,
        data: series.map((point) => point.total_pnl),
      },
    ],
  };
}

function collectWarnings(
  envelopeWarnings: ApiContractWarning[],
  history: PortfolioHistoryContextData | null
): ApiContractWarning[] {
  if (!history) return envelopeWarnings;
  return [
    ...envelopeWarnings,
    ...history.fx.warnings,
    ...history.market.warnings,
    ...history.yield.warnings,
    ...history.macro.warnings,
    ...history.source_health.warnings,
  ];
}

function renderStatusTag(value: string | undefined) {
  if (!value) return <Text type="secondary">N/A</Text>;
  const normalized = value.toUpperCase();
  const color =
    normalized === 'SUCCESS' || normalized === 'HEALTHY'
      ? 'green'
      : normalized === 'STALE' || normalized === 'DEGRADED'
        ? 'orange'
        : 'red';
  return <Tag color={color}>{value}</Tag>;
}

function renderNullableText(value: string | null | undefined) {
  return value ?? <Text type="secondary">N/A</Text>;
}

function formatNullableNumber(value: number | null | undefined, decimals = 2) {
  return value === null || value === undefined
    ? 'N/A'
    : formatNumber(value, decimals);
}

function formatNullableCurrency(value: number | null | undefined) {
  return value === null || value === undefined ? 'N/A' : formatCurrency(value);
}

function formatNullablePercent(value: number | null | undefined) {
  return value === null || value === undefined ? 'N/A' : formatPercent(value);
}

function formatBasisPoint(value: number | null | undefined) {
  return value === null || value === undefined
    ? 'N/A'
    : `${formatNumber(value)} bp`;
}

export default PortfolioHistoryPanel;
