-- Multi-company programme, Phase 3 step 3f (EXPAND) - per-company document numbering.
-- ADDS 21 unique indexes that include "companyId":
--   counters   ("companyId","scopeKey") on BillSequenceCounter and ExpenseRequestSequence - each company gets its own
--              sequences (journal entries, supplier invoices/payments, PO/GRN/transfers, POS orders, bill references,
--              person codes, expense requests);
--   documents  ("companyId", number) on JournalEntry.entryNumber, SupplierInvoice.invoiceNumber, SupplierPayment.paymentNumber,
--              PurchaseOrder.poNumber, Grn.grnNumber, StockTransfer.transferNumber, PosOrder.orderNo,
--              ExpenseRequest.requestNumber, and internalBillId/displayReference on SignedBill (+ voucherNumber), PaidBill,
--              Breakage, ExcessRefund and BillReferenceRegistry.
-- The OLD database-wide unique indexes are deliberately KEPT here (same expand -> contract pattern as 3e): running code
-- never depends on an index that no longer exists. They are dropped by the separate CONTRACT migration in a later deploy.
-- Safe on existing data: every new key is strictly weaker than the old global one (all existing rows already satisfy
-- it), and NULL company values are distinct, so not-yet-assigned rows can never conflict. No data is changed: the
-- original company keeps its existing counter rows, so its numbering continues exactly where it is.
-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_companyId_internalBillId_key" ON "SignedBill"("companyId", "internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_companyId_displayReference_key" ON "SignedBill"("companyId", "displayReference");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_companyId_voucherNumber_key" ON "SignedBill"("companyId", "voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaidBill_companyId_internalBillId_key" ON "PaidBill"("companyId", "internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "PaidBill_companyId_displayReference_key" ON "PaidBill"("companyId", "displayReference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_poNumber_key" ON "PurchaseOrder"("companyId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_companyId_grnNumber_key" ON "Grn"("companyId", "grnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_companyId_transferNumber_key" ON "StockTransfer"("companyId", "transferNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Breakage_companyId_internalBillId_key" ON "Breakage"("companyId", "internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "Breakage_companyId_displayReference_key" ON "Breakage"("companyId", "displayReference");

-- CreateIndex
CREATE UNIQUE INDEX "BillSequenceCounter_companyId_scopeKey_key" ON "BillSequenceCounter"("companyId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillReferenceRegistry_companyId_internalBillId_key" ON "BillReferenceRegistry"("companyId", "internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "BillReferenceRegistry_companyId_displayReference_key" ON "BillReferenceRegistry"("companyId", "displayReference");

-- CreateIndex
CREATE UNIQUE INDEX "ExcessRefund_companyId_internalBillId_key" ON "ExcessRefund"("companyId", "internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "ExcessRefund_companyId_displayReference_key" ON "ExcessRefund"("companyId", "displayReference");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_companyId_orderNo_key" ON "PosOrder"("companyId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_entryNumber_key" ON "JournalEntry"("companyId", "entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_companyId_invoiceNumber_key" ON "SupplierInvoice"("companyId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_companyId_paymentNumber_key" ON "SupplierPayment"("companyId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRequest_companyId_requestNumber_key" ON "ExpenseRequest"("companyId", "requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRequestSequence_companyId_scopeKey_key" ON "ExpenseRequestSequence"("companyId", "scopeKey");
