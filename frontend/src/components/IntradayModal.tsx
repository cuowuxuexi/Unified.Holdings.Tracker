import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Alert, Modal, Spin, Typography } from 'antd';
import type { EChartsOption } from 'echarts';
import '../lib/echarts';
import apiClient from '../services/api';
import type { IntradayData } from '../store/types';
import { formatPercent } from '../shared/utils/formatters';
import { buildSessionSlots, perMinuteVolumes } from '../shared/utils/intraday';

const { Text } = Typography;

const UP_COLOR = '#fa541c';
const DOWN_COLOR = '#52c41a';
const REFRESH_MS = 30 * 1000;

interface IntradayModalProps {
  code: string | null;
  name?: string;
  onClose: () => void;
}

// 点大盘/个股卡片弹出的当日分时图；打开期间每 30 秒刷新
const IntradayModal: React.FC<IntradayModalProps> = ({
  code,
  name,
  onClose,
}) => {
  const [data, setData] = useState<IntradayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setData(null);
    setError(null);
    const load = async () => {
      try {
        const result = await apiClient.fetchIntraday(code);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [code]);

  const option = useMemo<EChartsOption | null>(() => {
    if (!data || !data.prevClose || data.points.length === 0) return null;
    const prev = data.prevClose;
    const slots = buildSessionSlots(data.code);
    const priceByTime = new Map(data.points.map((p) => [p.time, p.price]));
    const volumes = perMinuteVolumes(data.points);
    const volumeByTime = new Map(
      data.points.map((p, i) => [p.time, volumes[i]])
    );
    const last = data.points[data.points.length - 1].price;
    const lineColor = last >= prev ? UP_COLOR : DOWN_COLOR;
    // 以昨收为中轴上下对称，涨跌幅一眼可比
    const dev =
      Math.max(
        ...data.points.map((p) => Math.abs(p.price - prev)),
        prev * 0.002
      ) * 1.1;
    const pctOf = (v: number) => ((v - prev) / prev) * 100;

    return {
      animation: false,
      grid: [
        { left: 64, right: 64, top: 16, height: '62%' },
        { left: 64, right: 64, top: '76%', height: '16%' },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', link: [{ xAxisIndex: 'all' }] },
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const time = String(list[0]?.name ?? '');
          const price = priceByTime.get(time);
          if (price === undefined) return time;
          return [
            time,
            `价格 ${price.toFixed(2)}`,
            `涨跌 ${formatPercent(pctOf(price))}`,
            `成交量 ${(volumeByTime.get(time) ?? 0).toLocaleString('zh-CN')}`,
          ].join('<br/>');
        },
      },
      xAxis: [
        {
          type: 'category',
          data: slots,
          boundaryGap: false,
          axisLabel: {
            interval: (index: number, value: string) =>
              index === 0 || index === slots.length - 1 || value === '13:00',
          },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: slots,
          boundaryGap: false,
          axisLabel: { show: false },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          min: prev - dev,
          max: prev + dev,
          interval: dev / 2,
          axisLabel: { formatter: (v: number) => v.toFixed(2) },
          splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } },
        },
        {
          type: 'value',
          min: prev - dev,
          max: prev + dev,
          interval: dev / 2,
          position: 'right',
          axisLabel: { formatter: (v: number) => formatPercent(pctOf(v)) },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          type: 'line',
          data: slots.map((t) => priceByTime.get(t) ?? null),
          showSymbol: false,
          connectNulls: true,
          lineStyle: { color: lineColor, width: 1.5 },
          areaStyle: { color: lineColor, opacity: 0.08 },
          markLine: {
            symbol: 'none',
            silent: true,
            label: { show: false },
            lineStyle: { color: '#999', type: 'dashed' },
            data: [{ yAxis: prev }],
          },
        },
        {
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 2,
          data: slots.map((t, i) => {
            const v = volumeByTime.get(t);
            if (v === undefined) return null;
            const p = priceByTime.get(t) ?? prev;
            const before =
              i > 0 ? (priceByTime.get(slots[i - 1]) ?? prev) : prev;
            return {
              value: v,
              itemStyle: { color: p >= before ? UP_COLOR : DOWN_COLOR },
            };
          }),
          barMaxWidth: 3,
        },
      ],
    };
  }, [data]);

  const change = data?.changePercent ?? null;
  const changeColor =
    change === null ? undefined : change >= 0 ? UP_COLOR : DOWN_COLOR;

  return (
    <Modal
      open={Boolean(code)}
      onCancel={onClose}
      footer={null}
      width={880}
      destroyOnHidden
      title={
        <span>
          {data?.name ?? name ?? code} · 分时
          <Text type="secondary" style={{ marginLeft: 8, fontWeight: 400 }}>
            {code}
            {data?.date ? ` · ${data.date}` : ''}
          </Text>
          {data?.currentPrice != null && (
            <span style={{ marginLeft: 16, color: changeColor }}>
              {data.currentPrice.toFixed(2)}
              {change !== null && (
                <span style={{ marginLeft: 8 }}>{formatPercent(change)}</span>
              )}
            </span>
          )}
        </span>
      }
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message="分时数据获取失败"
          description={error}
        />
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '120px 0' }}>
          <Spin />
        </div>
      ) : option ? (
        <ReactECharts
          option={option}
          notMerge
          style={{ height: 420, width: '100%' }}
        />
      ) : (
        <Alert type="info" showIcon message="暂无分时数据" />
      )}
    </Modal>
  );
};

export default IntradayModal;
