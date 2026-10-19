-- 3f CONTRACT: drop the old database-wide unique keys on document numbers and numbering counters; the per-company
-- ("companyId", ...) keys added by 20261016100000_document_numbers_per_company_expand stay. After this a second company
-- has fully independent sequences (its own JE-000001, PO-000001, ORD-YYYYMMDD-001, bill references, ...).
-- CashReconExcess / CollectionExcess have no company column: their own unique keys become plain indexes, and per-company
-- uniqueness of their references is enforced by BillReferenceRegistry, written in the same transaction as the bill.
-- Event booking numbers (TicketBooking/TableBooking.bookingNumber) deliberately stay globally unique (public lookup).
-- Deploy ONLY after the expand migration + code are live. Rollback: recreate these indexes (succeeds only while no two
-- companies share a number).
-- DropIndex
DROP INDEX "SignedBill_voucherNumber_key";

-- DropIndex
DROP INDEX "SignedBill_internalBillId_key";

-- DropIndex
DROP INDEX "SignedBill_displayReference_key";

-- DropIndex
DROP INDEX "PaidBill_internalBillId_key";

-- DropIndex
DROP INDEX "PaidBill_displayReference_key";

-- DropIndex
DROP INDEX "PurchaseOrder_poNumber_key";

-- DropIndex
DROP INDEX "Grn_grnNumber_key";

-- DropIndex
DROP INDEX "StockTransfer_transferNumber_key";

-- DropIndex
DROP INDEX "Breakage_internalBillId_key";

-- DropIndex
DROP INDEX "Breakage_displayReference_key";

-- DropIndex
DROP INDEX "CashReconExcess_internalBillId_key";

-- DropIndex
DROP INDEX "CashReconExcess_displayReference_key";

-- DropIndex
DROP INDEX "CollectionExcess_internalBillId_key";

-- DropIndex
DROP INDEX "CollectionExcess_displayReference_key";

-- DropIndex
DROP INDEX "BillSequenceCounter_scopeKey_key";

-- DropIndex
DROP INDEX "BillReferenceRegistry_internalBillId_key";

-- DropIndex
DROP INDEX "BillReferenceRegistry_displayReference_key";

-- DropIndex
DROP INDEX "ExcessRefund_internalBillId_key";

-- DropIndex
DROP INDEX "ExcessRefund_displayReference_key";

-- DropIndex
DROP INDEX "PosOrder_orderNo_key";

-- DropIndex
DROP INDEX "JournalEntry_entryNumber_key";

-- DropIndex
DROP INDEX "SupplierInvoice_invoiceNumber_key";

-- DropIndex
DROP INDEX "SupplierPayment_paymentNumber_key";

-- DropIndex
DROP INDEX "ExpenseRequest_requestNumber_key";

-- DropIndex
DROP INDEX "ExpenseRequestSequence_scopeKey_key";

-- CreateIndex
CREATE INDEX "CashReconExcess_internalBillId_idx" ON "CashReconExcess"("internalBillId");

-- CreateIndex
CREATE INDEX "CashReconExcess_displayReference_idx" ON "CashReconExcess"("displayReference");

-- CreateIndex
CREATE INDEX "CollectionExcess_internalBillId_idx" ON "CollectionExcess"("internalBillId");

-- CreateIndex
CREATE INDEX "CollectionExcess_displayReference_idx" ON "CollectionExcess"("displayReference");
