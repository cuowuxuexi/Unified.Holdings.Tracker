// 修改 theme.ts 文件
import { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    // 品牌色系 - 优化与金融投资相关的色彩
    colorPrimary: '#1890ff', // 调整主色调

    // 功能色系 - 增强红绿对比度
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',   // 略微调整红色

    // 中性色系 - 更精细的层次
    colorTextBase: '#262626',    // 主文本色
    colorBgBase: '#ffffff',      // 基础背景色
    colorBorder: '#f0f0f0',      // 边框色

    // 尺寸和圆角
    borderRadius: 4,            // 基础圆角
    borderRadiusLG: 8,          // 大型元素圆角

    // 字体系统
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  },

  components: {
    // 卡片组件样式优化
    Card: {
      colorBorderSecondary: '#f0f0f0',
      paddingLG: 16,
      boxShadowTertiary: '0 1px 10px rgba(0,0,0,0.05)',
    },

    // 表格组件样式优化
    Table: {
      colorBgContainer: '#fff',
      fontSize: 13,
      fontWeightStrong: 600,
      headerBg: '#f8faff',
      headerSplitColor: '#e6f7ff',
      rowHoverBg: '#e6f7ff',
    },

    // 布局组件样式优化
    Layout: {
      headerBg: '#001529',
      bodyBg: '#f5f7fa',
      siderBg: '#ffffff',
    }
  }
};

// 添加自定义变量，方便全局使用
export const customVars = {
  // 金融应用特定变量
  profitColor: '#52c41a',
  lossColor: '#ff4d4f',
  numberFontFamily: '"SF Mono", Consolas, Menlo, monospace',
  cardShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',

  // 响应式断点
  breakpoints: {
    xs: 480,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
  }
};

export default theme;