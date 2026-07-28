-- CreateTable
CREATE TABLE "FundingSourceTxn" (
    "id" TEXT NOT NULL,
    "fundingSourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "expensePaymentId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingSourceTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingSourceCustodian" (
    "id" TEXT NOT NULL,
    "fundingSourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingSourceCustodian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestTypeField" (
    "id" TEXT NOT NULL,
    "requestTypeId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestTypeField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseRequestFieldValue" (
    "id" TEXT NOT NULL,
    "expenseRequestId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ExpenseRequestFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingSourceTxn_fundingSourceId_createdAt_idx" ON "FundingSourceTxn"("fundingSourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundingSourceCustodian_fundingSourceId_userId_key" ON "FundingSourceCustodian"("fundingSourceId", "userId");

-- CreateIndex
CREATE INDEX "RequestTypeField_requestTypeId_isActive_idx" ON "RequestTypeField"("requestTypeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RequestTypeField_requestTypeId_fieldKey_key" ON "RequestTypeField"("requestTypeId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRequestFieldValue_expenseRequestId_fieldKey_key" ON "ExpenseRequestFieldValue"("expenseRequestId", "fieldKey");

-- AddForeignKey
ALTER TABLE "FundingSourceTxn" ADD CONSTRAINT "FundingSourceTxn_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingSourceCustodian" ADD CONSTRAINT "FundingSourceCustodian_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestTypeField" ADD CONSTRAINT "RequestTypeField_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "RequestType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequestFieldValue" ADD CONSTRAINT "ExpenseRequestFieldValue_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

