-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "outletId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailyCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cash" REAL NOT NULL DEFAULT 0,
    "crdb" REAL NOT NULL DEFAULT 0,
    "stanbic" REAL NOT NULL DEFAULT 0,
    "mpesa" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "staffName" TEXT,
    "systemSales" REAL NOT NULL DEFAULT 0,
    "creditSales" REAL NOT NULL DEFAULT 0,
    "paymentsReceived" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "outletId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyCollection_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyCollection_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "creditLimit" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SignedBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voucherNumber" TEXT NOT NULL,
    "billType" TEXT NOT NULL,
    "personId" TEXT,
    "personName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "serviceStaff" TEXT,
    "description" TEXT,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "outletId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignedBill_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SignedBill_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SignedBill_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signedBillId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "quantity" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillItem_signedBillId_fkey" FOREIGN KEY ("signedBillId") REFERENCES "SignedBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaidBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billRef" TEXT,
    "signedBillId" TEXT,
    "personId" TEXT,
    "payerCategory" TEXT,
    "payerName" TEXT NOT NULL,
    "amountPaid" REAL NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "notes" TEXT,
    "outletId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaidBill_signedBillId_fkey" FOREIGN KEY ("signedBillId") REFERENCES "SignedBill" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaidBill_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaidBill_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaidBill_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PettyCash" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT NOT NULL,
    "department" TEXT,
    "functionName" TEXT,
    "purpose" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL,
    "payeeName" TEXT,
    "payeeAccount" TEXT,
    "approvedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outletId" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PettyFunction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buyingPrice" REAL NOT NULL DEFAULT 0,
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "unitMeasure" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectionId" TEXT,
    "reason" TEXT NOT NULL,
    "staffName" TEXT,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "quantity" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "outletId" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cancellation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DailyCollection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Cancellation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashRecon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outletId" TEXT,
    "openingBalance" REAL NOT NULL DEFAULT 0,
    "cashDeposited" REAL NOT NULL DEFAULT 0,
    "closingBalance" REAL NOT NULL DEFAULT 0,
    "verifiedAmount" REAL,
    "verifiedBy" TEXT,
    "notes" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BankRecon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outletId" TEXT,
    "channel" TEXT,
    "reportedAmount" REAL NOT NULL DEFAULT 0,
    "openingBalance" REAL,
    "closingBalance" REAL,
    "verifiedAmount" REAL,
    "verifiedOpening" REAL,
    "verifiedClosing" REAL,
    "reason" TEXT,
    "reportedBy" TEXT,
    "verifiedBy" TEXT,
    "cashierId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT
);

-- CreateTable
CREATE TABLE "PersonCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaymentChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosTable_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "openedBy" TEXT NOT NULL,
    "closedBy" TEXT,
    CONSTRAINT "PosShift_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "printerName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosCounter_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "tableId" TEXT,
    "shiftId" TEXT NOT NULL,
    "waiterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "discount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "signedBillId" TEXT,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PosOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PosOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PosOrder_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PosOrder_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "amount" REAL NOT NULL,
    "extras" TEXT,
    "counterCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" DATETIME,
    "cancelledBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PosOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosPrintLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "counterCode" TEXT NOT NULL,
    "printedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedBy" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    CONSTRAINT "PosPrintLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosWaiterSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "waiterId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "signedInAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedOutAt" DATETIME,
    CONSTRAINT "PosWaiterSession_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PosWaiterSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosProductExtra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_name_key" ON "Outlet"("name");

-- CreateIndex
CREATE INDEX "DailyCollection_date_idx" ON "DailyCollection"("date");

-- CreateIndex
CREATE INDEX "DailyCollection_outletId_idx" ON "DailyCollection"("outletId");

-- CreateIndex
CREATE INDEX "Person_type_idx" ON "Person"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SignedBill_voucherNumber_key" ON "SignedBill"("voucherNumber");

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
CREATE INDEX "BillItem_signedBillId_idx" ON "BillItem"("signedBillId");

-- CreateIndex
CREATE INDEX "BillItem_productId_idx" ON "BillItem"("productId");

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
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PettyFunction_name_key" ON "PettyFunction"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

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
CREATE INDEX "BankRecon_date_idx" ON "BankRecon"("date");

-- CreateIndex
CREATE INDEX "BankRecon_outletId_idx" ON "BankRecon"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonCategory_code_key" ON "PersonCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannel_code_key" ON "PaymentChannel"("code");

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
CREATE INDEX "PosOrder_outletId_idx" ON "PosOrder"("outletId");

-- CreateIndex
CREATE INDEX "PosOrder_shiftId_idx" ON "PosOrder"("shiftId");

-- CreateIndex
CREATE INDEX "PosOrder_waiterId_idx" ON "PosOrder"("waiterId");

-- CreateIndex
CREATE INDEX "PosOrder_status_idx" ON "PosOrder"("status");

-- CreateIndex
CREATE INDEX "PosOrder_createdAt_idx" ON "PosOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PosOrderItem_orderId_idx" ON "PosOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PosOrderItem_productId_idx" ON "PosOrderItem"("productId");

-- CreateIndex
CREATE INDEX "PosPrintLog_orderId_idx" ON "PosPrintLog"("orderId");

-- CreateIndex
CREATE INDEX "PosWaiterSession_waiterId_idx" ON "PosWaiterSession"("waiterId");

-- CreateIndex
CREATE INDEX "PosWaiterSession_shiftId_idx" ON "PosWaiterSession"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "PosProductExtra_name_key" ON "PosProductExtra"("name");
