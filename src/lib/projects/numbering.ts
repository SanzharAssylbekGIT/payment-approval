// Нумерация проектов: номер присваивает система (max+1), у КАЖДОГО
// направления своя последовательность (IM-#/PR-#/EV-#/SP-#, см. code.ts).
// Гонка двух создающих разрешается повтором на нарушении уникальности
// (entityId, serviceType, number).

import { Prisma, type Project, type ServiceType } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function nextProjectNumber(entityId: string, serviceType: ServiceType): Promise<number> {
  const max = await prisma.project.aggregate({ where: { entityId, serviceType }, _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}

export async function createProjectNumbered(
  data: Omit<Prisma.ProjectUncheckedCreateInput, "number">,
): Promise<Project> {
  for (let attempt = 0; ; attempt++) {
    const number = await nextProjectNumber(data.entityId, data.serviceType as ServiceType);
    try {
      return await prisma.project.create({ data: { ...data, number } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}
