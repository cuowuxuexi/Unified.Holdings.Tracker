// 修改 theme.ts 文件
import { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    // 品牌色系 - Claude 风格暖橙棕色
    colorPrimary: '#CC7A4F',

    // 功能色系
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',

    // 中性色系 - Claude 风格
    colorTextBase: '#2C2C2C',    // 主文本色
    colorBgBase: '#FFFFFF',      // 基础背景色（卡片）
    colorBorder: '#E8E5E0',      // 边框色

    // 尺寸和圆角
    borderRadius: 8,             // 基础圆角（加大）
    borderRadiusLG: 12,          // 大型元素圆角（加大）

    // 字体系统
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  },

  components: {
    // 卡片组件样式优化 - Claude 风格
    Card: {
      colorBorderSecondary: '#E8E5E0',
      paddingLG: 24,
      boxShadowTertiary: '0 2px 16px rgba(0,0,0,0.06)',
    },

    // 按钮组件样式
    Button: {
      colorPrimary: '#CC7A4F',
      colorPrimaryHover: '#B36A42',
      colorPrimaryActive: '#9A5835',
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

    // 布局组件样式优化 - Claude 风格米白色背景
    Layout: {
      headerBg: '#FFFFFF',
      bodyBg: '#F5F3EF',           // Claude 风格米白色
      siderBg: '#ffffff',
    }
  }
};

// Claude 风格配色变量
export const customVars = {
  // 背景色系
  bgPrimary: '#F5F3EF',          // 主背景（米白色）
  bgCard: '#FFFFFF',             // 卡片背景
  
  // 品牌色系
  brandPrimary: '#CC7A4F',       // 主色调（暖橙棕）
  brandHover: '#B36A42',         // 悬停态
  brandActive: '#9A5835',        // 激活态
  
  // 文本色系
  textPrimary: '#2C2C2C',        // 主文本
  textSecondary: '#6B6B6B',      // 次文本
  textTertiary: '#999999',       // 辅助文本
  
  // 金融应用特定变量
  profitColor: '#52c41a',
  lossColor: '#ff4d4f',
  numberFontFamily: '"SF Mono", Consolas, Menlo, monospace',
  
  // 边框和阴影
  borderColor: '#E8E5E0',
  dividerColor: '#D6D3CE',
  cardShadow: '0 2px 16px rgba(0, 0, 0, 0.06)',
  cardShadowHover: '0 4px 24px rgba(0, 0, 0, 0.12)',

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