-- Продакшн-заявки: один платёж может закрывать несколько позиций сметы —
-- таблица связи «заявка ↔ строки сметы».

CREATE TABLE "payment_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "estimateLineId" TEXT NOT NULL,

    CONSTRAINT "payment_request_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_request_lines_requestId_estimateLineId_key" ON "payment_request_lines"("requestId", "estimateLineId");
CREATE INDEX "payment_request_lines_estimateLineId_idx" ON "payment_request_lines"("estimateLineId");

ALTER TABLE "payment_request_lines" ADD CONSTRAINT "payment_request_lines_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_request_lines" ADD CONSTRAINT "payment_request_lines_estimateLineId_fkey"
    FOREIGN KEY ("estimateLineId") REFERENCES "estimate_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
