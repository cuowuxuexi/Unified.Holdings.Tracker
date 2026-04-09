-- Phase 1: Add correctedAt column to PortfolioSnapshot
-- Marks when K-line correction has been applied; NULL means uncorrected.
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "correctedAt" DATETIME;
