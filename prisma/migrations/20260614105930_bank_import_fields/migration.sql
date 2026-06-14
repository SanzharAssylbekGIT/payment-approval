-- CreateEnum
CREATE TYPE "BankLineCategory" AS ENUM ('CLIENT_INCOMING', 'PROJECT_PAYOUT', 'INTERNAL_TRANSFER', 'SALARY', 'NON_REVENUE', 'OTHER');

-- AlterTable
ALTER TABLE "bank_statement_imports" ADD COLUMN     "accountCode" TEXT,
ADD COLUMN     "balanceOk" BOOLEAN,
ADD COLUMN     "closingBalance" BIGINT,
ADD COLUMN     "openingBalance" BIGINT,
ADD COLUMN     "periodFrom" TEXT,
ADD COLUMN     "periodTo" TEXT;

-- AlterTable
ALTER TABLE "bank_statement_lines" ADD COLUMN     "category" "BankLineCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "docNumber" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "knp" TEXT,
ADD COLUMN     "matchedRequestId" TEXT;

-- CreateIndex
CREATE INDEX "bank_statement_lines_category_idx" ON "bank_statement_lines"("category");

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matchedRequestId_fkey" FOREIGN KEY ("matchedRequestId") REFERENCES "payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
