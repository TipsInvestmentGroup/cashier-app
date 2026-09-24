-- Custodian Report Phase B2 — cross-custodian top-up reconciliation.
-- Link a BankTransaction to the ExpenseRequest it settles. Set only on a Petty
-- Cash top-up's paying leg (a TRANSFER out of a digital account, posted by the
-- execute-topup route), so lib/custodian-report.ts can pair that transfer with
-- the same request's Petty Cash REPLENISH FundingSourceTxn (which already
-- carries the request id in expensePaymentId). Loose ref, no FK — mirrors
-- FundingSourceTxn.expensePaymentId / CreditAccount.userId.

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "expenseRequestId" TEXT;

-- CreateIndex
CREATE INDEX "BankTransaction_expenseRequestId_idx" ON "BankTransaction"("expenseRequestId");
