# Multi-company programme — Phase 3: company on every tenant-owned table (EXPAND half)

Builds on Phase 2 (`MULTI-TENANT-PHASE2.md`). Phase 3 follows **expand → backfill → verify → contract**. This change
is the first three; the **contract** (NOT NULL, foreign keys, unique-key swaps) is prepared but intentionally not
applied — it needs the production-database and cut-over answers (decisions D9, D10).

## What this change does
| Step | Delivered |
|---|---|
| Classify every model | `lib/tenancy-registry.ts`: of 186 models — **60 tenant roots** (get a column), 64 children (inherit via parent), 14 scoped-config, 7 identity, 1 deferred (`Setting`), the rest already company-native. `npm run check:tenancy` (now in CI) fails if any model is unclassified or a root lacks its column/index. |
| Expand (additive migration `20261014100000_tenant_company_columns_expand`) | A nullable `companyId TEXT` + index on each of the 60 roots. Exactly 60 `ADD COLUMN` + 60 `CREATE INDEX`; no drops, no constraints, no value changes. Metadata-only in Postgres. |
| Backfill (`lib/tenant-backfill.ts`) | Fill-only, idempotent, plain SQL (identical on Postgres and SQLite). Outlet-owned rows take their outlet's company; journal lines their entry's; write-offs their bill's outlet; audit/notification/permission rows their user's membership; shared masters/counters the original company. Anything with no resolvable outlet/parent falls back to the original company (what the old "default company" code already did) and is **counted separately** for review. Runs in the deploy seed on every deploy and can never fail a deploy. |
| Stamp new rows (`lib/tenant-stamp.ts`, wired in `lib/prisma.ts`) | Every `create` / `createMany(AndReturn)` / `upsert` of a root table is stamped: explicit value (never overridden) → the row's outlet's company → the session company. Covers all ~370 routes, crons and libs with no per-route edits. Journal lines are stamped in `postJournalEntry`. Emergency switch: `TENANT_STAMP=off`. |
| Session company reaches the guard | `proxy.ts` deletes any client-sent `x-tenant-company` header on every `/api` request and sets it only from a verified token. Tested: a forged header is ignored. |
| Verification gate | `scripts/tenancy-census.ts` (read-only by default; `--apply` runs the backfill): per-table NULL / by-owner / by-fallback counts; exit 0 = every row assigned. |
| Contract, prepared | `scripts/gen-tenancy-contract-sql.ts` prints the SQL (NOT NULL + FK on all roots, `Outlet.companyId`, `Company.slug`) generated from the registry, with an abort-if-any-NULL gate. **Not a migration; nothing runs it.** |

## Operating it
```bash
# what would the backfill do on production? (read-only)
DATABASE_URL=<prod url> npx tsx scripts/tenancy-census.ts
# the deploy seed applies it automatically; to apply by hand:
DATABASE_URL=<prod url> npx tsx scripts/tenancy-census.ts --apply
```
Review the **byFallback** column: those rows had no resolvable outlet/parent (e.g. an event with no outlet) and were given
the original company. For TIPS (one company) that is correct by definition; it matters once a second company exists.

Rollout order is forgiving: the migration only adds nullable columns, so old app code keeps working; the backfill can run
before or after; new rows are stamped from the first request of the new code. If anything misbehaves, set `TENANT_STAMP=off`
(rows then arrive unstamped and the next backfill assigns them); promoting the previous deployment is also safe.

## Not in this change — remaining Phase 3 steps (in order)
1. **3e Unique-key swaps.** Per-company uniqueness for `Outlet.name`, `Product.code`, `Supplier.name`, `Warehouse.name`,
   `Department.name`, `PaymentChannel.code`, `PersonCategory.code`, `Person[type,code]`, `RolePermission`, document numbers
   (`PosOrder.orderNo`, PO/GRN/TRF numbers, `JournalEntry.entryNumber`, bill references…). Needs every `findUnique({where:{code}})` /
   `upsert` call site rewritten to the composite key (the compiler lists them) — a code change, so it follows the contract.
2. **3f Per-company numbering.** Counters keyed by company (`BillSequenceCounter`, `ExpenseRequestSequence`, `count()+1` PO/GRN/TRF numbers → race-safe counters).
3. **3g `Setting` → per-company.** Key redesign to `(companyId, key)` + a `CompanyConfig` (branding, currency, VAT, receipt text); move the 15 keys; per-company caches.
4. **3h Contract.** Apply `scripts/gen-tenancy-contract-sql.ts` as a reviewed migration together with `schema.prisma` (`String?` → `String`), after: census READY across a soak period, a clone-of-production rehearsal, and an agreed TIPS window.

## Still true: do NOT onboard a second company yet
Columns now exist and are filled and stamped, but **reads are not yet filtered by company** outside the ~45 routes migrated in
Phase 2. Phase 4 enforces company scoping module by module (and the company-aware Prisma read guard).
