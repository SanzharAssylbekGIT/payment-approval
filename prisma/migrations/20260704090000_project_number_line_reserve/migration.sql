-- Сквозной номер проекта (присваивает система) + продакшн-резерв по строке сметы.

-- 1) projects.number: добавить, пронумеровать существующие по дате регистрации.
ALTER TABLE "projects" ADD COLUMN "number" INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "entityId" ORDER BY "createdAt", id) AS rn
  FROM "projects"
)
UPDATE "projects" p SET "number" = n.rn FROM numbered n WHERE p.id = n.id;

ALTER TABLE "projects" ALTER COLUMN "number" SET NOT NULL;

CREATE UNIQUE INDEX "projects_entityId_number_key" ON "projects"("entityId", "number");

-- 2) estimate_lines.reserveAmount: продакшн-резерв по каждой строке (блогер × опция).
ALTER TABLE "estimate_lines" ADD COLUMN "reserveAmount" BIGINT NOT NULL DEFAULT 0;
