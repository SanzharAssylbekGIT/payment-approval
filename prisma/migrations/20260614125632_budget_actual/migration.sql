-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "actualAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "matchKeywords" TEXT;
