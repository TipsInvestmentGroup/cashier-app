-- Expense Settings: add `archived` to the three admin-defined config tables.
-- Archived = permanently retired but kept for historical integrity (past
-- requests/payments still reference the row). Distinct from isActive, which is a
-- reversible deactivation. Archived rows are hidden from every live list and
-- selector and can never be reactivated.

-- AlterTable
ALTER TABLE "RequestType" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FundingSource" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
