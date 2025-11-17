import styles from './PortfolioMotto.module.css';

export function PortfolioMotto() {
  return (
    <div className={styles.mottoContainer}>
      <div className={styles.mainTitle}>天晴修屋顶</div>
      <div className={styles.subTitle}>有什么 要什么 愿意付出什么</div>
      <div className={styles.keywords}>点位 仓位 风险管理</div>
    </div>
  );
}
