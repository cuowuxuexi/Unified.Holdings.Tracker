-- Commit 3: 扩展快照表字段，新建指数快照表
-- 目标：快照时存储全量数据，管线零实时依赖
-- 所有新列均可空，兼容 SQLite ALTER TABLE 限制

-- PortfolioSnapshot 新增财务指标字段
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "realizedPnl" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "unrealizedPnl" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "totalCommission" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "netDepositedCash" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "totalDividendIncome" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "totalPnlPercent" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "dailyPnlPercent" DECIMAL;

-- PortfolioSnapshot 新增周期收益字段
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "weeklyReturnPercent" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "weeklyReturnValue" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "weeklyBaseDate" TEXT;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "monthlyReturnPercent" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "monthlyReturnValue" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "monthlyBaseDate" TEXT;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "yearlyReturnPercent" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "yearlyReturnValue" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "yearlyBaseDate" TEXT;

-- PositionSnapshot 新增盈亏详情字段
ALTER TABLE "PositionSnapshot" ADD COLUMN "totalPnlPercent" DECIMAL;
ALTER TABLE "PositionSnapshot" ADD COLUMN "floatingPnl" DECIMAL;
ALTER TABLE "PositionSnapshot" ADD COLUMN "floatingPnlPercent" DECIMAL;

-- 新建市场指数快照表
CREATE TABLE "IndexSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "indexCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentPrice" DECIMAL NOT NULL,
    "changeAmount" DECIMAL,
    "changePercent" DECIMAL,
    "weeklyChangePercent" DECIMAL,
    "monthlyChangePercent" DECIMAL,
    "yearlyChangePercent" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "IndexSnapshot_date_indexCode_key" ON "IndexSnapshot"("date", "indexCode");
