-- CreateIndex
CREATE INDEX "attachments_requestId_idx" ON "attachments"("requestId");

-- CreateIndex
CREATE INDEX "transactions_paymentRequestId_idx" ON "transactions"("paymentRequestId");
