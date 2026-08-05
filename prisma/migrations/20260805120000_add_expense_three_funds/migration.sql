-- AlterTable
ALTER TABLE "FundingSource" ADD COLUMN     "approvalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "escalationHours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lowBalanceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ExpenseRequest" ADD COLUMN     "allocatedAmount" DOUBLE PRECISION,
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'OUT',
ADD COLUMN     "fundingSourceId" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "ExpenseAccessGrant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantType" TEXT NOT NULL,
    "fundClass" TEXT,
    "outletId" TEXT,
    "grantedById" TEXT NOT NULL,
    "grantedByName" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "note" TEXT,

    CONSTRAINT "ExpenseAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseNotificationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "fundClass" TEXT,
    "kind" TEXT NOT NULL,
    "channels" TEXT NOT NULL DEFAULT '["IN_APP","EMAIL"]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseNotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseAccessGrant_companyId_grantType_fundClass_revokedAt_idx" ON "ExpenseAccessGrant"("companyId", "grantType", "fundClass", "revokedAt");

-- CreateIndex
CREATE INDEX "ExpenseAccessGrant_userId_revokedAt_idx" ON "ExpenseAccessGrant"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAccessGrant_companyId_userId_grantType_fundClass_out_key" ON "ExpenseAccessGrant"("companyId", "userId", "grantType", "fundClass", "outletId", "revokedAt");

-- CreateIndex
CREATE INDEX "ExpenseNotificationRule_companyId_event_isActive_idx" ON "ExpenseNotificationRule"("companyId", "event", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseNotificationRule_companyId_event_recipientRole_fundC_key" ON "ExpenseNotificationRule"("companyId", "event", "recipientRole", "fundClass");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_event_channel_key" ON "NotificationPreference"("userId", "event", "channel");

-- CreateIndex
CREATE INDEX "ExpenseRequest_fundingSourceId_direction_status_idx" ON "ExpenseRequest"("fundingSourceId", "direction", "status");

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAccessGrant" ADD CONSTRAINT "ExpenseAccessGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseNotificationRule" ADD CONSTRAINT "ExpenseNotificationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

