-- Блогер: ссылка на основной аккаунт
ALTER TABLE "bloggers" ADD COLUMN "link" TEXT;

-- Прайс переезжает с фикс-форматов на именованные опции. Существующие строки —
-- только демо-сид; чистим перед добавлением NOT NULL-колонок.
DELETE FROM "blogger_prices";

DROP INDEX "blogger_prices_bloggerId_kind_key";

ALTER TABLE "blogger_prices"
  ADD COLUMN "name" TEXT NOT NULL,
  ADD COLUMN "taxPct" INTEGER,
  ADD COLUMN "priceWithTax" BIGINT NOT NULL,
  ALTER COLUMN "kind" SET DEFAULT 'OTHER';

CREATE UNIQUE INDEX "blogger_prices_bloggerId_name_key" ON "blogger_prices"("bloggerId", "name");
