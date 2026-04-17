-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "initialCash" DECIMAL NOT NULL,
    "cash" DECIMAL NOT NULL,
    "leverageTotalAmount" DECIMAL NOT NULL,
    "leverageUsedAmount" DECIMAL NOT NULL,
    "leverageAvailableAmount" DECIMAL NOT NULL,
    "leverageCostRate" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "attentionInfo" TEXT,
    "snapshotEnabled" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Asset" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "assetCode" TEXT,
    "quantity" DECIMAL,
    "price" DECIMAL,
    "amount" DECIMAL,
    "commission" DECIMAL,
    "leverageUsed" DECIMAL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "exchangeRate" DECIMAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_assetCode_fkey" FOREIGN KEY ("assetCode") REFERENCES "Asset" ("code") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assetCode" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "currentPrice" DECIMAL NOT NULL,
    "changePercent" DECIMAL,
    "changeAmount" DECIMAL,
    "volume" DECIMAL,
    "turnover" DECIMAL,
    "openPrice" DECIMAL,
    "highPrice" DECIMAL,
    "lowPrice" DECIMAL,
    "prevClosePrice" DECIMAL,
    "marketCap" DECIMAL,
    "peRatio" DECIMAL,
    "weeklyChangePercent" DECIMAL,
    "monthlyChangePercent" DECIMAL,
    "yearlyChangePercent" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteSnapshot_assetCode_fkey" FOREIGN KEY ("assetCode") REFERENCES "Asset" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "portfolioId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "totalMarketValue" DECIMAL NOT NULL,
    "netAssets" DECIMAL NOT NULL,
    "totalPnl" DECIMAL NOT NULL,
    "dailyPnl" DECIMAL NOT NULL,
    "cash" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "portfolioId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "currentPrice" DECIMAL NOT NULL,
    "marketValue" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionSnapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PositionSnapshot_assetCode_fkey" FOREIGN KEY ("assetCode") REFERENCES "Asset" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttentionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttentionItem_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Transaction_assetCode_idx" ON "Transaction"("assetCode");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_type_idx" ON "Transaction"("portfolioId", "type");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_date_idx" ON "Transaction"("portfolioId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_portfolioId_date_key" ON "PortfolioSnapshot"("portfolioId", "date");

-- CreateIndex
CREATE INDEX "PositionSnapshot_portfolioId_date_idx" ON "PositionSnapshot"("portfolioId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PositionSnapshot_portfolioId_date_assetCode_key" ON "PositionSnapshot"("portfolioId", "date", "assetCode");

