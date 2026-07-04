-- Карточка клиента: юр. название, форма компании, резидентство, банковские
-- реквизиты (БИН, счёт, банк), КБЕ (считает система).

CREATE TYPE "CompanyForm" AS ENUM ('IP', 'TOO', 'AO', 'CHK');

ALTER TABLE "clients" ADD COLUMN "legalName" TEXT;
ALTER TABLE "clients" ADD COLUMN "companyForm" "CompanyForm";
ALTER TABLE "clients" ADD COLUMN "isForeign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN "bin" TEXT;
ALTER TABLE "clients" ADD COLUMN "bankAccount" TEXT;
ALTER TABLE "clients" ADD COLUMN "bankName" TEXT;
ALTER TABLE "clients" ADD COLUMN "kbe" TEXT;
