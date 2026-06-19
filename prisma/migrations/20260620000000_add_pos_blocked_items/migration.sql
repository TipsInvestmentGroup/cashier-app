-- CreateTable
CREATE TABLE "PosBlockedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "blockedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosBlockedItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PosBlockedItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PosBlockedItem_outletId_productId_key" ON "PosBlockedItem"("outletId", "productId");

-- CreateIndex
CREATE INDEX "PosBlockedItem_outletId_idx" ON "PosBlockedItem"("outletId");
