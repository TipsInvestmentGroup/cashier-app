-- CreateTable
CREATE TABLE "BusinessCalendarConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "templateName" TEXT NOT NULL DEFAULT 'CUSTOM',
    "businessDayStartTime" TEXT NOT NULL DEFAULT '05:00',
    "businessDayEndTime" TEXT NOT NULL DEFAULT '05:00',
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
    "weekStartDay" INTEGER NOT NULL DEFAULT 1,
    "fyStartMonth" INTEGER NOT NULL DEFAULT 1,
    "fyStartDay" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BusinessCalendarOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "businessDayStartTime" TEXT,
    "businessDayEndTime" TEXT,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BusinessCalendarAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCalendarConfig_scope_scopeId_key" ON "BusinessCalendarConfig"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "BusinessCalendarOverride_scope_scopeId_startDate_endDate_idx" ON "BusinessCalendarOverride"("scope", "scopeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ShiftTemplate_scope_scopeId_idx" ON "ShiftTemplate"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "BusinessCalendarAuditLog_scope_scopeId_createdAt_idx" ON "BusinessCalendarAuditLog"("scope", "scopeId", "createdAt");
