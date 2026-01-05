import { describe, it, expect } from '@jest/globals';
import {
  getLastWeekSaturdayDate,
  getFirstDayOfCurrentMonth,
  getFirstDayOfCurrentYear,
  formatDate,
} from '../utils';

describe('周期日期计算修复验证', () => {
  describe('getLastWeekSaturdayDate (本周一)', () => {
    it('周一返回当天0点', () => {
      const monday = new Date('2025-12-29T15:30:00'); // 周一下午
      const result = getLastWeekSaturdayDate(monday);
      expect(formatDate(result)).toBe('2025-12-29'); // 应该是本周一
    });

    it('周二返回本周一', () => {
      const tuesday = new Date('2025-12-30T10:00:00'); // 周二
      const result = getLastWeekSaturdayDate(tuesday);
      expect(formatDate(result)).toBe('2025-12-29'); // 本周一
    });

    it('周日返回本周一（上周一）', () => {
      const sunday = new Date('2025-12-28T20:00:00'); // 周日
      const result = getLastWeekSaturdayDate(sunday);
      expect(formatDate(result)).toBe('2025-12-22'); // 上周一
    });

    it('周六返回本周一', () => {
      const saturday = new Date('2026-01-03T14:00:00'); // 周六
      const result = getLastWeekSaturdayDate(saturday);
      expect(formatDate(result)).toBe('2025-12-29'); // 本周一
    });
  });

  describe('getFirstDayOfCurrentMonth (本月1日)', () => {
    it('月初返回本月1日', () => {
      const firstDay = new Date('2025-12-01T00:00:00');
      const result = getFirstDayOfCurrentMonth(firstDay);
      expect(formatDate(result)).toBe('2025-12-01');
    });

    it('月中返回本月1日', () => {
      const midMonth = new Date('2025-12-15T12:00:00');
      const result = getFirstDayOfCurrentMonth(midMonth);
      expect(formatDate(result)).toBe('2025-12-01');
    });

    it('月末返回本月1日', () => {
      const lastDay = new Date('2025-12-31T23:59:59');
      const result = getFirstDayOfCurrentMonth(lastDay);
      expect(formatDate(result)).toBe('2025-12-01');
    });
  });

  describe('getFirstDayOfCurrentYear (今年1月1日)', () => {
    it('年初返回今年1月1日', () => {
      const newYear = new Date('2025-01-01T00:00:00');
      const result = getFirstDayOfCurrentYear(newYear);
      expect(formatDate(result)).toBe('2025-01-01');
    });

    it('年中返回今年1月1日', () => {
      const midYear = new Date('2025-06-15T12:00:00');
      const result = getFirstDayOfCurrentYear(midYear);
      expect(formatDate(result)).toBe('2025-01-01');
    });

    it('年末返回今年1月1日', () => {
      const endYear = new Date('2025-12-31T23:59:59');
      const result = getFirstDayOfCurrentYear(endYear);
      expect(formatDate(result)).toBe('2025-01-01');
    });
  });

  describe('周度计算逻辑验证', () => {
    it('周一的周度收益应该只包含当天', () => {
      // 模拟场景：今天是周一，当日亏损1838元
      // 周度收益应该接近当日收益，而不是包含上周六、日的数据
      const monday = new Date('2025-12-29T16:00:00');
      const weekStart = getLastWeekSaturdayDate(monday);

      expect(formatDate(weekStart)).toBe('2025-12-29');
      expect(formatDate(monday)).toBe('2025-12-29');

      // 验证周期长度为0天（当天0点到当天）
      const daysDiff = (monday.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeLessThan(1); // 同一天内
    });
  });
});
