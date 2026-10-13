-- Multi-company programme, Phase 3 (EXPAND) — company column on every tenant-owned table.
-- PURELY ADDITIVE: a nullable "companyId" TEXT column and an index on each of the 60 tenant-root tables
-- (see lib/tenancy-registry.ts). No existing value is changed, no constraint is added or tightened.
-- ADD COLUMN without a default is metadata-only in Postgres (instant, no table rewrite); the indexes are
-- ordinary CREATE INDEX (a short write lock per table; tables are small relative to this).
-- The columns are filled idempotently by backfillTenantRoots() in lib/tenant-backfill.ts (run by the deploy
-- seed); new rows are stamped on write by the Prisma guard (lib/tenant-stamp.ts). The NOT NULL / foreign-key /
-- unique-key "contract" step is deliberately NOT here - see docs/MULTI-TENANT-PHASE3.md.
-- AlterTable
ALTER TABLE "UserPermission" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "SalesMetric" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "SalesTarget" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "SalesMetricLock" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PriceChangeLog" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "DayClosure" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "BusinessDay" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "RolePermission" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "DailyCollection" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "CollectionSession" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "TransactionSession" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "StaffTransaction" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "SignedBill" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PaidBill" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PettyCash" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PettyFund" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PettyFunction" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "ProductCategory" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "StockLevel" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "StockLedgerEntry" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "StockCountSession" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Breakage" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Cancellation" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "CashRecon" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "BankRecon" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PersonCategory" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PaymentChannel" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "CancellationReason" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "ExcessReason" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "BillReferenceConfig" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "BillTypeConfig" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "BillSequenceCounter" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "BillReferenceRegistry" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "ExcessRefund" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "ExcessSettlement" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosTable" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosShift" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosCounter" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosOrder" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosStockRequest" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosProductExtra" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "PosBlockedItem" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "ScheduleAssignment" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "OutletScheduleConfig" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "SignedBillWriteOff" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "AccountReconciliation" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseRequestSequence" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "UserPermission_companyId_idx" ON "UserPermission"("companyId");

-- CreateIndex
CREATE INDEX "SalesMetric_companyId_idx" ON "SalesMetric"("companyId");

-- CreateIndex
CREATE INDEX "SalesTarget_companyId_idx" ON "SalesTarget"("companyId");

-- CreateIndex
CREATE INDEX "SalesMetricLock_companyId_idx" ON "SalesMetricLock"("companyId");

-- CreateIndex
CREATE INDEX "PriceChangeLog_companyId_idx" ON "PriceChangeLog"("companyId");

-- CreateIndex
CREATE INDEX "DailyReport_companyId_idx" ON "DailyReport"("companyId");

-- CreateIndex
CREATE INDEX "DayClosure_companyId_idx" ON "DayClosure"("companyId");

-- CreateIndex
CREATE INDEX "BusinessDay_companyId_idx" ON "BusinessDay"("companyId");

-- CreateIndex
CREATE INDEX "RolePermission_companyId_idx" ON "RolePermission"("companyId");

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");

-- CreateIndex
CREATE INDEX "DailyCollection_companyId_idx" ON "DailyCollection"("companyId");

-- CreateIndex
CREATE INDEX "CollectionSession_companyId_idx" ON "CollectionSession"("companyId");

-- CreateIndex
CREATE INDEX "TransactionSession_companyId_idx" ON "TransactionSession"("companyId");

-- CreateIndex
CREATE INDEX "StaffTransaction_companyId_idx" ON "StaffTransaction"("companyId");

-- CreateIndex
CREATE INDEX "Person_companyId_idx" ON "Person"("companyId");

-- CreateIndex
CREATE INDEX "SignedBill_companyId_idx" ON "SignedBill"("companyId");

-- CreateIndex
CREATE INDEX "PaidBill_companyId_idx" ON "PaidBill"("companyId");

-- CreateIndex
CREATE INDEX "PettyCash_companyId_idx" ON "PettyCash"("companyId");

-- CreateIndex
CREATE INDEX "PettyFund_companyId_idx" ON "PettyFund"("companyId");

-- CreateIndex
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

-- CreateIndex
CREATE INDEX "PettyFunction_companyId_idx" ON "PettyFunction"("companyId");

-- CreateIndex
CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");

-- CreateIndex
CREATE INDEX "ProductCategory_companyId_idx" ON "ProductCategory"("companyId");

-- CreateIndex
CREATE INDEX "Warehouse_companyId_idx" ON "Warehouse"("companyId");

-- CreateIndex
CREATE INDEX "StockLevel_companyId_idx" ON "StockLevel"("companyId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_companyId_idx" ON "StockLedgerEntry"("companyId");

-- CreateIndex
CREATE INDEX "Supplier_companyId_idx" ON "Supplier"("companyId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_idx" ON "PurchaseOrder"("companyId");

-- CreateIndex
CREATE INDEX "StockTransfer_companyId_idx" ON "StockTransfer"("companyId");

-- CreateIndex
CREATE INDEX "StockCountSession_companyId_idx" ON "StockCountSession"("companyId");

-- CreateIndex
CREATE INDEX "Breakage_companyId_idx" ON "Breakage"("companyId");

-- CreateIndex
CREATE INDEX "Cancellation_companyId_idx" ON "Cancellation"("companyId");

-- CreateIndex
CREATE INDEX "CashRecon_companyId_idx" ON "CashRecon"("companyId");

-- CreateIndex
CREATE INDEX "BankRecon_companyId_idx" ON "BankRecon"("companyId");

-- CreateIndex
CREATE INDEX "PersonCategory_companyId_idx" ON "PersonCategory"("companyId");

-- CreateIndex
CREATE INDEX "PaymentChannel_companyId_idx" ON "PaymentChannel"("companyId");

-- CreateIndex
CREATE INDEX "CancellationReason_companyId_idx" ON "CancellationReason"("companyId");

-- CreateIndex
CREATE INDEX "ExcessReason_companyId_idx" ON "ExcessReason"("companyId");

-- CreateIndex
CREATE INDEX "BillReferenceConfig_companyId_idx" ON "BillReferenceConfig"("companyId");

-- CreateIndex
CREATE INDEX "BillTypeConfig_companyId_idx" ON "BillTypeConfig"("companyId");

-- CreateIndex
CREATE INDEX "BillSequenceCounter_companyId_idx" ON "BillSequenceCounter"("companyId");

-- CreateIndex
CREATE INDEX "BillReferenceRegistry_companyId_idx" ON "BillReferenceRegistry"("companyId");

-- CreateIndex
CREATE INDEX "ExcessRefund_companyId_idx" ON "ExcessRefund"("companyId");

-- CreateIndex
CREATE INDEX "ExcessSettlement_companyId_idx" ON "ExcessSettlement"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "PosTable_companyId_idx" ON "PosTable"("companyId");

-- CreateIndex
CREATE INDEX "PosShift_companyId_idx" ON "PosShift"("companyId");

-- CreateIndex
CREATE INDEX "PosCounter_companyId_idx" ON "PosCounter"("companyId");

-- CreateIndex
CREATE INDEX "PosOrder_companyId_idx" ON "PosOrder"("companyId");

-- CreateIndex
CREATE INDEX "PosStockRequest_companyId_idx" ON "PosStockRequest"("companyId");

-- CreateIndex
CREATE INDEX "PosProductExtra_companyId_idx" ON "PosProductExtra"("companyId");

-- CreateIndex
CREATE INDEX "PosBlockedItem_companyId_idx" ON "PosBlockedItem"("companyId");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_companyId_idx" ON "ScheduleAssignment"("companyId");

-- CreateIndex
CREATE INDEX "OutletScheduleConfig_companyId_idx" ON "OutletScheduleConfig"("companyId");

-- CreateIndex
CREATE INDEX "Event_companyId_idx" ON "Event"("companyId");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_idx" ON "JournalLine"("companyId");

-- CreateIndex
CREATE INDEX "SignedBillWriteOff_companyId_idx" ON "SignedBillWriteOff"("companyId");

-- CreateIndex
CREATE INDEX "AccountReconciliation_companyId_idx" ON "AccountReconciliation"("companyId");

-- CreateIndex
CREATE INDEX "ExpenseRequestSequence_companyId_idx" ON "ExpenseRequestSequence"("companyId");

-- CreateIndex
CREATE INDEX "Attachment_companyId_idx" ON "Attachment"("companyId");

