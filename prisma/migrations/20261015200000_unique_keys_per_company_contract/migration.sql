-- 3e CONTRACT: drop the old database-wide unique keys; the per-company [companyId, ...] keys added by
-- 20261015100000_unique_keys_per_company_expand stay. After this a second company can reuse TIPS's names/codes.
-- Rollback: recreate these indexes (succeeds only while no two companies share a name/code).

-- DropIndex
DROP INDEX "UserPermission_userId_resource_key";

-- DropIndex
DROP INDEX "Outlet_name_key";

-- DropIndex
DROP INDEX "RolePermission_role_resource_key";

-- DropIndex
DROP INDEX "CollectionTemplate_code_key";

-- DropIndex
DROP INDEX "Person_type_code_key";

-- DropIndex
DROP INDEX "Department_name_key";

-- DropIndex
DROP INDEX "PettyFunction_name_key";

-- DropIndex
DROP INDEX "Product_code_key";

-- DropIndex
DROP INDEX "ProductCategory_code_key";

-- DropIndex
DROP INDEX "Warehouse_name_key";

-- DropIndex
DROP INDEX "Supplier_name_key";

-- DropIndex
DROP INDEX "PersonCategory_code_key";

-- DropIndex
DROP INDEX "PaymentChannel_code_key";

-- DropIndex
DROP INDEX "CancellationReason_code_key";

-- DropIndex
DROP INDEX "ExcessReason_code_key";

-- DropIndex
DROP INDEX "BillTypeConfig_code_key";

-- DropIndex
DROP INDEX "PosProductExtra_name_key";
