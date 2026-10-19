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

## 3e Per-company unique keys — DONE (two PRs: expand, then contract)
Master-data names/codes are now unique **per company** instead of across the whole database, for 17 keys: `Outlet.name`,
`Department.name`, `PettyFunction.name`, `Product.code`, `ProductCategory.code`, `Warehouse.name`, `Supplier.name`,
`PersonCategory.code`, `PaymentChannel.code`, `CancellationReason.code`, `ExcessReason.code`, `BillTypeConfig.code`,
`PosProductExtra.name`, `CollectionTemplate.code`, `Person[type,code]`, `RolePermission[role,resource]`,
`UserPermission[userId,resource]` — each becomes `[companyId, …]`.

- **Expand PR** (`20261015100000_unique_keys_per_company_expand`): adds the 17 per-company unique indexes **alongside** the
  old global ones, and moves every lookup/upsert to the per-company key (`companyKey()` in `lib/tenant.ts` gives the
  current company, or the original company in scripts/cron). Behaviour for TIPS is unchanged: the old keys still apply,
  so nothing that was rejected before is accepted now. Seed (`lib/seed-core.ts`) creates the company and assigns
  pre-existing rows to it *before* its keyed upserts, so re-seeding an existing database creates no duplicates.
  The index build fails only if two rows of the same company already share a name/code — impossible while the global
  key is in force.
- **Contract PR**: drops the 17 old global indexes. Only after this can a second company reuse a name/code that TIPS
  uses ("Main", "CASH", "Bar"…). Until then the nine "seed defaults on first use" screens (bill types, bill-reference
  config, cancellation reasons, departments, excess reasons, functions, payment channels, person categories,
  excess-loss report) return HTTP 500 for a second company because its defaults collide with TIPS's codes.
  Verified in the contract state: guard test 66/66 (62/62 in expand), leak crawl of 205 GET routes as TIPS and as a
  second company: 0 leaks either way, those nine screens 500 → 200, no other status changes.
- Rollback: expand — revert the code (indexes are harmless); contract — recreate the 17 global indexes (they rebuild
  only while no two companies share a code).

## 3f Per-company document numbering — EXPAND done (contract PR follows)
Every human-readable document number now comes from a counter row keyed by **(company, scope)** — `lib/doc-numbering.ts`
over the existing `BillSequenceCounter` / `ExpenseRequestSequence` tables — so each company has its own sequences.

| Document | Format (unchanged) | Before | Now |
|---|---|---|---|
| Journal entry | `JE-000001` | one database-wide counter `JOURNAL_ENTRY` | per company (the original company keeps its row) |
| Supplier invoice / payment | `INV-` / `PAY-000001` | database-wide counters `SEQ:INV` / `SEQ:PAY` | per company |
| PO / GRN / stock transfer | `PO-` / `GRN-` / `TRF-000001` | `count()+1` — **not race-safe** | per-company counter `SEQ:PO` … seeded from the documents already issued |
| POS order | `ORD-YYYYMMDD-NNN` | daily `count()+1` + retry | per-company daily counter `POS_ORDER:<date>` in the order's transaction |
| Expense request | `EXP-YYYYMMDD-<BRANCH>-NNNN` | per-branch counter, database-wide | per company + branch |
| Bill references / person codes | internal `B-YYYYMMDD-NNNNNN`, configured display ref, person code | database-wide `INTERNAL:<day>`, `BT:<type>…`, `PERSONCODE:<type>` | per company |

- **Original company (TIPS) continues exactly**: same formats, no reset, no gap. Its existing counter rows are reused (a row
  still without a company is adopted, never duplicated); a series that was `count()+1` starts its counter from the larger of the
  documents' count and the highest number issued — the next number is what `count()+1` would have given, and a deleted document
  can never cause a number to be re-issued.
- **Race-safe**: the increment is one atomic `UPDATE … RETURNING` (row-locked until the caller's transaction ends); first use inserts
  with `INSERT … ON CONFLICT DO NOTHING`. Nothing in the path can fail inside the caller's transaction (on Postgres a failed statement
  would abort it). The number is drawn in the same transaction as the document, so a rolled-back document leaves no gap. Bill
  references check the registry before inserting instead of relying on a failing insert. PO/GRN/TRF and POS orders also skip a
  number that already exists (e.g. issued by the previous app version mid-deploy) and resynchronise the counter.
- Documents are stamped with their company at creation (PO from its first outlet, GRN from its PO — previously set only after
  receipt — transfer and POS order from their outlet).
- **Not changed, on purpose**: event booking numbers (`TKT-`/`TBL-` + 8 random characters; looked up on a public page with no
  company, so they must stay unique across the database), `autoKey`/`billRef` (they embed record ids), `StaffTransaction.referenceKey`
  (already company-prefixed), product/account codes (3e).
- **Expand PR** (`20261016100000_document_numbers_per_company_expand`): 21 unique indexes `("companyId", scopeKey)` on the two counter
  tables and `("companyId", number)` on JournalEntry, SupplierInvoice, SupplierPayment, PurchaseOrder, Grn, StockTransfer, PosOrder,
  ExpenseRequest, and internalBillId/displayReference on SignedBill (+ voucherNumber), PaidBill, Breakage, ExcessRefund,
  BillReferenceRegistry. Old global indexes kept; the new keys are strictly weaker, so the build cannot fail on existing data.
  Until the contract, a second company cannot draw from a scope TIPS already uses (it gets a clear "pending database migration"
  error — never a duplicate number).
- **Contract PR**: drops the 25 global indexes (CashReconExcess/CollectionExcess have no company column: their own unique becomes a
  plain index and the registry, written in the same transaction, enforces per-company uniqueness). Deploy only after the expand PR.
- Verified: guard test — 93 checks in the expand state, 100 in the contract state, including TIPS continuity per series, concurrent first use,
  rollback/no-gap, self-healing after an out-of-band number, and the real POS route.

## Not in this change — remaining Phase 3 steps (in order)
1. **3g `Setting` → per-company.** Key redesign to `(companyId, key)` + a `CompanyConfig` (branding, currency, VAT, receipt text); move the 15 keys; per-company caches.
2. **3h Contract.** Apply `scripts/gen-tenancy-contract-sql.ts` as a reviewed migration together with `schema.prisma` (`String?` → `String`), after: census READY across a soak period, a clone-of-production rehearsal, and an agreed TIPS window.

## Still true: do NOT onboard a second company yet
Columns now exist and are filled and stamped, but **reads are not yet filtered by company** outside the ~45 routes migrated in
Phase 2. Phase 4 enforces company scoping module by module (and the company-aware Prisma read guard).
