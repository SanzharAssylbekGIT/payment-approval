-- AlterEnum
ALTER TYPE "BloggerDeliverable" ADD VALUE 'REELS';

-- AlterEnum
ALTER TYPE "RoleName" ADD VALUE 'PROJECT_MANAGER';

-- AlterTable
ALTER TABLE "estimate_lines" ADD COLUMN     "baseFee" BIGINT,
ADD COLUMN     "customDeliverable" TEXT,
ADD COLUMN     "deliverables" "BloggerDeliverable"[];

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "completionDate" TIMESTAMP(3),
ADD COLUMN     "projectManagerId" TEXT,
ADD COLUMN     "realizationDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "recipients" ADD COLUMN     "bloggerId" TEXT;

-- CreateTable
CREATE TABLE "bloggers" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bloggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blogger_prices" (
    "id" TEXT NOT NULL,
    "bloggerId" TEXT NOT NULL,
    "kind" "BloggerDeliverable" NOT NULL,
    "price" BIGINT NOT NULL,

    CONSTRAINT "blogger_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bloggers_entityId_name_key" ON "bloggers"("entityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "blogger_prices_bloggerId_kind_key" ON "blogger_prices"("bloggerId", "kind");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloggers" ADD CONSTRAINT "bloggers_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blogger_prices" ADD CONSTRAINT "blogger_prices_bloggerId_fkey" FOREIGN KEY ("bloggerId") REFERENCES "bloggers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_bloggerId_fkey" FOREIGN KEY ("bloggerId") REFERENCES "bloggers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

