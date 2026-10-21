import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Segmented, Space, Typography } from 'antd';
import type { EChartsOption } from 'echarts';
import '../lib/echarts';
import type { PortfolioHistorySeriesPoint } from '../store/types';

const { Text } = Typography;

// 序列色取自 dataviz 参考调色板（蓝/橙/青顺序已过色盲校验）；
// 盈亏沿用 A 股习惯红涨绿跌，与页面其它盈亏数字一致
const COLORS = {
  netAssets: '#2a78d6',
  marketValue: '#eb6834',
  cash: '#1baf7a',
  gain: '#cf1322',
  loss: '#3f8600',
  axis: '#8c8c8c',
  grid: '#f0f0f0',
  zeroLine: '#bfbfbf',
};

type RangeKey = '1M' | '3M' | '6M' | 'ALL';

const RANGE_OPTIONS: Array<{ label: string; value: RangeKey }> = [
  { label: '近1月', value: '1M' },
  { label: '近3月', value: '3M' },
  { label: '近6月', value: '6M' },
  { label: '全年', value: 'ALL' },
];

const RANGE_MONTHS: Record<Exclude<RangeKey, 'ALL'>, number> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
};

function toWan(value: number): string {
  return `${(value / 10000).toFixed(2)}万`;
}

function axisWan(value: number): string {
  const wan = value / 10000;
  return Math.abs(wan) >= 100 ? `${Math.round(wan)}万` : `${wan.toFixed(0)}万`;
}

function liabilitiesOf(point: PortfolioHistorySeriesPoint): number {
  // 早期快照没有 leverage_used，按「总市值 + 现金 − 净资产」反推
  return Math.max(
    0,
    point.leverage_used ??
      point.total_market_value + point.cash - point.net_assets
  );
}

function rangeStartIndex(
  series: PortfolioHistorySeriesPoint[],
  range: RangeKey
): number {
  if (range === 'ALL' || series.length === 0) return 0;
  const last = new Date(`${series[series.length - 1].date}T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() - RANGE_MONTHS[range]);
  const from = last.toISOString().slice(0, 10);
  const index = series.findIndex((point) => point.date >= from);
  return index === -1 ? 0 : index;
}

function signedColor(value: number): string {
  return value >= 0 ? COLORS.gain : COLORS.loss;
}

function tooltipRow(color: string | null, label: string, value: string) {
  const dot = color
    ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`
    : '<span style="display:inline-block;width:14px"></span>';
  return `<div style="display:flex;justify-content:space-between;gap:24px;line-height:22px"><span>${dot}${label}</span><span style="font-variant-numeric:tabular-nums;color:#262626">${value}</span></div>`;
}

function buildPortfolioHistoryOption(
  series: PortfolioHistorySeriesPoint[],
  startIndex: number
): EChartsOption {
  const dates = series.map((point) => point.date);
  const showCash = series.some((point) => Math.abs(point.cash) >= 1);
  const lastIndex = Math.max(0, series.length - 1);
  const lastPnl = series[lastIndex]?.total_pnl ?? 0;

  return {
    animation: false,
    legend: {
      top: 0,
      right: 72,
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 4,
      textStyle: { color: '#595959' },
      data: [
        '净资产',
        '总市值',
        ...(showCash ? ['现金'] : []),
        // 盈亏线按正负变色，图例用中性色
        { name: '累计盈亏', itemStyle: { color: '#595959' } },
      ],
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: COLORS.zeroLine } },
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: '#f0f0f0',
      textStyle: { color: '#595959', fontSize: 12 },
      extraCssText: 'box-shadow:0 4px 12px rgba(0,0,0,0.08);min-width:220px',
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const index = items[0]?.dataIndex ?? 0;
        const point = series[index];
        if (!point) return '';
        const liabilities = liabilitiesOf(point);
        const leverageRatio =
          point.total_market_value > 0
            ? (liabilities / point.total_market_value) * 100
            : 0;
        return [
          `<div style="font-weight:600;color:#262626;margin-bottom:4px">${point.date}</div>`,
          tooltipRow(COLORS.netAssets, '净资产', toWan(point.net_assets)),
          tooltipRow(
            COLORS.marketValue,
            '总市值',
            toWan(point.total_market_value)
          ),
          tooltipRow(
            null,
            '融资负债',
            `${toWan(liabilities)}（${leverageRatio.toFixed(1)}%）`
          ),
          ...(showCash
            ? [tooltipRow(COLORS.cash, '现金', toWan(point.cash))]
            : []),
          tooltipRow(
            signedColor(point.daily_pnl),
            '当日盈亏',
            `<span style="color:${signedColor(point.daily_pnl)}">${toWan(point.daily_pnl)}</span>`
          ),
          tooltipRow(
            signedColor(point.total_pnl),
            '累计盈亏',
            `<span style="color:${signedColor(point.total_pnl)}">${toWan(point.total_pnl)}</span>`
          ),
        ].join('');
      },
    },
    // 资产与盈亏量级差一个数量级，分上下两个图、共用时间轴（不用双 Y 轴）
    grid: [
      { left: 56, right: 72, top: 48, height: '46%' },
      { left: 56, right: 72, top: '68%', bottom: 56 },
    ],
    xAxis: [0, 1].map((gridIndex) => ({
      type: 'category' as const,
      gridIndex,
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: COLORS.grid } },
      axisTick: { show: false },
      axisLabel: {
        show: gridIndex === 1,
        color: COLORS.axis,
        hideOverlap: true,
        formatter: (value: string) => value.slice(5),
      },
    })),
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        name: '资产',
        nameTextStyle: { color: COLORS.axis, align: 'right' },
        scale: true,
        splitNumber: 4,
        axisLabel: { color: COLORS.axis, formatter: axisWan },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      {
        type: 'value',
        gridIndex: 1,
        name: '累计盈亏',
        nameTextStyle: { color: COLORS.axis, align: 'right' },
        splitNumber: 3,
        axisLabel: { color: COLORS.axis, formatter: axisWan },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        startValue: startIndex,
        endValue: lastIndex,
      },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        startValue: startIndex,
        endValue: lastIndex,
        height: 18,
        bottom: 8,
        borderColor: 'transparent',
        backgroundColor: '#fafafa',
        fillerColor: 'rgba(42,120,214,0.12)',
        dataBackground: {
          lineStyle: { color: '#d9d9d9' },
          areaStyle: { color: '#f5f5f5' },
        },
        labelFormatter: (_value: number, valueStr: string) => valueStr,
      },
    ],
    series: [
      {
        name: '净资产',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: series.map((point) => point.net_assets),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, color: COLORS.netAssets },
        itemStyle: { color: COLORS.netAssets },
        endLabel: {
          show: true,
          color: COLORS.netAssets,
          formatter: (params) => toWan(Number(params.value)),
        },
        emphasis: { focus: 'none' },
      },
      {
        name: '总市值',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: series.map((point) => point.total_market_value),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, color: COLORS.marketValue },
        itemStyle: { color: COLORS.marketValue },
        emphasis: { focus: 'none' },
      },
      ...(showCash
        ? [
            {
              name: '现金',
              type: 'line' as const,
              xAxisIndex: 0,
              yAxisIndex: 0,
              data: series.map((point) => point.cash),
              showSymbol: false,
              symbolSize: 8,
              lineStyle: { width: 2, color: COLORS.cash },
              itemStyle: { color: COLORS.cash },
            },
          ]
        : []),
      // 盈亏按正负拆成两条（红盈绿亏），不用 visualMap：其分段渐变在 dataZoom 下会报错
      ...(
        [
          ['gain', (value: number) => value >= 0],
          ['loss', (value: number) => value < 0],
        ] as const
      ).map(([tone, keep]) => ({
        name: '累计盈亏',
        type: 'line' as const,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: series.map((point) =>
          keep(point.total_pnl) ? point.total_pnl : null
        ),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, color: COLORS[tone] },
        itemStyle: { color: COLORS[tone] },
        areaStyle: { origin: 0, color: COLORS[tone], opacity: 0.12 },
        endLabel: {
          // 只给最新一天所在的那条标端点值
          show: keep(lastPnl),
          color: COLORS[tone],
          formatter: (params: { value: unknown }) =>
            toWan(Number(params.value)),
        },
        markLine:
          tone === 'gain'
            ? {
                silent: true,
                symbol: 'none',
                label: { show: false },
                lineStyle: {
                  color: COLORS.zeroLine,
                  type: 'solid' as const,
                  width: 1,
                },
                data: [{ yAxis: 0 }],
              }
            : undefined,
      })),
    ],
  };
}

export function PortfolioHistoryChart({
  series,
}: {
  series: PortfolioHistorySeriesPoint[];
}) {
  const [range, setRange] = useState<RangeKey>('ALL');
  const startIndex = useMemo(
    () => rangeStartIndex(series, range),
    [series, range]
  );
  const option = useMemo(
    () => buildPortfolioHistoryOption(series, startIndex),
    [series, startIndex]
  );

  const first = series[startIndex];
  const last = series[series.length - 1];
  const netChange = first && last ? last.net_assets - first.net_assets : null;

  return (
    <div>
      <Space
        style={{
          width: '100%',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <Segmented
          size="small"
          options={RANGE_OPTIONS}
          value={range}
          onChange={(value) => setRange(value as RangeKey)}
        />
        {netChange !== null && first && last ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {first.date} 至 {last.date} 净资产
            <Text style={{ color: signedColor(netChange), marginLeft: 4 }}>
              {netChange >= 0 ? '+' : ''}
              {toWan(netChange)}
            </Text>
          </Text>
        ) : null}
      </Space>
      <ReactECharts
        option={option}
        style={{ height: 480, width: '100%' }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}

export default PortfolioHistoryChart;
