-- Бюджет 6890 (DECISIONS §22): заявка привязывается к статье бюджета —
-- факт считается по каждой статье отдельно.

ALTER TABLE "payment_requests" ADD COLUMN "budgetLineId" TEXT;

ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_budgetLineId_fkey"
  FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payment_requests_budgetLineId_idx" ON "payment_requests"("budgetLineId");
