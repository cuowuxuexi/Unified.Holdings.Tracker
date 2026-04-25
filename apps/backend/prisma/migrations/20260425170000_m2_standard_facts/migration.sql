-- M2 standard fact layer for source observability, yield curves, and macro indicators.
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "job" TEXT,
    "targetDate" TEXT,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "payloadHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "SourceHealth" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "YieldCurveSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "tenor" TEXT NOT NULL,
    "yieldPercent" DECIMAL,
    "sourceId" TEXT NOT NULL,
    "sourceTime" DATETIME,
    "status" TEXT NOT NULL,
    "errorSummary" TEXT,
    "payloadHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "MacroIndicatorSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "value" DECIMAL,
    "unit" TEXT,
    "sourceId" TEXT NOT NULL,
    "sourceTime" DATETIME,
    "status" TEXT NOT NULL,
    "errorSummary" TEXT,
    "payloadHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SourceRun_runKey_key" ON "SourceRun"("runKey");
CREATE INDEX "SourceRun_sourceId_startedAt_idx" ON "SourceRun"("sourceId", "startedAt");
CREATE INDEX "SourceRun_domain_targetDate_idx" ON "SourceRun"("domain", "targetDate");
CREATE INDEX "SourceRun_status_startedAt_idx" ON "SourceRun"("status", "startedAt");

CREATE UNIQUE INDEX "SourceHealth_sourceId_domain_key" ON "SourceHealth"("sourceId", "domain");
CREATE INDEX "SourceHealth_domain_status_idx" ON "SourceHealth"("domain", "status");
CREATE INDEX "SourceHealth_checkedAt_idx" ON "SourceHealth"("checkedAt");

CREATE UNIQUE INDEX "YieldCurveSnapshot_date_country_tenor_sourceId_key" ON "YieldCurveSnapshot"("date", "country", "tenor", "sourceId");
CREATE INDEX "YieldCurveSnapshot_date_country_idx" ON "YieldCurveSnapshot"("date", "country");
CREATE INDEX "YieldCurveSnapshot_country_tenor_date_idx" ON "YieldCurveSnapshot"("country", "tenor", "date");
CREATE INDEX "YieldCurveSnapshot_sourceId_date_idx" ON "YieldCurveSnapshot"("sourceId", "date");
CREATE INDEX "YieldCurveSnapshot_status_date_idx" ON "YieldCurveSnapshot"("status", "date");

CREATE UNIQUE INDEX "MacroIndicatorSnapshot_date_indicatorId_sourceId_key" ON "MacroIndicatorSnapshot"("date", "indicatorId", "sourceId");
CREATE INDEX "MacroIndicatorSnapshot_indicatorId_date_idx" ON "MacroIndicatorSnapshot"("indicatorId", "date");
CREATE INDEX "MacroIndicatorSnapshot_sourceId_date_idx" ON "MacroIndicatorSnapshot"("sourceId", "date");
CREATE INDEX "MacroIndicatorSnapshot_status_date_idx" ON "MacroIndicatorSnapshot"("status", "date");
