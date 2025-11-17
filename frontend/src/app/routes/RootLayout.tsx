import { Outlet } from 'react-router-dom';
import {
  Layout,
  Button,
  Space,
  Typography,
  message,
  Dropdown,
  MenuProps,
} from 'antd';
import {
  GithubOutlined,
  DownOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { checkBackendConnection } from '../../config';
import useAppStore from '../../store';
import apiClient from '../../services/api';

const { Header, Content } = Layout;
const { Title } = Typography;

export function RootLayout() {
  const [messageApi, contextHolder] = message.useMessage();
  const [isExporting, setIsExporting] = useState(false);
  const selectedPortfolioId = useAppStore((state) => state.selectedPortfolioId);

  useEffect(() => {
    const checkConnection = async () => {
      const isConnected = await checkBackendConnection();
      if (!isConnected) {
        messageApi.error('无法连接到后端服务，请确保后端服务已启动', 5);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [messageApi]);

  const handleExportPNG = async () => {
    setIsExporting(true);
    messageApi.loading({
      content: '正在生成界面快照...',
      key: 'exporting',
      duration: 0,
    });
    try {
      const { default: html2canvas } = await import('html2canvas');
      const captureTarget = document.documentElement;

      if (!captureTarget) {
        throw new Error('无法找到截图目标元素');
      }

      const canvas = await html2canvas(captureTarget, {
        useCORS: true,
        logging: false,
      });

      const imageDataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:T.]/g, '')
        .slice(0, 14);
      link.download = `投资组合快照_${timestamp}.png`;
      link.href = imageDataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      messageApi.success({
        content: '界面快照已成功导出！',
        key: 'exporting',
        duration: 2,
      });
    } catch (error) {
      console.error('导出界面快照时出错:', error);
      messageApi.error({
        content: '导出界面快照失败，请查看控制台了解详情。',
        key: 'exporting',
        duration: 3,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!selectedPortfolioId) {
      messageApi.warning('请先选择一个投资组合');
      return;
    }

    setIsExporting(true);
    messageApi.loading({
      content: '正在生成 Markdown 报表...',
      key: 'exporting',
      duration: 0,
    });

    try {
      const blob = await apiClient.exportPortfolioMarkdown(selectedPortfolioId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      // 使用默认文件名
      const filename = `投资组合报表_${selectedPortfolioId}_${new Date().toISOString().slice(0, 10)}.md`;

      link.download = filename;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      messageApi.success({
        content: 'Markdown 报表已成功导出！',
        key: 'exporting',
        duration: 2,
      });
    } catch (error) {
      console.error('导出 Markdown 报表时出错:', error);
      messageApi.error({
        content: '导出 Markdown 报表失败，请查看控制台了解详情。',
        key: 'exporting',
        duration: 3,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const exportMenuItems: MenuProps['items'] = [
    {
      key: 'png',
      label: '导出界面快照 (PNG)',
      onClick: handleExportPNG,
    },
    {
      key: 'markdown',
      label: '导出数据报表 (Markdown)',
      onClick: handleExportMarkdown,
      disabled: !selectedPortfolioId,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {contextHolder}
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#ffffff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '64px',
        }}
      >
        <Title level={3} style={{ margin: 0, fontSize: '20px' }}>
          个人投资组合管理工具
        </Title>
        <div
          style={{
            flexGrow: 1,
            textAlign: 'center',
            padding: '0 16px',
          }}
        >
          <span
            style={{
              fontFamily: "'SealScriptFont', sans-serif",
              fontSize: '18px',
              color: 'rgba(0, 0, 0, 0.65)',
            }}
          >
            弱水三千，只取一瓢用
          </span>
        </div>
        <Space>
          <Button
            type="text"
            icon={<GithubOutlined />}
            href="https://github.com/cuowuxuexi/Unified.Holdings.Tracker"
            target="_blank"
            style={{ color: 'rgba(0, 0, 0, 0.85)' }}
          />
          <Dropdown menu={{ items: exportMenuItems }} disabled={isExporting}>
            <Button icon={<ExportOutlined />} loading={isExporting}>
              导出报表 <DownOutlined />
            </Button>
          </Dropdown>
        </Space>
      </Header>

      <Content
        style={{
          background: '#f5f7fa',
          padding: '24px',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            background: '#fff',
            padding: '0',
            borderRadius: '8px',
            boxShadow: '0 1px 8px rgba(0, 0, 0, 0.08)',
            minHeight: 'calc(100vh - 64px - 48px)',
          }}
        >
          <Outlet />
        </div>
      </Content>
    </Layout>
  );
}
