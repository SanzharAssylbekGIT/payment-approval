-- Нумерация проектов — своя у каждого направления (IM-#/PR-#/EV-#/SP-#):
-- уникальность (entityId, serviceType, number), существующие проекты
-- перенумеровываются внутри направления с сохранением порядка.

DROP INDEX "projects_entityId_number_key";

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "entityId", "serviceType" ORDER BY "number", "createdAt", id) AS rn
  FROM "projects"
)
UPDATE "projects" p SET "number" = n.rn FROM numbered n WHERE p.id = n.id;

CREATE UNIQUE INDEX "projects_entityId_serviceType_number_key" ON "projects"("entityId", "serviceType", "number");
