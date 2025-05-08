import { useEffect, useState } from 'react';
import { Layout, Button, Modal, Drawer, Space, Typography, message } from 'antd';
import { GithubOutlined } from '@ant-design/icons'; // 导入 GitHub 图标
import { checkBackendConnection } from './config';
import PortfolioList from './components/PortfolioList';
import PortfolioDetailView from './components/PortfolioDetailView';
import CreatePortfolioForm from './components/CreatePortfolioForm';
import AddTransactionForm from './components/AddTransactionForm';
import useAppStore from './store';
import html2canvas from 'html2canvas';
// import './App.css'; // 移除旧 CSS 引用，如果 App.css 不再包含必要样式

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

function App() {
  const [isCreatePortfolioModalVisible, setIsCreatePortfolioModalVisible] = useState(false);
  const [isAddTransactionDrawerVisible, setIsAddTransactionDrawerVisible] = useState(false);
  const selectedPortfolioId = useAppStore((state) => state.selectedPortfolioId);
  const [collapsed, setCollapsed] = useState(false); // Sider collapse state
  const [isExporting, setIsExporting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_backendConnected, setBackendConnected] = useState(true);

  useEffect(() => {
    const checkConnection = async () => {
      const isConnected = await checkBackendConnection();
      setBackendConnected(isConnected);
      if (!isConnected) {
        message.error('无法连接到后端服务，请确保后端服务已启动', 5); // 增加持续时间
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  // --- Modal and Drawer Handlers ---
  const showCreatePortfolioModal = () => setIsCreatePortfolioModalVisible(true);
  const handleCreatePortfolioCancel = () => setIsCreatePortfolioModalVisible(false);
  const handleCreatePortfolioSuccess = () => {
    setIsCreatePortfolioModalVisible(false);
    message.success('投资组合创建成功！');
  };

  const showAddTransactionDrawer = () => setIsAddTransactionDrawerVisible(true);
  const handleAddTransactionClose = () => setIsAddTransactionDrawerVisible(false);
  const handleAddTransactionSuccess = () => {
    setIsAddTransactionDrawerVisible(false);
    message.success('交易记录添加成功！');
  };

  // --- Export Handler ---
  const handleExportReport = async () => {
    setIsExporting(true);
    message.loading({ content: '正在生成界面快照...', key: 'exporting', duration: 0 });
    try {
      // 使用 document.body 作为截图目标，确保包含 Modal/Drawer 等绝对定位元素
      // 如果只需要特定区域，可以调整为 const captureTarget = document.getElementById('app-content-card');
      const captureTarget = document.documentElement; // 截取整个可见页面

      if (!captureTarget) {
        throw new Error("无法找到截图目标元素");
      }

      const canvas = await html2canvas(captureTarget, {
        useCORS: true,
        // scale: window.devicePixelRatio > 1 ? window.devicePixelRatio : 1, // 提高清晰度 (可选)
        logging: false, // 关闭 html2canvas 的日志
        // 尝试解决某些元素渲染问题 (可选)
        // allowTaint: true,
        // foreignObjectRendering: true,
      });

      const imageDataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
      link.download = `投资组合快照_${timestamp}.png`;
      link.href = imageDataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      message.success({ content: '界面快照已成功导出！', key: 'exporting', duration: 2 });

    } catch (error) {
      console.error("导出界面快照时出错:", error);
      message.error({ content: '导出界面快照失败，请查看控制台了解详情。', key: 'exporting', duration: 3 });
    } finally {
      setIsExporting(false);
    }
  };

  // --- Render ---
  return (
    <Layout id="app-root-layout" style={{ minHeight: '100vh' }}>
      {/* === Sticky Header === */}
      <Header style={{
        position: 'sticky',
        top: 0,
        zIndex: 10, // Ensure Header is above Sider content
        background: '#ffffff', // 改为浅色背景
        borderBottom: '1px solid #f0f0f0', // 添加底部边框
        padding: '0 24px', // Desktop padding
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '64px', // Standard height
        // 移除 TODO: Responsive padding for Header (e.g., 16px on mobile)
      }}>
        <Title level={3} style={{ margin: 0, fontSize: '20px' }}> {/* 移除 color: 'white' */}
          个人投资组合管理工具
        </Title>
        {/* Text added in the middle */}
        <div style={{ flexGrow: 1, textAlign: 'center', padding: '0 16px' }}> {/* Added padding */}
          <span style={{ fontFamily: "'SealScriptFont', sans-serif", fontSize: '18px', color: 'rgba(0, 0, 0, 0.65)' }}> {/* Adjusted font size and color */}
            弱水三千，只取一瓢用
          </span>
        </div>
        {/* 移除 TODO: Responsive Header Button Group (<992px use Dropdown/Menu Icon) */}
        <Space>
          {/* 添加 GitHub 链接按钮 */}
          <Button
            type="text" // 或者 type="link"
            icon={<GithubOutlined />}
            href="https://github.com/cuowuxuexi/Unified.Holdings.Tracker"
            target="_blank" // 在新标签页打开
            style={{ color: 'rgba(0, 0, 0, 0.85)' }} // 调整图标颜色以适应浅色主题
          />
          <Button type="primary" onClick={showCreatePortfolioModal}>
            创建投资组合
          </Button>
          <Button onClick={showAddTransactionDrawer} disabled={!selectedPortfolioId}>
            添加交易记录
          </Button>
          <Button
            onClick={handleExportReport}
            disabled={!selectedPortfolioId}
            loading={isExporting}
          >
            导出报表
          </Button>
        </Space>
      </Header>

      <Layout hasSider> {/* Layout containing Sider and Content */}
        {/* === Collapsible Sider === */}
        <Sider
          theme="light" // Changed to light theme
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          // Removed: breakpoint="lg"
          // Removed: collapsedWidth={0}
          // Removed: trigger={null} to enable default trigger
          style={{
            position: 'sticky',
            top: 64, // Stick below the 64px Header
            height: 'calc(100vh - 64px)', // Full height below header
            overflow: 'auto', // Enable scrolling for long menus
            // Removed TODOs
          }}
        >
          <PortfolioList collapsed={collapsed} setCollapsed={setCollapsed} />
        </Sider>

        {/* === Main Content Area === */}
        <Content style={{
          background: '#f5f7fa', // Light grey background for the content area
          padding: '24px', // Outer padding (desktop)
          overflow: 'auto', // Allow content area to scroll independently
          // TODO: Responsive padding for Content (e.g., 16px on mobile)
        }}>
          {/* TODO: Add Breadcrumb component here */}
          {/* --- White Card Container --- */}
          <div id="app-content-card" style={{
            background: '#fff', // White background for the card
            padding: '24px', // Inner padding for the card content
            borderRadius: '8px', // Rounded corners
            boxShadow: '0 1px 8px rgba(0, 0, 0, 0.08)', // Subtle shadow
            margin: 0, // Ensure full width, remove horizontal centering
            minHeight: 'calc(100vh - 64px - 48px)' // Ensure card takes minimum height (Header + Content Padding)
          }}>
            <PortfolioDetailView portfolioId={selectedPortfolioId} />
          </div>
        </Content>
      </Layout>

      {/* === Modals & Drawers === */}
      <Modal
        title="创建新投资组合"
        open={isCreatePortfolioModalVisible}
        onCancel={handleCreatePortfolioCancel}
        footer={null}
        destroyOnClose
      >
        <CreatePortfolioForm onSuccess={handleCreatePortfolioSuccess} />
      </Modal>

      <Drawer
        title="添加新交易记录"
        width={480}
        onClose={handleAddTransactionClose}
        open={isAddTransactionDrawerVisible}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        {selectedPortfolioId ? (
          <AddTransactionForm
            portfolioId={selectedPortfolioId}
            onSuccess={handleAddTransactionSuccess}
          />
        ) : (
          <Typography.Text type="secondary">请先在左侧选择一个投资组合。</Typography.Text>
        )}
      </Drawer>
    </Layout>
  );
}

export default App;
