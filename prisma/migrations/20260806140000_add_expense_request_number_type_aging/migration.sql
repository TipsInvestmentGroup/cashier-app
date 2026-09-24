-- Phase 3: Expense Requests table additions — request number, expense type,
-- stage-entered-at (aging), and the per-outlet continuous number sequence.

-- AlterTable
ALTER TABLE "ExpenseRequest" ADD COLUMN     "requestNumber" TEXT;
ALTER TABLE "ExpenseRequest" ADD COLUMN     "expenseType" TEXT;
ALTER TABLE "ExpenseRequest" ADD COLUMN     "stageEnteredAt" TIMESTAMP(3);

-- Backfill so existing rows have a sensible aging origin (time-in-current-stage
-- starts from when the row was created, the only status timestamp we have).
UPDATE "ExpenseRequest" SET "stageEnteredAt" = "createdAt" WHERE "stageEnteredAt" IS NULL;

-- CreateTable
CREATE TABLE "ExpenseRequestSequence" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseRequestSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRequest_requestNumber_key" ON "ExpenseRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ExpenseRequest_expenseType_idx" ON "ExpenseRequest"("expenseType");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRequestSequence_scopeKey_key" ON "ExpenseRequestSequence"("scopeKey");
