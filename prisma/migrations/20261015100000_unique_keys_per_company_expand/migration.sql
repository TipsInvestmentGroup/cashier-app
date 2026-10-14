-- Multi-company programme, Phase 3 step 3e (EXPAND) - per-company unique keys.
-- ADDS 17 unique indexes that include "companyId" (e.g. ("companyId","code") on Product, PaymentChannel, BillTypeConfig ...;
-- ("companyId","name") on Outlet, Department, Warehouse, Supplier ...; ("companyId","type","code") on Person;
-- ("companyId","role","resource") on RolePermission; ("companyId","userId","resource") on UserPermission).
-- The OLD global unique indexes are deliberately KEPT in this migration: production never has a window where running
-- code depends on an index that no longer exists (an old-code upsert on a dropped unique would fail). The old keys are
-- dropped by the separate CONTRACT migration, shipped in a later deploy once this code is live.
-- Safe on existing data: the new keys are strictly weaker than the old global ones (every existing row already satisfies them),
-- and Postgres treats NULL company values as distinct, so not-yet-assigned rows can never conflict.
-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_companyId_userId_resource_key" ON "UserPermission"("companyId", "userId", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_companyId_name_key" ON "Outlet"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_companyId_role_resource_key" ON "RolePermission"("companyId", "role", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTemplate_companyId_code_key" ON "CollectionTemplate"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Person_companyId_type_code_key" ON "Person"("companyId", "type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_name_key" ON "Department"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PettyFunction_companyId_name_key" ON "PettyFunction"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_code_key" ON "Product"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_companyId_code_key" ON "ProductCategory"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_companyId_name_key" ON "Warehouse"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_name_key" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PersonCategory_companyId_code_key" ON "PersonCategory"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannel_companyId_code_key" ON "PaymentChannel"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReason_companyId_code_key" ON "CancellationReason"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExcessReason_companyId_code_key" ON "ExcessReason"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BillTypeConfig_companyId_code_key" ON "BillTypeConfig"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PosProductExtra_companyId_name_key" ON "PosProductExtra"("companyId", "name");
