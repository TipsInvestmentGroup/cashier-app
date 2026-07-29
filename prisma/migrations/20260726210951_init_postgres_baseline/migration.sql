-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "outletId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "pin" TEXT,
    "position" TEXT,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "isCasual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "canAdd" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canSettle" BOOLEAN NOT NULL DEFAULT false,
    "canUnsettle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "tin" TEXT,
    "vrn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT,
    "defaultTemplateId" TEXT,
    "isEventsOnly" BOOLEAN NOT NULL DEFAULT false,
    "legalName" TEXT,
    "tin" TEXT,
    "vrn" TEXT,
    "branchCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMetric" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "outletId" TEXT,
    "department" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'TZS',
    "unitLabel" TEXT,
    "weeklyTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMetricLock" (
    "id" TEXT NOT NULL,
    "outletId" TEXT,
    "department" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesMetricLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "outletId" TEXT,
    "eventId" TEXT,
    "customerGroupId" TEXT,
    "fileName" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "totalQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unmatchedStaff" INTEGER NOT NULL DEFAULT 0,
    "unmatchedProducts" INTEGER NOT NULL DEFAULT 0,
    "priceExceptions" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImportLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "outletId" TEXT,
    "rawStaffName" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "staffMatched" BOOLEAN NOT NULL DEFAULT false,
    "rawProductName" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productMatched" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPriceUploaded" DOUBLE PRECISION,
    "unitPriceMaster" DOUBLE PRECISION,
    "priceListId" TEXT,
    "priceMismatch" BOOLEAN NOT NULL DEFAULT false,
    "issues" TEXT,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "supersededByImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesImportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesStaffAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "alias" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "personId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesStaffAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesProductAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "alias" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "outletId" TEXT,
    "eventId" TEXT,
    "customerGroupId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellingPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChangeLog" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "priceListName" TEXT,
    "productId" TEXT NOT NULL,
    "productName" TEXT,
    "oldPrice" DOUBLE PRECISION,
    "newPrice" DOUBLE PRECISION NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'UPDATE',
    "changedById" TEXT,
    "changedByName" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outletId" TEXT,
    "eventId" TEXT,
    "customerGroupId" TEXT,
    "productId" TEXT,
    "categoryId" TEXT,
    "buyQty" DOUBLE PRECISION,
    "getQty" DOUBLE PRECISION,
    "bundleConfig" TEXT,
    "bundlePrice" DOUBLE PRECISION,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" TEXT,
    "notes" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "savedById" TEXT,
    "savedByName" TEXT,
    "finalizedById" TEXT,
    "finalizedByName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayClosure" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "closedBy" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDay" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isComplete" BOOLEAN NOT NULL DEFAULT true,
    "missingItems" TEXT,
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenedByName" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDayUnlockRequest" (
    "id" TEXT NOT NULL,
    "businessDayId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scopeShift" TEXT,
    "scopeCounter" TEXT,
    "requestedDuration" TEXT,
    "requestedMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "approverComment" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDayUnlockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDayAuditLog" (
    "id" TEXT NOT NULL,
    "businessDayId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessDayAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDayPolicyConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "blockCloseOnMissing" BOOLEAN NOT NULL DEFAULT true,
    "approverRoles" TEXT,
    "defaultUnlockMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDayPolicyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCollection" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crdb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stanbic" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mpesa" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "staffName" TEXT,
    "systemSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentsReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "notes" TEXT,
    "outletId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCollectionChannel" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCollectionChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionStage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "entryMode" TEXT NOT NULL DEFAULT 'SINGLE_STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSection" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionField" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT,

    CONSTRAINT "CollectionField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionValidationRule" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "config" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outletId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionStageRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "staffId" TEXT,
    "staffName" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionStageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionFieldValue" (
    "id" TEXT NOT NULL,
    "stageRecordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "CollectionFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowApproval" (
    "id" TEXT NOT NULL,
    "stageRecordId" TEXT,
    "transactionId" TEXT,
    "expenseRequestId" TEXT,
    "requestedById" TEXT NOT NULL,
    "approverRole" TEXT,
    "approverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionModeConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionModeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCalendarConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "templateName" TEXT NOT NULL DEFAULT 'CUSTOM',
    "businessDayStartTime" TEXT NOT NULL DEFAULT '05:00',
    "businessDayEndTime" TEXT NOT NULL DEFAULT '05:00',
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
    "weekStartDay" INTEGER NOT NULL DEFAULT 1,
    "fyStartMonth" INTEGER NOT NULL DEFAULT 1,
    "fyStartDay" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCalendarConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCalendarOverride" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "businessDayStartTime" TEXT,
    "businessDayEndTime" TEXT,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessCalendarOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCalendarAuditLog" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessCalendarAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPeriodVersion" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "presetName" TEXT NOT NULL DEFAULT 'CUSTOM',
    "businessMonthStartDay" INTEGER NOT NULL DEFAULT 1,
    "financialMonthStartDay" INTEGER NOT NULL DEFAULT 1,
    "payrollStartDay" INTEGER NOT NULL DEFAULT 1,
    "payrollProcessingDay" INTEGER NOT NULL DEFAULT 1,
    "payrollPaymentDay" INTEGER NOT NULL DEFAULT 1,
    "payrollLockDay" INTEGER NOT NULL DEFAULT 1,
    "creditStartDay" INTEGER NOT NULL DEFAULT 1,
    "creditResetDay" INTEGER NOT NULL DEFAULT 1,
    "creditGraceDays" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessPeriodVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSalesRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "staffId" TEXT,
    "staffName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSalesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTransaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'PAYMENT',
    "paymentMethod" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "receivingAccount" TEXT,
    "reference" TEXT,
    "personName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DECLARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "outletId" TEXT NOT NULL,
    "staffId" TEXT,
    "staffName" TEXT NOT NULL,
    "collectionMode" TEXT NOT NULL,
    "sourceCollectionId" TEXT,
    "sourceSessionId" TEXT,
    "systemSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "officialCollection" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mobileMoney" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signedBillsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidBillsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discounts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cancellations" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collectionDifference" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "customerCount" INTEGER,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "avgTransactionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salesTarget" DOUBLE PRECISION,
    "validationTime" TIMESTAMP(3),
    "approvalTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT,
    "codeMode" TEXT NOT NULL DEFAULT 'AUTO',
    "customerGroupId" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignedBill" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voucherNumber" TEXT,
    "autoKey" TEXT,
    "billType" TEXT NOT NULL,
    "personId" TEXT,
    "personName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "serviceStaff" TEXT,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "outletId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "internalBillId" TEXT,
    "displayReference" TEXT,
    "legacyReference" TEXT,
    "billTypeConfigId" TEXT,
    "autoSourceCollectionId" TEXT,
    "creditGroupId" TEXT,
    "creditAccountId" TEXT,

    CONSTRAINT "SignedBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillItem" (
    "id" TEXT NOT NULL,
    "signedBillId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidBill" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billRef" TEXT,
    "signedBillId" TEXT,
    "personId" TEXT,
    "payerCategory" TEXT,
    "payerName" TEXT NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "notes" TEXT,
    "outletId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalEntryId" TEXT,
    "internalBillId" TEXT,
    "displayReference" TEXT,
    "legacyReference" TEXT,
    "billTypeConfigId" TEXT,

    CONSTRAINT "PaidBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCash" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT NOT NULL,
    "department" TEXT,
    "functionName" TEXT,
    "purpose" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL,
    "payeeName" TEXT,
    "payeeAccount" TEXT,
    "paymentStatus" TEXT DEFAULT 'UNPAID',
    "approvedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outletId" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pettyType" TEXT NOT NULL DEFAULT 'CASHIER',
    "fundId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidByName" TEXT,
    "receiptUrl" TEXT,
    "expenseRequestId" TEXT,

    CONSTRAINT "PettyCash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyFund" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "outletId" TEXT,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyFundTxn" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "pettyCashId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyFundTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashItem" (
    "id" TEXT NOT NULL,
    "pettyCashId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "unit" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyFunction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyFunction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "categoryId" TEXT,
    "buyingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitMeasure" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trackingMode" TEXT NOT NULL DEFAULT 'UNIT',
    "gramsPerServing" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outletId" TEXT,
    "counterCode" TEXT,
    "warehouseId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "outletId" TEXT,
    "counterCode" TEXT,
    "warehouseId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "paymentTerms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "outletIds" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.18,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "purchaseUnit" TEXT NOT NULL,
    "packSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "quantityReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grn" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "supplierName" TEXT NOT NULL,
    "invoiceRef" TEXT,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    "needsCosting" BOOLEAN NOT NULL DEFAULT false,
    "journalEntryId" TEXT,

    CONSTRAINT "Grn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "purchaseUnit" TEXT NOT NULL,
    "packSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quantityOrdered" DOUBLE PRECISION NOT NULL,
    "piecesReceived" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "counterCode" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountSession" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'COUNTER_DAILY',
    "outletId" TEXT,
    "counterCode" TEXT,
    "warehouseId" TEXT,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "conductedById" TEXT NOT NULL,
    "totalLossValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL,
    "receivings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transfersIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transfersOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closingSystem" DOUBLE PRECISION NOT NULL,
    "closingPhysical" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posSalesQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedSalesQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "varianceQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "varianceValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakageQty" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLossAttribution" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLossAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breakage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "outletId" TEXT,
    "counterCode" TEXT,
    "warehouseId" TEXT,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "valueLost" DOUBLE PRECISION NOT NULL,
    "photoUrl" TEXT,
    "note" TEXT,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "internalBillId" TEXT,
    "displayReference" TEXT,
    "billTypeConfigId" TEXT,

    CONSTRAINT "Breakage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectionId" TEXT,
    "reason" TEXT NOT NULL,
    "staffName" TEXT,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "sellingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "outletId" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRecon" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outletId" TEXT,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashDeposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excessAmountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verifiedAmount" DOUBLE PRECISION,
    "verifiedBy" TEXT,
    "variance" DOUBLE PRECISION,
    "varianceClass" TEXT,
    "notes" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashRecon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReconExcess" (
    "id" TEXT NOT NULL,
    "cashReconId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'NON_PAYABLE',
    "accountingClass" TEXT,
    "notes" TEXT,
    "channelCode" TEXT,
    "staffId" TEXT,
    "staffName" TEXT,
    "personId" TEXT,
    "personName" TEXT,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "settledAsSourceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "internalBillId" TEXT,
    "displayReference" TEXT,
    "billTypeConfigId" TEXT,

    CONSTRAINT "CashReconExcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionExcess" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'NON_PAYABLE',
    "accountingClass" TEXT,
    "notes" TEXT,
    "channelCode" TEXT,
    "staffId" TEXT,
    "staffName" TEXT,
    "personId" TEXT,
    "personName" TEXT,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "internalBillId" TEXT,
    "displayReference" TEXT,
    "billTypeConfigId" TEXT,

    CONSTRAINT "CollectionExcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankRecon" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outletId" TEXT,
    "channel" TEXT,
    "reportedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openingBalance" DOUBLE PRECISION,
    "closingBalance" DOUBLE PRECISION,
    "verifiedAmount" DOUBLE PRECISION,
    "verifiedOpening" DOUBLE PRECISION,
    "verifiedClosing" DOUBLE PRECISION,
    "reason" TEXT,
    "reportedBy" TEXT,
    "verifiedBy" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankRecon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PersonCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentChannel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "glAccountId" TEXT,

    CONSTRAINT "PaymentChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationReasonCategory" (
    "id" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CancellationReasonCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationReasonProduct" (
    "id" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "CancellationReasonProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcessReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'NON_PAYABLE',
    "accountingClass" TEXT,
    "allocationStrategy" TEXT NOT NULL DEFAULT 'FIFO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcessReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillReferenceConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "dateFormat" TEXT NOT NULL DEFAULT 'YYMMDD',
    "customDateFormat" TEXT,
    "separator" TEXT NOT NULL DEFAULT '-',
    "numberPadding" INTEGER NOT NULL DEFAULT 3,
    "personNumberingMode" TEXT NOT NULL DEFAULT 'AUTO',
    "sequenceResetRule" TEXT NOT NULL DEFAULT 'NEVER',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillReferenceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillReferenceComponent" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "staticValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillReferenceComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillTypeConfig" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "legacyBillTypeCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillTypeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillSequenceCounter" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillSequenceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillReferenceRegistry" (
    "id" TEXT NOT NULL,
    "internalBillId" TEXT NOT NULL,
    "displayReference" TEXT NOT NULL,
    "sourceModel" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "billTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillReferenceRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcessRefund" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "internalBillId" TEXT NOT NULL,
    "displayReference" TEXT NOT NULL,
    "billTypeConfigId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "personId" TEXT,
    "personName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "refundedById" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcessRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcessSettlement" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'AUTO_FIFO',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "outletId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcessSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTable" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openedBy" TEXT NOT NULL,
    "closedBy" TEXT,

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCounter" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "printerName" TEXT,
    "serviceModel" TEXT NOT NULL DEFAULT 'PREP',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "tableId" TEXT,
    "eventId" TEXT,
    "shiftId" TEXT NOT NULL,
    "waiterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "billType" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "signedBillId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "voidReason" TEXT,
    "notes" TEXT,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "amount" DOUBLE PRECISION NOT NULL,
    "extras" TEXT,
    "counterCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "preparedBy" TEXT,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosStockRequest" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "fromCounter" TEXT NOT NULL,
    "toCounter" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "fulfilledById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosStockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPrintLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "counterCode" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedBy" TEXT NOT NULL,
    "items" TEXT NOT NULL,

    CONSTRAINT "PosPrintLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosWaiterSession" (
    "id" TEXT NOT NULL,
    "waiterId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "signedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedOutAt" TIMESTAMP(3),

    CONSTRAINT "PosWaiterSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosProductExtra" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosProductExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosBlockedItem" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "blockedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosBlockedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleAssignment" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "shiftType" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WAITER',
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUnavailability" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "shiftType" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletScheduleConfig" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "morningWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "eveningWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.6,
    "weekendMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.4,
    "daysOffPerWeek" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventType" TEXT,
    "clientName" TEXT,
    "location" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "expectedGuests" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "salesTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "outletId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventStaff" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WAITER',
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "salesAttributed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "performanceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventExpense" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplier" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSponsor" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sponsorName" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sponsorshipType" TEXT NOT NULL DEFAULT 'CASH',
    "sponsorshipValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "itemsProvided" TEXT,
    "agreementStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventProduct" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "eventPrice" DOUBLE PRECISION,
    "expectedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "procurementQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockAllocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockReturned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantitySold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTarget" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTicketType" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityAvailable" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketBooking" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "bookingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTable" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tableType" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableBooking" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specialRequests" TEXT,
    "bookingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "isSystemAccount" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "periodType" TEXT NOT NULL DEFAULT 'MONTHLY',
    "parentPeriodId" TEXT,
    "reopenReason" TEXT,

    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "outletId" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAccountMapping" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "key" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "grnId" TEXT,
    "supplierInvoiceRef" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentChannelId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignedBillWriteOff" (
    "id" TEXT NOT NULL,
    "signedBillId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedBillWriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPaymentAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentChannelId" TEXT NOT NULL,
    "outletId" TEXT,
    "bankName" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "glAccountId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromAccountId" TEXT,
    "toAccountId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outletId" TEXT,
    "departmentId" TEXT,
    "eventId" TEXT,
    "accountId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'MONTHLY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountReconciliation" (
    "id" TEXT NOT NULL,
    "companyPaymentAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "statementBalance" DOUBLE PRECISION NOT NULL,
    "glBalance" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationItem" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchGroupId" TEXT,
    "sourceJournalLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationStage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outletId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "stageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedByName" TEXT,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "gracePeriodEndsAt" TIMESTAMP(3),
    "lastReminderTier" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "escalatedToRoles" TEXT,
    "result" TEXT,
    "resultDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationStageUnlockRequest" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedDuration" TEXT,
    "requestedMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "approverName" TEXT,
    "approverComment" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationStageUnlockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationStageAuditLog" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationStageAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationStageConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "stageKey" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "closeMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "requiredRoles" TEXT,
    "validationStrictness" TEXT NOT NULL DEFAULT 'BLOCK_ON_MISSING',
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "forceAutoClose" BOOLEAN NOT NULL DEFAULT false,
    "escalationRoles" TEXT,
    "notifyChannels" TEXT DEFAULT '["IN_APP"]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationStageConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationReminderPolicy" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "stageKey" TEXT,
    "reminderAnchor" TEXT NOT NULL DEFAULT 'STAGE_OPEN',
    "firstReminderMinutes" INTEGER NOT NULL DEFAULT 30,
    "secondReminderMinutes" INTEGER NOT NULL DEFAULT 120,
    "escalationAtEndOfWindow" BOOLEAN NOT NULL DEFAULT true,
    "generateExceptionReport" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationReminderPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRequirement" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "stageKey" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationCheckResult" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "detail" TEXT,
    "sourceModel" TEXT,
    "sourceId" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVerification" (
    "id" TEXT NOT NULL,
    "outletId" TEXT,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "channel" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "customerName" TEXT,
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "matchedStageId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntegrationConnector" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "config" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntegrationConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteOffRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reconciliationStageId" TEXT,
    "sourceModel" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "channelKey" TEXT NOT NULL DEFAULT 'CASH',
    "outletId" TEXT,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "receivedAmount" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "approverId" TEXT,
    "approverName" TEXT,
    "approverComment" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WriteOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteOffAuditLog" (
    "id" TEXT NOT NULL,
    "writeOffId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteOffAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditModuleConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "moduleName" TEXT NOT NULL DEFAULT 'Signed Bills',
    "terminology" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'TZS',
    "approvalRequiredDefault" BOOLEAN NOT NULL DEFAULT false,
    "allowPartialPayments" BOOLEAN NOT NULL DEFAULT true,
    "allowOverLimit" TEXT NOT NULL DEFAULT 'WARN',
    "requireAttachmentsDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'NONE',
    "parameters" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "legacyBillTypeCode" TEXT,
    "isCreditBearing" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "settlementMethods" TEXT NOT NULL DEFAULT '["CASH","BANK","MOBILE_MONEY"]',
    "defaultSettlementMethod" TEXT NOT NULL DEFAULT 'CASH',
    "maxCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "interestPolicyId" TEXT,
    "penaltyPolicyId" TEXT,
    "limitPolicyId" TEXT,
    "approverRoles" TEXT,
    "riskRating" TEXT NOT NULL DEFAULT 'LOW',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "documentsRequired" TEXT,
    "allowedOutletIds" TEXT,
    "allowedProductIds" TEXT,
    "allowedCustomerGroupIds" TEXT,
    "attributes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "displayName" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "creditLimitOverride" DOUBLE PRECISION,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceVersion" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "riskRating" TEXT NOT NULL DEFAULT 'LOW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
    "signedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "billType" TEXT,
    "isCreditBearing" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccountGroup" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditAccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollModuleConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "moduleName" TEXT NOT NULL DEFAULT 'Payroll',
    "terminology" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'TZS',
    "exchangeRatePolicy" TEXT NOT NULL DEFAULT 'RUN_DATE',
    "approvalRequiredDefault" BOOLEAN NOT NULL DEFAULT true,
    "roundingPolicy" TEXT NOT NULL DEFAULT 'NEAREST_1',
    "negativeNetPolicy" TEXT NOT NULL DEFAULT 'CARRY_FORWARD',
    "payElementVisibilityDefault" TEXT NOT NULL DEFAULT 'SUMMARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "defaultPayFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "isStatutoryExempt" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attributes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payFrequency" TEXT,
    "componentSet" TEXT,
    "approverRoles" TEXT,
    "overtimePolicyId" TEXT,
    "leaveSchemeId" TEXT,
    "statutoryProfileId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "terminology" TEXT,
    "attributes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "employeeNumber" TEXT,
    "categoryId" TEXT NOT NULL,
    "payGroupId" TEXT NOT NULL,
    "departmentId" TEXT,
    "costCenter" TEXT,
    "companyId" TEXT,
    "outletId" TEXT,
    "hireDate" TIMESTAMP(3),
    "probationEndDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "baseCurrency" TEXT NOT NULL DEFAULT 'TZS',
    "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL DEFAULT 'BANK',
    "bankRef" TEXT,
    "mobileMoneyRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollFormula" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "expression" TEXT NOT NULL,
    "variables" TEXT,
    "returnType" TEXT NOT NULL DEFAULT 'NUMBER',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollFormula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "componentType" TEXT NOT NULL,
    "calcMethod" TEXT NOT NULL,
    "parameters" TEXT,
    "formulaId" TEXT,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "pensionable" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'PER_RUN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "proratable" BOOLEAN NOT NULL DEFAULT false,
    "minLimit" DOUBLE PRECISION,
    "maxLimit" DOUBLE PRECISION,
    "roundingRule" TEXT,
    "glMappingKey" TEXT,
    "costCenterAllocation" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "terminology" TEXT,
    "attributes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentAssignment" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "payGroupId" TEXT,
    "employeeId" TEXT,
    "parametersOverride" TEXT,
    "amountOverride" DOUBLE PRECISION,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outletId" TEXT,
    "payGroupId" TEXT,
    "runType" TEXT NOT NULL DEFAULT 'REGULAR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "processingDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "lockDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "totalGross" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEmployerCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "reversalOfId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "categoryId" TEXT,
    "payGroupId" TEXT,
    "personId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "gross" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pensionable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employerCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "warnings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "pensionable" BOOLEAN NOT NULL DEFAULT false,
    "glMappingKey" TEXT,
    "sourceRef" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAuditLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'TZ',
    "authority" TEXT,
    "ruleType" TEXT NOT NULL,
    "baseVar" TEXT NOT NULL DEFAULT 'taxable',
    "parameters" TEXT,
    "employeeRate" DOUBLE PRECISION,
    "employerRate" DOUBLE PRECISION,
    "ceiling" DOUBLE PRECISION,
    "floor" DOUBLE PRECISION,
    "glMappingKey" TEXT,
    "isEmployer" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatutoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "hoursWorked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outletId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "accrualDaysPerMonth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxCarryForward" DOUBLE PRECISION,
    "encashable" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approverRoles" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "accrued" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taken" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL DEFAULT 'BANK',
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "exportedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentInstruction" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK',
    "payeeRef" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseModuleConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "moduleName" TEXT NOT NULL DEFAULT 'Expense & Disbursement',
    "terminology" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'TZS',
    "requireReceiptDefault" BOOLEAN NOT NULL DEFAULT true,
    "allowMixedPayment" BOOLEAN NOT NULL DEFAULT true,
    "allowOverBudget" TEXT NOT NULL DEFAULT 'WARN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiredFields" TEXT,
    "requiredAttachments" TEXT,
    "allowedCategoryIds" TEXT,
    "allowedFundingSourceIds" TEXT,
    "budgetValidation" TEXT NOT NULL DEFAULT 'WARN',
    "approverRoles" TEXT,
    "requiredVerificationStages" TEXT,
    "attributes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legacyFunctionName" TEXT,
    "budgetAccountId" TEXT,
    "spendingLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costCenter" TEXT,
    "departmentId" TEXT,
    "eventId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'CASH',
    "companyPaymentAccountId" TEXT,
    "outletId" TEXT,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responsibleUserId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestTypeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "outletId" TEXT,
    "departmentId" TEXT,
    "eventId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseItem" (
    "id" TEXT NOT NULL,
    "expenseRequestId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "unit" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePayment" (
    "id" TEXT NOT NULL,
    "fundingSourceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "payeeName" TEXT,
    "payeeAccount" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidById" TEXT,
    "journalEntryId" TEXT,
    "verificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "expensePaymentId" TEXT NOT NULL,
    "expenseRequestId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "expenseRequestId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "attachmentId" TEXT,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'RECEIPT',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_resource_key" ON "UserPermission"("userId", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_name_key" ON "Outlet"("name");

-- CreateIndex
CREATE INDEX "SalesMetric_date_idx" ON "SalesMetric"("date");

-- CreateIndex
CREATE INDEX "SalesMetric_department_idx" ON "SalesMetric"("department");

-- CreateIndex
CREATE INDEX "SalesMetric_outletId_idx" ON "SalesMetric"("outletId");

-- CreateIndex
CREATE INDEX "SalesTarget_outletId_idx" ON "SalesTarget"("outletId");

-- CreateIndex
CREATE INDEX "SalesTarget_isActive_idx" ON "SalesTarget"("isActive");

-- CreateIndex
CREATE INDEX "SalesMetricLock_department_idx" ON "SalesMetricLock"("department");

-- CreateIndex
CREATE UNIQUE INDEX "SalesMetricLock_outletId_department_date_key" ON "SalesMetricLock"("outletId", "department", "date");

-- CreateIndex
CREATE INDEX "SalesImport_outletId_idx" ON "SalesImport"("outletId");

-- CreateIndex
CREATE INDEX "SalesImport_status_idx" ON "SalesImport"("status");

-- CreateIndex
CREATE INDEX "SalesImport_createdAt_idx" ON "SalesImport"("createdAt");

-- CreateIndex
CREATE INDEX "SalesImportLine_importId_idx" ON "SalesImportLine"("importId");

-- CreateIndex
CREATE INDEX "SalesImportLine_date_idx" ON "SalesImportLine"("date");

-- CreateIndex
CREATE INDEX "SalesImportLine_productId_idx" ON "SalesImportLine"("productId");

-- CreateIndex
CREATE INDEX "SalesImportLine_superseded_idx" ON "SalesImportLine"("superseded");

-- CreateIndex
CREATE INDEX "SalesStaffAlias_alias_idx" ON "SalesStaffAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "SalesStaffAlias_companyId_alias_key" ON "SalesStaffAlias"("companyId", "alias");

-- CreateIndex
CREATE INDEX "SalesProductAlias_alias_idx" ON "SalesProductAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "SalesProductAlias_companyId_alias_key" ON "SalesProductAlias"("companyId", "alias");

-- CreateIndex
CREATE INDEX "CustomerGroup_isActive_idx" ON "CustomerGroup"("isActive");

-- CreateIndex
CREATE INDEX "PriceList_status_idx" ON "PriceList"("status");

-- CreateIndex
CREATE INDEX "PriceList_outletId_idx" ON "PriceList"("outletId");

-- CreateIndex
CREATE INDEX "PriceList_eventId_idx" ON "PriceList"("eventId");

-- CreateIndex
CREATE INDEX "PriceList_customerGroupId_idx" ON "PriceList"("customerGroupId");

-- CreateIndex
CREATE INDEX "PriceList_isDefault_idx" ON "PriceList"("isDefault");

-- CreateIndex
CREATE INDEX "PriceListItem_productId_idx" ON "PriceListItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_key" ON "PriceListItem"("priceListId", "productId");

-- CreateIndex
CREATE INDEX "PriceChangeLog_productId_idx" ON "PriceChangeLog"("productId");

-- CreateIndex
CREATE INDEX "PriceChangeLog_priceListId_idx" ON "PriceChangeLog"("priceListId");

-- CreateIndex
CREATE INDEX "PriceChangeLog_createdAt_idx" ON "PriceChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "Promotion_status_idx" ON "Promotion"("status");

-- CreateIndex
CREATE INDEX "Promotion_productId_idx" ON "Promotion"("productId");

-- CreateIndex
CREATE INDEX "Promotion_categoryId_idx" ON "Promotion"("categoryId");

-- CreateIndex
CREATE INDEX "DailyReport_status_idx" ON "DailyReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_outletId_date_key" ON "DailyReport"("outletId", "date");

-- CreateIndex
CREATE INDEX "DayClosure_outletId_idx" ON "DayClosure"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "DayClosure_outletId_date_key" ON "DayClosure"("outletId", "date");

-- CreateIndex
CREATE INDEX "BusinessDay_outletId_status_idx" ON "BusinessDay"("outletId", "status");

-- CreateIndex
CREATE INDEX "BusinessDay_date_idx" ON "BusinessDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDay_outletId_date_key" ON "BusinessDay"("outletId", "date");

-- CreateIndex
CREATE INDEX "BusinessDayUnlockRequest_businessDayId_status_idx" ON "BusinessDayUnlockRequest"("businessDayId", "status");

-- CreateIndex
CREATE INDEX "BusinessDayUnlockRequest_requestedById_idx" ON "BusinessDayUnlockRequest"("requestedById");

-- CreateIndex
CREATE INDEX "BusinessDayAuditLog_businessDayId_createdAt_idx" ON "BusinessDayAuditLog"("businessDayId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessDayAuditLog_action_idx" ON "BusinessDayAuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_resource_key" ON "RolePermission"("role", "resource");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDayPolicyConfig_scope_scopeId_key" ON "BusinessDayPolicyConfig"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "DailyCollection_date_idx" ON "DailyCollection"("date");

-- CreateIndex
CREATE INDEX "DailyCollection_outletId_idx" ON "DailyCollection"("outletId");

-- CreateIndex
CREATE INDEX "DailyCollectionChannel_collectionId_idx" ON "DailyCollectionChannel"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCollectionChannel_collectionId_channelCode_key" ON "DailyCollectionChannel"("collectionId", "channelCode");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTemplate_code_key" ON "CollectionTemplate"("code");

-- CreateIndex
CREATE INDEX "CollectionTemplate_companyId_idx" ON "CollectionTemplate"("companyId");

-- CreateIndex
CREATE INDEX "CollectionStage_templateId_idx" ON "CollectionStage"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionStage_templateId_key_key" ON "CollectionStage"("templateId", "key");

-- CreateIndex
CREATE INDEX "CollectionSection_stageId_idx" ON "CollectionSection"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSection_stageId_key_key" ON "CollectionSection"("stageId", "key");

-- CreateIndex
CREATE INDEX "CollectionField_sectionId_idx" ON "CollectionField"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionField_sectionId_key_key" ON "CollectionField"("sectionId", "key");

-- CreateIndex
CREATE INDEX "CollectionValidationRule_templateId_idx" ON "CollectionValidationRule"("templateId");

-- CreateIndex
CREATE INDEX "CollectionSession_outletId_date_idx" ON "CollectionSession"("outletId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSession_outletId_date_templateId_key" ON "CollectionSession"("outletId", "date", "templateId");

-- CreateIndex
CREATE INDEX "CollectionStageRecord_sessionId_idx" ON "CollectionStageRecord"("sessionId");

-- CreateIndex
CREATE INDEX "CollectionStageRecord_stageId_idx" ON "CollectionStageRecord"("stageId");

-- CreateIndex
CREATE INDEX "CollectionFieldValue_stageRecordId_idx" ON "CollectionFieldValue"("stageRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionFieldValue_stageRecordId_fieldId_key" ON "CollectionFieldValue"("stageRecordId", "fieldId");

-- CreateIndex
CREATE INDEX "WorkflowApproval_stageRecordId_idx" ON "WorkflowApproval"("stageRecordId");

-- CreateIndex
CREATE INDEX "WorkflowApproval_transactionId_idx" ON "WorkflowApproval"("transactionId");

-- CreateIndex
CREATE INDEX "WorkflowApproval_expenseRequestId_idx" ON "WorkflowApproval"("expenseRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionModeConfig_scope_scopeId_key" ON "CollectionModeConfig"("scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCalendarConfig_scope_scopeId_key" ON "BusinessCalendarConfig"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "BusinessCalendarOverride_scope_scopeId_startDate_endDate_idx" ON "BusinessCalendarOverride"("scope", "scopeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ShiftTemplate_scope_scopeId_idx" ON "ShiftTemplate"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "BusinessCalendarAuditLog_scope_scopeId_createdAt_idx" ON "BusinessCalendarAuditLog"("scope", "scopeId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessPeriodVersion_scope_scopeId_effectiveDate_idx" ON "BusinessPeriodVersion"("scope", "scopeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "TransactionSession_outletId_date_idx" ON "TransactionSession"("outletId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSession_outletId_date_key" ON "TransactionSession"("outletId", "date");

-- CreateIndex
CREATE INDEX "SystemSalesRecord_sessionId_idx" ON "SystemSalesRecord"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSalesRecord_sessionId_staffName_key" ON "SystemSalesRecord"("sessionId", "staffName");

-- CreateIndex
CREATE INDEX "StaffTransaction_sessionId_idx" ON "StaffTransaction"("sessionId");

-- CreateIndex
CREATE INDEX "StaffTransaction_staffId_idx" ON "StaffTransaction"("staffId");

-- CreateIndex
CREATE INDEX "StaffTransaction_status_idx" ON "StaffTransaction"("status");

-- CreateIndex
CREATE INDEX "BusinessSession_companyId_date_idx" ON "BusinessSession"("companyId", "date");

-- CreateIndex
CREATE INDEX "BusinessSession_outletId_date_idx" ON "BusinessSession"("outletId", "date");

-- CreateIndex
CREATE INDEX "BusinessSession_staffId_idx" ON "BusinessSession"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSession_outletId_date_staffName_key" ON "BusinessSession"("outletId", "date", "staffName");

-- CreateIndex
CREATE INDEX "Person_type_idx" ON "Person"("type");

-- CreateIndex
CREATE INDEX "Person_customerGroupId_idx" ON "Person"("customerGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_type_code_key" ON "Person"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_voucherNumber_key" ON "SignedBill"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_autoKey_key" ON "SignedBill"("autoKey");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_internalBillId_key" ON "SignedBill"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_displayReference_key" ON "SignedBill"("displayReference");

-- CreateIndex
CREATE INDEX "SignedBill_date_idx" ON "SignedBill"("date");

-- CreateIndex
CREATE INDEX "SignedBill_billType_idx" ON "SignedBill"("billType");

-- CreateIndex
CREATE INDEX "SignedBill_status_idx" ON "SignedBill"("status");

-- CreateIndex
CREATE INDEX "SignedBill_outletId_idx" ON "SignedBill"("outletId");

-- CreateIndex
CREATE INDEX "SignedBill_personId_idx" ON "SignedBill"("personId");

-- CreateIndex
CREATE INDEX "SignedBill_creditGroupId_idx" ON "SignedBill"("creditGroupId");

-- CreateIndex
CREATE INDEX "SignedBill_creditAccountId_idx" ON "SignedBill"("creditAccountId");

-- CreateIndex
CREATE INDEX "BillItem_signedBillId_idx" ON "BillItem"("signedBillId");

-- CreateIndex
CREATE INDEX "BillItem_productId_idx" ON "BillItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PaidBill_internalBillId_key" ON "PaidBill"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "PaidBill_displayReference_key" ON "PaidBill"("displayReference");

-- CreateIndex
CREATE INDEX "PaidBill_date_idx" ON "PaidBill"("date");

-- CreateIndex
CREATE INDEX "PaidBill_outletId_idx" ON "PaidBill"("outletId");

-- CreateIndex
CREATE INDEX "PaidBill_signedBillId_idx" ON "PaidBill"("signedBillId");

-- CreateIndex
CREATE INDEX "PettyCash_date_idx" ON "PettyCash"("date");

-- CreateIndex
CREATE INDEX "PettyCash_status_idx" ON "PettyCash"("status");

-- CreateIndex
CREATE INDEX "PettyCash_paymentStatus_idx" ON "PettyCash"("paymentStatus");

-- CreateIndex
CREATE INDEX "PettyCash_pettyType_idx" ON "PettyCash"("pettyType");

-- CreateIndex
CREATE INDEX "PettyCash_expenseRequestId_idx" ON "PettyCash"("expenseRequestId");

-- CreateIndex
CREATE INDEX "PettyFund_outletId_idx" ON "PettyFund"("outletId");

-- CreateIndex
CREATE INDEX "PettyFundTxn_fundId_idx" ON "PettyFundTxn"("fundId");

-- CreateIndex
CREATE INDEX "PettyFundTxn_pettyCashId_idx" ON "PettyFundTxn"("pettyCashId");

-- CreateIndex
CREATE INDEX "PettyCashItem_pettyCashId_idx" ON "PettyCashItem"("pettyCashId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PettyFunction_name_key" ON "PettyFunction"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_code_key" ON "ProductCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_name_key" ON "Warehouse"("name");

-- CreateIndex
CREATE INDEX "StockLevel_outletId_counterCode_idx" ON "StockLevel"("outletId", "counterCode");

-- CreateIndex
CREATE INDEX "StockLevel_warehouseId_idx" ON "StockLevel"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_productId_outletId_counterCode_warehouseId_key" ON "StockLevel"("productId", "outletId", "counterCode", "warehouseId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_productId_outletId_counterCode_createdAt_idx" ON "StockLedgerEntry"("productId", "outletId", "counterCode", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_productId_warehouseId_createdAt_idx" ON "StockLedgerEntry"("productId", "warehouseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_grnNumber_key" ON "Grn"("grnNumber");

-- CreateIndex
CREATE INDEX "Grn_warehouseId_idx" ON "Grn"("warehouseId");

-- CreateIndex
CREATE INDEX "Grn_receivedDate_idx" ON "Grn"("receivedDate");

-- CreateIndex
CREATE INDEX "Grn_purchaseOrderId_idx" ON "Grn"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Grn_companyId_idx" ON "Grn"("companyId");

-- CreateIndex
CREATE INDEX "GrnItem_grnId_idx" ON "GrnItem"("grnId");

-- CreateIndex
CREATE INDEX "GrnItem_productId_idx" ON "GrnItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "StockTransfer_warehouseId_idx" ON "StockTransfer"("warehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_outletId_counterCode_idx" ON "StockTransfer"("outletId", "counterCode");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_productId_idx" ON "StockTransferItem"("productId");

-- CreateIndex
CREATE INDEX "StockCountSession_outletId_counterCode_idx" ON "StockCountSession"("outletId", "counterCode");

-- CreateIndex
CREATE INDEX "StockCountSession_warehouseId_idx" ON "StockCountSession"("warehouseId");

-- CreateIndex
CREATE INDEX "StockCountSession_countDate_idx" ON "StockCountSession"("countDate");

-- CreateIndex
CREATE INDEX "StockCountItem_sessionId_idx" ON "StockCountItem"("sessionId");

-- CreateIndex
CREATE INDEX "StockCountItem_productId_idx" ON "StockCountItem"("productId");

-- CreateIndex
CREATE INDEX "StockLossAttribution_sessionId_idx" ON "StockLossAttribution"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Breakage_internalBillId_key" ON "Breakage"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "Breakage_displayReference_key" ON "Breakage"("displayReference");

-- CreateIndex
CREATE INDEX "Breakage_outletId_counterCode_idx" ON "Breakage"("outletId", "counterCode");

-- CreateIndex
CREATE INDEX "Breakage_warehouseId_idx" ON "Breakage"("warehouseId");

-- CreateIndex
CREATE INDEX "Breakage_createdAt_idx" ON "Breakage"("createdAt");

-- CreateIndex
CREATE INDEX "Cancellation_collectionId_idx" ON "Cancellation"("collectionId");

-- CreateIndex
CREATE INDEX "Cancellation_date_idx" ON "Cancellation"("date");

-- CreateIndex
CREATE INDEX "Cancellation_status_idx" ON "Cancellation"("status");

-- CreateIndex
CREATE INDEX "CashRecon_date_idx" ON "CashRecon"("date");

-- CreateIndex
CREATE INDEX "CashRecon_outletId_idx" ON "CashRecon"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "CashReconExcess_internalBillId_key" ON "CashReconExcess"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "CashReconExcess_displayReference_key" ON "CashReconExcess"("displayReference");

-- CreateIndex
CREATE INDEX "CashReconExcess_cashReconId_idx" ON "CashReconExcess"("cashReconId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionExcess_internalBillId_key" ON "CollectionExcess"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionExcess_displayReference_key" ON "CollectionExcess"("displayReference");

-- CreateIndex
CREATE INDEX "CollectionExcess_collectionId_idx" ON "CollectionExcess"("collectionId");

-- CreateIndex
CREATE INDEX "BankRecon_date_idx" ON "BankRecon"("date");

-- CreateIndex
CREATE INDEX "BankRecon_outletId_idx" ON "BankRecon"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonCategory_code_key" ON "PersonCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannel_code_key" ON "PaymentChannel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReason_code_key" ON "CancellationReason"("code");

-- CreateIndex
CREATE INDEX "CancellationReasonCategory_categoryId_idx" ON "CancellationReasonCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReasonCategory_reasonId_categoryId_key" ON "CancellationReasonCategory"("reasonId", "categoryId");

-- CreateIndex
CREATE INDEX "CancellationReasonProduct_productId_idx" ON "CancellationReasonProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReasonProduct_reasonId_productId_key" ON "CancellationReasonProduct"("reasonId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ExcessReason_code_key" ON "ExcessReason"("code");

-- CreateIndex
CREATE INDEX "BillReferenceComponent_configId_order_idx" ON "BillReferenceComponent"("configId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BillReferenceComponent_configId_type_key" ON "BillReferenceComponent"("configId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "BillTypeConfig_code_key" ON "BillTypeConfig"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BillSequenceCounter_scopeKey_key" ON "BillSequenceCounter"("scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillReferenceRegistry_internalBillId_key" ON "BillReferenceRegistry"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "BillReferenceRegistry_displayReference_key" ON "BillReferenceRegistry"("displayReference");

-- CreateIndex
CREATE INDEX "BillReferenceRegistry_sourceModel_sourceId_idx" ON "BillReferenceRegistry"("sourceModel", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExcessRefund_internalBillId_key" ON "ExcessRefund"("internalBillId");

-- CreateIndex
CREATE UNIQUE INDEX "ExcessRefund_displayReference_key" ON "ExcessRefund"("displayReference");

-- CreateIndex
CREATE INDEX "ExcessRefund_date_idx" ON "ExcessRefund"("date");

-- CreateIndex
CREATE INDEX "ExcessRefund_outletId_idx" ON "ExcessRefund"("outletId");

-- CreateIndex
CREATE INDEX "ExcessRefund_personId_idx" ON "ExcessRefund"("personId");

-- CreateIndex
CREATE INDEX "ExcessSettlement_sourceId_idx" ON "ExcessSettlement"("sourceId");

-- CreateIndex
CREATE INDEX "ExcessSettlement_targetId_idx" ON "ExcessSettlement"("targetId");

-- CreateIndex
CREATE INDEX "ExcessSettlement_reason_idx" ON "ExcessSettlement"("reason");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PosTable_outletId_idx" ON "PosTable"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "PosTable_outletId_number_key" ON "PosTable"("outletId", "number");

-- CreateIndex
CREATE INDEX "PosShift_outletId_idx" ON "PosShift"("outletId");

-- CreateIndex
CREATE INDEX "PosShift_date_idx" ON "PosShift"("date");

-- CreateIndex
CREATE INDEX "PosCounter_outletId_idx" ON "PosCounter"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "PosCounter_outletId_code_key" ON "PosCounter"("outletId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_orderNo_key" ON "PosOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_clientRequestId_key" ON "PosOrder"("clientRequestId");

-- CreateIndex
CREATE INDEX "PosOrder_outletId_idx" ON "PosOrder"("outletId");

-- CreateIndex
CREATE INDEX "PosOrder_shiftId_idx" ON "PosOrder"("shiftId");

-- CreateIndex
CREATE INDEX "PosOrder_waiterId_idx" ON "PosOrder"("waiterId");

-- CreateIndex
CREATE INDEX "PosOrder_eventId_idx" ON "PosOrder"("eventId");

-- CreateIndex
CREATE INDEX "PosOrder_status_idx" ON "PosOrder"("status");

-- CreateIndex
CREATE INDEX "PosOrder_createdAt_idx" ON "PosOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PosPayment_orderId_idx" ON "PosPayment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrderItem_clientRequestId_key" ON "PosOrderItem"("clientRequestId");

-- CreateIndex
CREATE INDEX "PosOrderItem_orderId_idx" ON "PosOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PosOrderItem_productId_idx" ON "PosOrderItem"("productId");

-- CreateIndex
CREATE INDEX "PosStockRequest_outletId_idx" ON "PosStockRequest"("outletId");

-- CreateIndex
CREATE INDEX "PosStockRequest_status_idx" ON "PosStockRequest"("status");

-- CreateIndex
CREATE INDEX "PosPrintLog_orderId_idx" ON "PosPrintLog"("orderId");

-- CreateIndex
CREATE INDEX "PosWaiterSession_waiterId_idx" ON "PosWaiterSession"("waiterId");

-- CreateIndex
CREATE INDEX "PosWaiterSession_shiftId_idx" ON "PosWaiterSession"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "PosProductExtra_name_key" ON "PosProductExtra"("name");

-- CreateIndex
CREATE INDEX "PosBlockedItem_outletId_idx" ON "PosBlockedItem"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "PosBlockedItem_outletId_productId_key" ON "PosBlockedItem"("outletId", "productId");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_outletId_idx" ON "ScheduleAssignment"("outletId");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_date_idx" ON "ScheduleAssignment"("date");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_staffId_idx" ON "ScheduleAssignment"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAssignment_date_shiftType_staffId_key" ON "ScheduleAssignment"("date", "shiftType", "staffId");

-- CreateIndex
CREATE INDEX "StaffUnavailability_staffId_idx" ON "StaffUnavailability"("staffId");

-- CreateIndex
CREATE INDEX "StaffUnavailability_date_idx" ON "StaffUnavailability"("date");

-- CreateIndex
CREATE UNIQUE INDEX "OutletScheduleConfig_outletId_key" ON "OutletScheduleConfig"("outletId");

-- CreateIndex
CREATE INDEX "Event_date_idx" ON "Event"("date");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "EventStaff_staffId_idx" ON "EventStaff"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "EventStaff_eventId_staffId_key" ON "EventStaff"("eventId", "staffId");

-- CreateIndex
CREATE INDEX "EventExpense_eventId_idx" ON "EventExpense"("eventId");

-- CreateIndex
CREATE INDEX "EventSponsor_eventId_idx" ON "EventSponsor"("eventId");

-- CreateIndex
CREATE INDEX "EventProduct_eventId_idx" ON "EventProduct"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventProduct_eventId_productId_key" ON "EventProduct"("eventId", "productId");

-- CreateIndex
CREATE INDEX "EventTarget_eventId_idx" ON "EventTarget"("eventId");

-- CreateIndex
CREATE INDEX "EventTicketType_eventId_idx" ON "EventTicketType"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketBooking_bookingNumber_key" ON "TicketBooking"("bookingNumber");

-- CreateIndex
CREATE INDEX "TicketBooking_eventId_idx" ON "TicketBooking"("eventId");

-- CreateIndex
CREATE INDEX "TicketBooking_ticketTypeId_idx" ON "TicketBooking"("ticketTypeId");

-- CreateIndex
CREATE INDEX "EventTable_eventId_idx" ON "EventTable"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TableBooking_bookingNumber_key" ON "TableBooking"("bookingNumber");

-- CreateIndex
CREATE INDEX "TableBooking_eventId_idx" ON "TableBooking"("eventId");

-- CreateIndex
CREATE INDEX "TableBooking_tableId_idx" ON "TableBooking"("tableId");

-- CreateIndex
CREATE INDEX "Account_companyId_type_idx" ON "Account"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_code_key" ON "Account"("companyId", "code");

-- CreateIndex
CREATE INDEX "FinancialPeriod_companyId_status_idx" ON "FinancialPeriod"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_companyId_name_key" ON "FinancialPeriod"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_entryDate_idx" ON "JournalEntry"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAccountMapping_scope_scopeId_key_key" ON "FinanceAccountMapping"("scope", "scopeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_invoiceNumber_key" ON "SupplierInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_status_idx" ON "SupplierInvoice"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierInvoice_companyId_idx" ON "SupplierInvoice"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentNumber_key" ON "SupplierPayment"("paymentNumber");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPayment_companyId_idx" ON "SupplierPayment"("companyId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_paymentId_idx" ON "SupplierPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_supplierInvoiceId_idx" ON "SupplierPaymentAllocation"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "SignedBillWriteOff_signedBillId_idx" ON "SignedBillWriteOff"("signedBillId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPaymentAccount_glAccountId_key" ON "CompanyPaymentAccount"("glAccountId");

-- CreateIndex
CREATE INDEX "CompanyPaymentAccount_companyId_paymentChannelId_idx" ON "CompanyPaymentAccount"("companyId", "paymentChannelId");

-- CreateIndex
CREATE INDEX "CompanyPaymentAccount_outletId_idx" ON "CompanyPaymentAccount"("outletId");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_transactionDate_idx" ON "BankTransaction"("companyId", "transactionDate");

-- CreateIndex
CREATE INDEX "Budget_companyId_accountId_periodStart_periodEnd_idx" ON "Budget"("companyId", "accountId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Budget_outletId_idx" ON "Budget"("outletId");

-- CreateIndex
CREATE INDEX "AccountReconciliation_companyPaymentAccountId_periodStart_idx" ON "AccountReconciliation"("companyPaymentAccountId", "periodStart");

-- CreateIndex
CREATE INDEX "ReconciliationItem_reconciliationId_matchStatus_idx" ON "ReconciliationItem"("reconciliationId", "matchStatus");

-- CreateIndex
CREATE INDEX "ReconciliationStage_companyId_stageKey_status_idx" ON "ReconciliationStage"("companyId", "stageKey", "status");

-- CreateIndex
CREATE INDEX "ReconciliationStage_outletId_stageKey_status_idx" ON "ReconciliationStage"("outletId", "stageKey", "status");

-- CreateIndex
CREATE INDEX "ReconciliationStage_date_idx" ON "ReconciliationStage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationStage_companyId_outletId_date_stageKey_key" ON "ReconciliationStage"("companyId", "outletId", "date", "stageKey");

-- CreateIndex
CREATE INDEX "ReconciliationStageUnlockRequest_stageId_status_idx" ON "ReconciliationStageUnlockRequest"("stageId", "status");

-- CreateIndex
CREATE INDEX "ReconciliationStageAuditLog_stageId_createdAt_idx" ON "ReconciliationStageAuditLog"("stageId", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationStageAuditLog_action_idx" ON "ReconciliationStageAuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationStageConfig_scope_scopeId_stageKey_key" ON "ReconciliationStageConfig"("scope", "scopeId", "stageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationReminderPolicy_scope_scopeId_stageKey_key" ON "ReconciliationReminderPolicy"("scope", "scopeId", "stageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRequirement_scope_scopeId_stageKey_checkType_key" ON "ReconciliationRequirement"("scope", "scopeId", "stageKey", "checkType");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationCheckResult_stageId_checkType_key" ON "ReconciliationCheckResult"("stageId", "checkType");

-- CreateIndex
CREATE INDEX "PaymentVerification_companyId_date_status_idx" ON "PaymentVerification"("companyId", "date", "status");

-- CreateIndex
CREATE INDEX "PaymentVerification_outletId_date_status_idx" ON "PaymentVerification"("outletId", "date", "status");

-- CreateIndex
CREATE INDEX "PaymentVerification_reference_idx" ON "PaymentVerification"("reference");

-- CreateIndex
CREATE INDEX "PaymentIntegrationConnector_companyId_isActive_idx" ON "PaymentIntegrationConnector"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "WriteOffRequest_status_idx" ON "WriteOffRequest"("status");

-- CreateIndex
CREATE INDEX "WriteOffRequest_sourceModel_sourceId_idx" ON "WriteOffRequest"("sourceModel", "sourceId");

-- CreateIndex
CREATE INDEX "WriteOffAuditLog_writeOffId_createdAt_idx" ON "WriteOffAuditLog"("writeOffId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditModuleConfig_scope_scopeId_key" ON "CreditModuleConfig"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "CreditPolicy_companyId_policyType_idx" ON "CreditPolicy"("companyId", "policyType");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPolicy_companyId_code_key" ON "CreditPolicy"("companyId", "code");

-- CreateIndex
CREATE INDEX "CreditGroup_companyId_status_idx" ON "CreditGroup"("companyId", "status");

-- CreateIndex
CREATE INDEX "CreditGroup_legacyBillTypeCode_idx" ON "CreditGroup"("legacyBillTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "CreditGroup_companyId_code_key" ON "CreditGroup"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_personId_key" ON "CreditAccount"("personId");

-- CreateIndex
CREATE INDEX "CreditAccount_companyId_status_idx" ON "CreditAccount"("companyId", "status");

-- CreateIndex
CREATE INDEX "CreditAccount_userId_idx" ON "CreditAccount"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_accountId_idx" ON "CreditTransaction"("accountId");

-- CreateIndex
CREATE INDEX "CreditTransaction_entryDate_idx" ON "CreditTransaction"("entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_sourceType_sourceId_key" ON "CreditTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CreditAccountGroup_accountId_idx" ON "CreditAccountGroup"("accountId");

-- CreateIndex
CREATE INDEX "CreditAccountGroup_groupId_idx" ON "CreditAccountGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollModuleConfig_scope_scopeId_key" ON "PayrollModuleConfig"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "EmployeeCategory_companyId_status_idx" ON "EmployeeCategory"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeCategory_companyId_code_key" ON "EmployeeCategory"("companyId", "code");

-- CreateIndex
CREATE INDEX "PayGroup_companyId_status_idx" ON "PayGroup"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayGroup_companyId_code_key" ON "PayGroup"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_personId_key" ON "Employee"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_companyId_status_idx" ON "Employee"("companyId", "status");

-- CreateIndex
CREATE INDEX "Employee_categoryId_idx" ON "Employee"("categoryId");

-- CreateIndex
CREATE INDEX "Employee_payGroupId_idx" ON "Employee"("payGroupId");

-- CreateIndex
CREATE INDEX "Employee_userId_idx" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollFormula_companyId_code_key" ON "PayrollFormula"("companyId", "code");

-- CreateIndex
CREATE INDEX "PayComponent_companyId_status_idx" ON "PayComponent"("companyId", "status");

-- CreateIndex
CREATE INDEX "PayComponent_componentType_idx" ON "PayComponent"("componentType");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_companyId_code_key" ON "PayComponent"("companyId", "code");

-- CreateIndex
CREATE INDEX "ComponentAssignment_componentId_idx" ON "ComponentAssignment"("componentId");

-- CreateIndex
CREATE INDEX "ComponentAssignment_payGroupId_idx" ON "ComponentAssignment"("payGroupId");

-- CreateIndex
CREATE INDEX "ComponentAssignment_employeeId_idx" ON "ComponentAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollRun_companyId_status_idx" ON "PayrollRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "PayrollRun_periodKey_idx" ON "PayrollRun"("periodKey");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");

-- CreateIndex
CREATE INDEX "PayrollAuditLog_runId_idx" ON "PayrollAuditLog"("runId");

-- CreateIndex
CREATE INDEX "StatutoryRule_companyId_code_idx" ON "StatutoryRule"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryRule_companyId_code_effectiveFrom_key" ON "StatutoryRule"("companyId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "AttendanceRecord_employeeId_date_idx" ON "AttendanceRecord"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");

-- CreateIndex
CREATE INDEX "LeaveType_companyId_status_idx" ON "LeaveType"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_companyId_code_key" ON "LeaveType"("companyId", "code");

-- CreateIndex
CREATE INDEX "LeaveBalance_employeeId_idx" ON "LeaveBalance"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_key" ON "LeaveBalance"("employeeId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_leaveTypeId_idx" ON "LeaveRequest"("leaveTypeId");

-- CreateIndex
CREATE INDEX "PaymentBatch_runId_idx" ON "PaymentBatch"("runId");

-- CreateIndex
CREATE INDEX "PaymentBatch_companyId_status_idx" ON "PaymentBatch"("companyId", "status");

-- CreateIndex
CREATE INDEX "PaymentInstruction_batchId_idx" ON "PaymentInstruction"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseModuleConfig_scope_scopeId_key" ON "ExpenseModuleConfig"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "RequestType_companyId_isActive_idx" ON "RequestType"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RequestType_companyId_code_key" ON "RequestType"("companyId", "code");

-- CreateIndex
CREATE INDEX "ExpenseCategory_companyId_isActive_idx" ON "ExpenseCategory"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "ExpenseCategory_legacyFunctionName_idx" ON "ExpenseCategory"("legacyFunctionName");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_companyId_code_key" ON "ExpenseCategory"("companyId", "code");

-- CreateIndex
CREATE INDEX "FundingSource_companyId_isActive_idx" ON "FundingSource"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "FundingSource_companyPaymentAccountId_idx" ON "FundingSource"("companyPaymentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingSource_companyId_code_key" ON "FundingSource"("companyId", "code");

-- CreateIndex
CREATE INDEX "ExpenseRequest_companyId_status_idx" ON "ExpenseRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "ExpenseRequest_requestTypeId_idx" ON "ExpenseRequest"("requestTypeId");

-- CreateIndex
CREATE INDEX "ExpenseRequest_categoryId_idx" ON "ExpenseRequest"("categoryId");

-- CreateIndex
CREATE INDEX "ExpenseRequest_outletId_idx" ON "ExpenseRequest"("outletId");

-- CreateIndex
CREATE INDEX "ExpenseItem_expenseRequestId_idx" ON "ExpenseItem"("expenseRequestId");

-- CreateIndex
CREATE INDEX "ExpensePayment_fundingSourceId_idx" ON "ExpensePayment"("fundingSourceId");

-- CreateIndex
CREATE INDEX "ExpensePayment_reference_idx" ON "ExpensePayment"("reference");

-- CreateIndex
CREATE INDEX "PaymentAllocation_expensePaymentId_idx" ON "PaymentAllocation"("expensePaymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_expenseRequestId_idx" ON "PaymentAllocation"("expenseRequestId");

-- CreateIndex
CREATE INDEX "VerificationRecord_expenseRequestId_stage_idx" ON "VerificationRecord"("expenseRequestId", "stage");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "CollectionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMetric" ADD CONSTRAINT "SalesMetric_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImport" ADD CONSTRAINT "SalesImport_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImportLine" ADD CONSTRAINT "SalesImportLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDay" ADD CONSTRAINT "BusinessDay_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDayUnlockRequest" ADD CONSTRAINT "BusinessDayUnlockRequest_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDayUnlockRequest" ADD CONSTRAINT "BusinessDayUnlockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDayUnlockRequest" ADD CONSTRAINT "BusinessDayUnlockRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDayAuditLog" ADD CONSTRAINT "BusinessDayAuditLog_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCollection" ADD CONSTRAINT "DailyCollection_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCollection" ADD CONSTRAINT "DailyCollection_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCollectionChannel" ADD CONSTRAINT "DailyCollectionChannel_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DailyCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTemplate" ADD CONSTRAINT "CollectionTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStage" ADD CONSTRAINT "CollectionStage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CollectionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSection" ADD CONSTRAINT "CollectionSection_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CollectionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionField" ADD CONSTRAINT "CollectionField_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CollectionSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionValidationRule" ADD CONSTRAINT "CollectionValidationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CollectionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSession" ADD CONSTRAINT "CollectionSession_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSession" ADD CONSTRAINT "CollectionSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CollectionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSession" ADD CONSTRAINT "CollectionSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSession" ADD CONSTRAINT "CollectionSession_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStageRecord" ADD CONSTRAINT "CollectionStageRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CollectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStageRecord" ADD CONSTRAINT "CollectionStageRecord_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CollectionStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStageRecord" ADD CONSTRAINT "CollectionStageRecord_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStageRecord" ADD CONSTRAINT "CollectionStageRecord_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionFieldValue" ADD CONSTRAINT "CollectionFieldValue_stageRecordId_fkey" FOREIGN KEY ("stageRecordId") REFERENCES "CollectionStageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionFieldValue" ADD CONSTRAINT "CollectionFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CollectionField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_stageRecordId_fkey" FOREIGN KEY ("stageRecordId") REFERENCES "CollectionStageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "StaffTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSession" ADD CONSTRAINT "TransactionSession_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSession" ADD CONSTRAINT "TransactionSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSession" ADD CONSTRAINT "TransactionSession_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSalesRecord" ADD CONSTRAINT "SystemSalesRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TransactionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSalesRecord" ADD CONSTRAINT "SystemSalesRecord_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTransaction" ADD CONSTRAINT "StaffTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TransactionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTransaction" ADD CONSTRAINT "StaffTransaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSession" ADD CONSTRAINT "BusinessSession_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBill" ADD CONSTRAINT "SignedBill_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBill" ADD CONSTRAINT "SignedBill_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBill" ADD CONSTRAINT "SignedBill_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBill" ADD CONSTRAINT "SignedBill_billTypeConfigId_fkey" FOREIGN KEY ("billTypeConfigId") REFERENCES "BillTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBill" ADD CONSTRAINT "SignedBill_creditGroupId_fkey" FOREIGN KEY ("creditGroupId") REFERENCES "CreditGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBill" ADD CONSTRAINT "SignedBill_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_signedBillId_fkey" FOREIGN KEY ("signedBillId") REFERENCES "SignedBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBill" ADD CONSTRAINT "PaidBill_signedBillId_fkey" FOREIGN KEY ("signedBillId") REFERENCES "SignedBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBill" ADD CONSTRAINT "PaidBill_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBill" ADD CONSTRAINT "PaidBill_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBill" ADD CONSTRAINT "PaidBill_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBill" ADD CONSTRAINT "PaidBill_billTypeConfigId_fkey" FOREIGN KEY ("billTypeConfigId") REFERENCES "BillTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCash" ADD CONSTRAINT "PettyCash_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyFundTxn" ADD CONSTRAINT "PettyFundTxn_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashItem" ADD CONSTRAINT "PettyCashItem_pettyCashId_fkey" FOREIGN KEY ("pettyCashId") REFERENCES "PettyCash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLossAttribution" ADD CONSTRAINT "StockLossAttribution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakage" ADD CONSTRAINT "Breakage_billTypeConfigId_fkey" FOREIGN KEY ("billTypeConfigId") REFERENCES "BillTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DailyCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReconExcess" ADD CONSTRAINT "CashReconExcess_cashReconId_fkey" FOREIGN KEY ("cashReconId") REFERENCES "CashRecon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReconExcess" ADD CONSTRAINT "CashReconExcess_billTypeConfigId_fkey" FOREIGN KEY ("billTypeConfigId") REFERENCES "BillTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionExcess" ADD CONSTRAINT "CollectionExcess_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DailyCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionExcess" ADD CONSTRAINT "CollectionExcess_billTypeConfigId_fkey" FOREIGN KEY ("billTypeConfigId") REFERENCES "BillTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationReasonCategory" ADD CONSTRAINT "CancellationReasonCategory_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "CancellationReason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationReasonCategory" ADD CONSTRAINT "CancellationReasonCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationReasonProduct" ADD CONSTRAINT "CancellationReasonProduct_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "CancellationReason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationReasonProduct" ADD CONSTRAINT "CancellationReasonProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillReferenceComponent" ADD CONSTRAINT "BillReferenceComponent_configId_fkey" FOREIGN KEY ("configId") REFERENCES "BillReferenceConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessRefund" ADD CONSTRAINT "ExcessRefund_billTypeConfigId_fkey" FOREIGN KEY ("billTypeConfigId") REFERENCES "BillTypeConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessRefund" ADD CONSTRAINT "ExcessRefund_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessRefund" ADD CONSTRAINT "ExcessRefund_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessRefund" ADD CONSTRAINT "ExcessRefund_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTable" ADD CONSTRAINT "PosTable_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCounter" ADD CONSTRAINT "PosCounter_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderItem" ADD CONSTRAINT "PosOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderItem" ADD CONSTRAINT "PosOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStockRequest" ADD CONSTRAINT "PosStockRequest_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPrintLog" ADD CONSTRAINT "PosPrintLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosWaiterSession" ADD CONSTRAINT "PosWaiterSession_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosWaiterSession" ADD CONSTRAINT "PosWaiterSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBlockedItem" ADD CONSTRAINT "PosBlockedItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBlockedItem" ADD CONSTRAINT "PosBlockedItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUnavailability" ADD CONSTRAINT "StaffUnavailability_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletScheduleConfig" ADD CONSTRAINT "OutletScheduleConfig_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaff" ADD CONSTRAINT "EventStaff_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaff" ADD CONSTRAINT "EventStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventExpense" ADD CONSTRAINT "EventExpense_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSponsor" ADD CONSTRAINT "EventSponsor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventProduct" ADD CONSTRAINT "EventProduct_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventProduct" ADD CONSTRAINT "EventProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTarget" ADD CONSTRAINT "EventTarget_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketType" ADD CONSTRAINT "EventTicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketBooking" ADD CONSTRAINT "TicketBooking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketBooking" ADD CONSTRAINT "TicketBooking_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "EventTicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTable" ADD CONSTRAINT "EventTable_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "EventTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialPeriod" ADD CONSTRAINT "FinancialPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialPeriod" ADD CONSTRAINT "FinancialPeriod_parentPeriodId_fkey" FOREIGN KEY ("parentPeriodId") REFERENCES "FinancialPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAccountMapping" ADD CONSTRAINT "FinanceAccountMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_paymentChannelId_fkey" FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedBillWriteOff" ADD CONSTRAINT "SignedBillWriteOff_signedBillId_fkey" FOREIGN KEY ("signedBillId") REFERENCES "SignedBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAccount" ADD CONSTRAINT "CompanyPaymentAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAccount" ADD CONSTRAINT "CompanyPaymentAccount_paymentChannelId_fkey" FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAccount" ADD CONSTRAINT "CompanyPaymentAccount_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAccount" ADD CONSTRAINT "CompanyPaymentAccount_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "CompanyPaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "CompanyPaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountReconciliation" ADD CONSTRAINT "AccountReconciliation_companyPaymentAccountId_fkey" FOREIGN KEY ("companyPaymentAccountId") REFERENCES "CompanyPaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "AccountReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationStage" ADD CONSTRAINT "ReconciliationStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationStage" ADD CONSTRAINT "ReconciliationStage_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationStageUnlockRequest" ADD CONSTRAINT "ReconciliationStageUnlockRequest_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ReconciliationStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationStageAuditLog" ADD CONSTRAINT "ReconciliationStageAuditLog_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ReconciliationStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationCheckResult" ADD CONSTRAINT "ReconciliationCheckResult_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ReconciliationStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntegrationConnector" ADD CONSTRAINT "PaymentIntegrationConnector_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOffRequest" ADD CONSTRAINT "WriteOffRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOffRequest" ADD CONSTRAINT "WriteOffRequest_reconciliationStageId_fkey" FOREIGN KEY ("reconciliationStageId") REFERENCES "ReconciliationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOffAuditLog" ADD CONSTRAINT "WriteOffAuditLog_writeOffId_fkey" FOREIGN KEY ("writeOffId") REFERENCES "WriteOffRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPolicy" ADD CONSTRAINT "CreditPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditGroup" ADD CONSTRAINT "CreditGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditGroup" ADD CONSTRAINT "CreditGroup_interestPolicyId_fkey" FOREIGN KEY ("interestPolicyId") REFERENCES "CreditPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditGroup" ADD CONSTRAINT "CreditGroup_penaltyPolicyId_fkey" FOREIGN KEY ("penaltyPolicyId") REFERENCES "CreditPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditGroup" ADD CONSTRAINT "CreditGroup_limitPolicyId_fkey" FOREIGN KEY ("limitPolicyId") REFERENCES "CreditPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccountGroup" ADD CONSTRAINT "CreditAccountGroup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccountGroup" ADD CONSTRAINT "CreditAccountGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CreditGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_payGroupId_fkey" FOREIGN KEY ("payGroupId") REFERENCES "PayGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "PayrollFormula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentAssignment" ADD CONSTRAINT "ComponentAssignment_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentAssignment" ADD CONSTRAINT "ComponentAssignment_payGroupId_fkey" FOREIGN KEY ("payGroupId") REFERENCES "PayGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentAssignment" ADD CONSTRAINT "ComponentAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestType" ADD CONSTRAINT "RequestType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_budgetAccountId_fkey" FOREIGN KEY ("budgetAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingSource" ADD CONSTRAINT "FundingSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingSource" ADD CONSTRAINT "FundingSource_companyPaymentAccountId_fkey" FOREIGN KEY ("companyPaymentAccountId") REFERENCES "CompanyPaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "RequestType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_expensePaymentId_fkey" FOREIGN KEY ("expensePaymentId") REFERENCES "ExpensePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

