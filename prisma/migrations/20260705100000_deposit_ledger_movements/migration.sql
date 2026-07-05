-- Депозиты/резервы («копилки», DECISIONS §19): движения копилок тегируются
-- ledgerId на транзакции; Allocation запоминает депозитную долю для пересчётов.

-- Часть costAmount разнесения, отщеплённая в депозит продакшна.
ALTER TABLE "allocations" ADD COLUMN "depositAmount" BIGINT NOT NULL DEFAULT 0;

-- Принадлежность движения копилке (депозит/резерв). ledgerId != null =>
-- движение НЕ входит в баланс проекта (projectId — только контекст).
ALTER TABLE "transactions" ADD COLUMN "ledgerId" TEXT;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ledgerId_fkey"
  FOREIGN KEY ("ledgerId") REFERENCES "ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "transactions_ledgerId_idx" ON "transactions"("ledgerId");
