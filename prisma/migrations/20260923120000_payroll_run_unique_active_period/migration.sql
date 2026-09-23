-- #102 — Prevent a payroll period from being run and paid twice.
--
-- Enforce at most ONE live (non-reversed) payroll run per scope + period, so a
-- double-click / retry / concurrent create cannot produce two postable runs for
-- the same workforce and period (which would double-post salary expense,
-- statutory liabilities and the payout batch).
--
-- Notes:
--  * Partial on status: a REVERSED run may coexist with the correction that
--    replaces it, so only non-reversed rows participate in the constraint.
--  * COALESCE on the nullable scope columns: a company-wide run has NULL
--    outletId and NULL payGroupId, and Postgres treats NULLs as DISTINCT, so a
--    plain unique index would not catch two company-wide duplicates. Coalescing
--    to '' makes them collide.
--  * The application also pre-checks in lib/payroll-run.ts createPayrollRun();
--    this index is the race-safe backstop and surfaces as Prisma P2002.
--
-- If a target database already holds duplicate live runs, void the extras first
-- (scripts/dedupe-payroll-runs.ts) — otherwise this index creation will fail.
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_active_period_scope_key"
  ON "PayrollRun" ("companyId", COALESCE("outletId", ''), COALESCE("payGroupId", ''), "periodKey")
  WHERE "status" <> 'REVERSED';
