import { describe, expect, it } from 'vitest';
import { buildSessionSlots, perMinuteVolumes } from './intraday';

describe('buildSessionSlots', () => {
  it('A 股上下午两段各 121 个刻度，跳过午休', () => {
    const slots = buildSessionSlots('sh600519');
    expect(slots).toHaveLength(242);
    expect(slots[0]).toBe('09:30');
    expect(slots[120]).toBe('11:30');
    expect(slots[121]).toBe('13:00');
    expect(slots[slots.length - 1]).toBe('15:00');
  });

  it('港股午休 12:00-13:00，收盘 16:00', () => {
    const slots = buildSessionSlots('hk00700');
    expect(slots).toContain('12:00');
    expect(slots).not.toContain('12:30');
    expect(slots[slots.length - 1]).toBe('16:00');
  });

  it('美股不分段', () => {
    const slots = buildSessionSlots('usDJI');
    expect(slots).toHaveLength(391);
    expect(slots).toContain('12:00');
  });
});

describe('perMinuteVolumes', () => {
  it('把累计成交量差分为每分钟成交量，回退时记 0', () => {
    expect(
      perMinuteVolumes([
        { time: '09:30', price: 1, cumulativeVolume: 100 },
        { time: '09:31', price: 1, cumulativeVolume: 250 },
        { time: '09:32', price: 1, cumulativeVolume: 240 },
      ])
    ).toEqual([100, 150, 0]);
  });
});
