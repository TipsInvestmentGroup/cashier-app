-- Transaction Ledger — Phases 0 & 1.
-- StaffTransaction becomes the single source of truth for a collection's
-- money (see lib/collection-ledger.ts). All changes are additive or relax a
-- NOT NULL; existing rows keep their values and today's behavior.

-- AlterTable: ledger rows no longer need a session/staff user (Default-mode
-- collections have neither); denormalized outlet/date/staff + lock metadata.
ALTER TABLE "StaffTransaction" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "StaffTransaction" ALTER COLUMN "staffId" DROP NOT NULL;
ALTER TABLE "StaffTransaction" ADD COLUMN "staffName" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN "outletId" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "StaffTransaction" ADD COLUMN "collectionId" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'STAFF_DECLARED';
ALTER TABLE "StaffTransaction" ADD COLUMN "referenceKey" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffTransaction" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "StaffTransaction" ADD COLUMN "originalSnapshot" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN "isAmended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DailyCollection" ADD COLUMN "ledgerBacked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PaymentChannel" ADD COLUMN "captureMode" TEXT NOT NULL DEFAULT 'TOTAL';
ALTER TABLE "PaymentChannel" ADD COLUMN "requiresReference" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN "itemisedCollectionsFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BusinessDay" ADD COLUMN "collectionMode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StaffTransaction_referenceKey_key" ON "StaffTransaction"("referenceKey");
CREATE INDEX "StaffTransaction_collectionId_idx" ON "StaffTransaction"("collectionId");
CREATE INDEX "StaffTransaction_outletId_date_idx" ON "StaffTransaction"("outletId", "date");

-- AddForeignKey
ALTER TABLE "StaffTransaction" ADD CONSTRAINT "StaffTransaction_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DailyCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
