-- Digital Reconciliation field redesign: per digital channel, the cashier now
-- tallies the two components by hand (paid bills settled + sales collections),
-- reconciled against the system-computed reportedAmount. The officer verifies
-- the same two components. Total Collection is derived, not persisted.
--
-- The legacy openingBalance/closingBalance/verifiedOpening/verifiedClosing
-- columns are intentionally KEPT (not dropped) so historical records remain
-- readable; they are simply no longer written or rendered.

-- AlterTable
ALTER TABLE "BankRecon" ADD COLUMN     "paidBills" DOUBLE PRECISION;
ALTER TABLE "BankRecon" ADD COLUMN     "salesCollection" DOUBLE PRECISION;
ALTER TABLE "BankRecon" ADD COLUMN     "verifiedPaidBills" DOUBLE PRECISION;
ALTER TABLE "BankRecon" ADD COLUMN     "verifiedSalesCollection" DOUBLE PRECISION;
