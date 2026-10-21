-- 自动分红结算台账：一条分红事件在一个组合里只处理一次（SETTLED / MATCHED_MANUAL / DISMISSED）。
CREATE TABLE "DividendSettlement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "portfolioId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "exDate" TEXT NOT NULL,
    "payDate" TEXT,
    "status" TEXT NOT NULL,
    "transactionId" TEXT,
    "quantity" DECIMAL,
    "cashPerShare" DECIMAL,
    "currency" TEXT,
    "grossAmount" DECIMAL,
    "taxAmount" DECIMAL,
    "netAmount" DECIMAL,
    "amountCny" DECIMAL,
    "sourceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DividendSettlement_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DividendSettlement_portfolioId_eventKey_key" ON "DividendSettlement"("portfolioId", "eventKey");
CREATE INDEX "DividendSettlement_transactionId_idx" ON "DividendSettlement"("transactionId");
