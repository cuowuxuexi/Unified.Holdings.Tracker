-- Commit 2: 扩展 Snapshot 结构并补齐写入链路所需表/列
-- 仅做保守增量变更：新增可空列、创建新表、补唯一索引

ALTER TABLE "PortfolioSnapshot" ADD COLUMN "leverageUsed" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "leverageTotal" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "leverageCostRate" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "leverageCumulativeCost" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "usdCny" DECIMAL;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "hkdCny" DECIMAL;

ALTER TABLE "PositionSnapshot" ADD COLUMN "costPrice" DECIMAL;
ALTER TABLE "PositionSnapshot" ADD COLUMN "totalPnl" DECIMAL;
ALTER TABLE "PositionSnapshot" ADD COLUMN "dailyPnl" DECIMAL;
ALTER TABLE "PositionSnapshot" ADD COLUMN "dailyPct" DECIMAL;

ALTER TABLE "QuoteSnapshot" ADD COLUMN "date" TEXT;

CREATE TABLE "ExchangeRateSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "rate" DECIMAL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "QuoteSnapshot_assetCode_date_key" ON "QuoteSnapshot"("assetCode", "date");
CREATE UNIQUE INDEX "ExchangeRateSnapshot_date_pair_key" ON "ExchangeRateSnapshot"("date", "pair");
