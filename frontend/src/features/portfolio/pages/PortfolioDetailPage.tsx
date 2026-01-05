import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Drawer, Typography } from 'antd';
import useAppStore from '../../../store';
// 临时使用 legacy 组件，待 P1 状态管理重构后迁移到新组件
import PortfolioDetailView from '../../../components/legacy/PortfolioDetailView';
import AddTransactionForm from '../../../components/legacy/AddTransactionForm';
import { BatchImport } from '../../transaction';

export function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const selectPortfolio = useAppStore((state) => state.selectPortfolio);
  const [isAddTransactionDrawerVisible, setIsAddTransactionDrawerVisible] = useState(false);
  const [isBatchImportDrawerVisible, setIsBatchImportDrawerVisible] = useState(false);

  useEffect(() => {
    if (id) {
      selectPortfolio(id);
    }
  }, [id, selectPortfolio]);

  // 监听添加交易记录事件
  useEffect(() => {
    const handleOpenAddTransaction = () => {
      setIsAddTransactionDrawerVisible(true);
    };
    
    const handleOpenBatchImport = () => {
      setIsBatchImportDrawerVisible(true);
    };

    window.addEventListener('openAddTransaction', handleOpenAddTransaction);
    window.addEventListener('openBatchImport', handleOpenBatchImport);
    return () => {
      window.removeEventListener('openAddTransaction', handleOpenAddTransaction);
      window.removeEventListener('openBatchImport', handleOpenBatchImport);
    };
  }, []);

  const handleAddTransactionSuccess = () => {
    setIsAddTransactionDrawerVisible(false);
  };
  
  const handleBatchImportSuccess = () => {
    setIsBatchImportDrawerVisible(false);
    // 刷新投资组合数据
    if (id) {
      selectPortfolio(id);
    }
  };

  return (
    <>
      <PortfolioDetailView portfolioId={id || null} />
      
      {/* 添加单条交易记录 */}
      <Drawer
        title="添加新交易记录"
        width={480}
        onClose={() => setIsAddTransactionDrawerVisible(false)}
        open={isAddTransactionDrawerVisible}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        {id ? (
          <AddTransactionForm
            portfolioId={id}
            onSuccess={handleAddTransactionSuccess}
          />
        ) : (
          <Typography.Text type="secondary">
            请先选择一个投资组合。
          </Typography.Text>
        )}
      </Drawer>
      
      {/* 批量导入交易记录 */}
      <Drawer
        title="批量导入交易记录"
        width={920}
        onClose={() => setIsBatchImportDrawerVisible(false)}
        open={isBatchImportDrawerVisible}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        {id ? (
          <BatchImport
            portfolioId={id}
            onSuccess={handleBatchImportSuccess}
          />
        ) : (
          <Typography.Text type="secondary">
            请先选择一个投资组合。
          </Typography.Text>
        )}
      </Drawer>
    </>
  );
}

