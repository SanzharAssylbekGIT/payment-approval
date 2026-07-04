// Сквозная нумерация проектов по компании: номер присваивает система (max+1),
// независимо от того, кто занёс проект и какая услуга. Гонка двух создающих
// разрешается повтором на нарушении уникальности (entityId, number).

import { Prisma, type Project } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function nextProjectNumber(entityId: string): Promise<number> {
  const max = await prisma.project.aggregate({ where: { entityId }, _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}

export async function createProjectNumbered(
  data: Omit<Prisma.ProjectUncheckedCreateInput, "number">,
): Promise<Project> {
  for (let attempt = 0; ; attempt++) {
    const number = await nextProjectNumber(data.entityId);
    try {
      return await prisma.project.create({ data: { ...data, number } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}
