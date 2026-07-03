-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('URGENT', 'MEDIUM', 'NOT_URGENT');

-- CreateEnum
CREATE TYPE "PaymentTiming" AS ENUM ('PREPAY', 'POSTPAY');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('CONTRACT', 'INVOICE', 'ACT', 'RESIDENCY_CERT', 'OTHER');

-- CreateEnum
CREATE TYPE "BloggerDeliverable" AS ENUM ('STORY', 'STORY_SERIES', 'VIDEO_POST', 'PHOTO_POST', 'TIKTOK', 'YOUTUBE', 'OTHER');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "expense_types" DROP COLUMN "defaultPriority",
ADD COLUMN     "defaultUrgency" "Urgency" NOT NULL DEFAULT 'NOT_URGENT';

-- AlterTable
ALTER TABLE "payment_requests" DROP COLUMN "priority",
ADD COLUMN     "contractAmount" BIGINT,
ADD COLUMN     "deliverables" "BloggerDeliverable"[],
ADD COLUMN     "paymentPercent" INTEGER,
ADD COLUMN     "paymentTiming" "PaymentTiming",
ADD COLUMN     "serviceRendered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "urgency" "Urgency" NOT NULL DEFAULT 'NOT_URGENT',
ALTER COLUMN "purpose" DROP NOT NULL;

-- DropEnum
DROP TYPE "Priority";
