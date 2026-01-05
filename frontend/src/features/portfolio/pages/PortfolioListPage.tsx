import { useState } from 'react';
import { Modal, Spin, Alert, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { usePortfolios } from '../../../shared/hooks/usePortfolios';
import { PortfolioList } from '../components/PortfolioList';
import { CreatePortfolioForm } from '../components/CreatePortfolioForm';
import { HeroCreateCard } from '../components/HeroCreateCard';
import { PortfolioMotto } from '../components/PortfolioMotto';
import styles from './PortfolioListPage.module.css';
import heroImage from '../../../assets/home-hero.png';

const { Title } = Typography;

export function PortfolioListPage() {
  const navigate = useNavigate();
  const [isAdvancedModalVisible, setIsAdvancedModalVisible] = useState(false);
  const [creationSuccessMessage, setCreationSuccessMessage] = useState<
    string | null
  >(null);
  const [isHeroImageErrored, setIsHeroImageErrored] = useState(false);

  const { data: portfolios, isLoading, error } = usePortfolios();

  const handlePortfolioSelect = (id: string) => {
    navigate(`/portfolio/${id}`);
  };

  const handleCreationSuccess = () => {
    setCreationSuccessMessage('新的投资组合已创建，列表已刷新。');
  };

  const handleAdvancedSuccess = () => {
    handleCreationSuccess();
    setIsAdvancedModalVisible(false);
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        message="加载失败"
        description="无法加载投资组合列表，请检查后端服务是否正常运行。"
        type="error"
        showIcon
      />
    );
  }

  return (
    <div className={styles.pageContainer}>
      {creationSuccessMessage && (
        <Alert
          className={styles.stickyAlert}
          message={creationSuccessMessage}
          type="success"
          showIcon
          closable
          onClose={() => setCreationSuccessMessage(null)}
        />
      )}

      <div className={styles.mainGrid}>
        {/* 左侧区域：创建卡片 + 投资组合列表 */}
        <div className={styles.leftColumn}>
          <div className={styles.createCardContainer}>
            <HeroCreateCard
              onOpenAdvanced={() => setIsAdvancedModalVisible(true)}
              buttonClassName={styles.heroCreateButton}
            />
          </div>
          <div className={styles.portfolioListContainer}>
            <PortfolioList
              portfolios={portfolios || []}
              onSelect={handlePortfolioSelect}
              className={styles.portfolioList}
            />
          </div>
        </div>

        {/* 中间区域：烟花插画 */}
        <div className={styles.centerColumn}>
          <div className={styles.heroMedia}>
            {isHeroImageErrored ? (
              <div className={styles.heroImageFallback}>
                <Title level={4} style={{ color: '#1a1a1a', marginBottom: 8 }}>
                  插画暂时无法显示
                </Title>
                <p>您仍可创建、管理投资组合，数据展示不受影响。</p>
              </div>
            ) : (
              <img
                src={heroImage}
                alt="投资组合插画"
                loading="lazy"
                className={styles.heroImage}
                onError={() => setIsHeroImageErrored(true)}
              />
            )}
          </div>
        </div>

        {/* 右侧区域：座右铭 */}
        <div className={styles.rightColumn}>
          <PortfolioMotto />
        </div>
      </div>

      <Modal
        title="高级设置：创建新投资组合"
        open={isAdvancedModalVisible}
        onCancel={() => setIsAdvancedModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <CreatePortfolioForm onSuccess={handleAdvancedSuccess} />
      </Modal>
    </div>
  );
}
