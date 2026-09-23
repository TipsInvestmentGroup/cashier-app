# #114 — Money `Float` → `Decimal` Migration Plan

**Status:** DRAFT for approval — no code written yet.
**Goal:** store monetary values as exact decimals instead of binary floating point, so sums, comparisons and reports no longer drift (`0.1 + 0.2 ≠ 0.3`), and the ledger is exact at rest.

This is the largest and highest-risk item in Phase 1. It is deliberately planned in full before any code lands, and gated behind a proof-of-concept spike.

---

## 1. Why this is hard (two independent problems)

### 1a. Runtime: Prisma returns `Decimal` as objects, not numbers
When a column's Prisma type is `Decimal`, Prisma Client returns a **`Prisma.Decimal` (Decimal.js) instance**, not a JS `number`. That silently breaks ordinary arithmetic:

```ts
bill.amount - paid          // Decimal - number  → NaN / "100.5undefined"
[...].reduce((s,b)=>s+b.amount,0)   // string concatenation, not a sum
a > b, Math.min(a,b)        // coerced comparisons, wrong results
```

Measured blast radius in this codebase: **~712 call sites** do raw arithmetic/comparison directly on money fields, against **619** existing `roundMoney(...)` wraps. Rewriting 712 sites by hand is both huge and error-prone.

**Mitigation (the linchpin): a Prisma Client result extension** that coerces every money field back to `number` on read. One central mapping, and all 712 sites — plus API JSON serialization to the React client — keep seeing `number`. Writes are unaffected (Prisma accepts `number | string | Decimal` when writing a `Decimal` column). Storage becomes exact; app arithmetic stays as-is, still disciplined by `roundMoney` at boundaries. Target: **exact at rest, disciplined in flight.**

> ⚠️ This entire plan depends on the result extension being able to *override* an existing scalar field's value (not just add a new computed field). **This is the #1 thing the spike must prove** (see §4). If Prisma cannot override same-named fields, we fall back to Option B in §7.

### 1b. Schema: one Prisma schema serves SQLite (dev) and Postgres (prod)
`prisma/schema.prisma` has `provider = "sqlite"`, swapped to `postgresql` at build time by [`scripts/prepare-db.mjs`](../scripts/prepare-db.mjs) based on `DATABASE_URL`. Prod deploys the schema via `prisma db push --accept-data-loss` (`vercel-build`), **not** `migrate deploy`.

Consequences:
- `Decimal` maps to `DECIMAL(65,30)` on Postgres (exact) and to a `DECIMAL`/text-backed type on SQLite via the better-sqlite3 adapter — its runtime representation (also Decimal.js) and `_sum` aggregate behavior must be verified on **both** adapters.
- The prod type change (`DOUBLE PRECISION` → `DECIMAL`) is applied by `db push`. Float→decimal is a value-preserving widening in Postgres, but `--accept-data-loss` + `db push` behaviour on a live table with data must be confirmed on a Postgres copy first (see §5).

---

## 2. Field inventory (money vs not)

210 `Float` columns across 134 distinct field names. **Only money columns migrate.** Quantities, rates, multipliers, weights, hours and pack sizes **stay `Float`** — they are not currency and several are legitimately fractional.

**Stay `Float` (NON-money — do not migrate):**
`quantity, qty, totalQty, breakageQty, buyQty, getQty, discountQty, varianceQty, quantityOrdered, quantityReceived, quantitySold, procurementQuantity, expectedQuantity, expectedSalesQty, posSalesQty, piecesReceived, stockAllocated, stockReturned, transfersIn, transfersOut, taken, receivings` (quantities) · `packSize, gramsPerServing, unit` (units) · `hoursWorked, overtimeHours, days, accrualDaysPerMonth` (time) · `vatRate, employeeRate, employerRate, weekendMultiplier, eveningWeight, morningWeight` (rates/multipliers).

**Migrate to `Decimal` (MONEY):** everything else — `amount, amountPaid, paidAmount, total, totalAmount, subtotal, net, gross, cash, crdb, stanbic, mpesa, mobileMoney, bank, debit, credit, glBalance, buyingPrice, sellingPrice, unitPrice, unitCost, price, newPrice, oldPrice, bundlePrice, eventPrice, vatAmount, discount, discounts, openingBalance, closingBalance, currentBalance, statementBalance, creditLimit, creditLimitOverride, maxCredit, maxLimit, minLimit, ceiling, floor, spendingLimit, dailyLimit, lowBalanceThreshold, approvalThreshold, salesTarget/salesTotal/salesCollection/salesAttributed, systemSales, verified*, signed*, paidBills*, totalNet/totalGross/totalDeductions/totalEmployerCost/employerCost, baseSalary, taxable, pensionable, valueLost, totalLossValue, varianceValue, value, actualValue, targetValue, sponsorshipValue, estimatedCost, allocatedAmount, expectedAmount, reportedAmount, receivedAmount, excessAmountPaid, settledAsSourceAmount, officialCollection, collectionDifference, cashDeposited, depositPaid, avgTransactionValue, maxCarryForward, weeklyTarget, dailyLoss, accrued, closingPhysical/closingSystem, verifiedOpening/verifiedClosing, ...`.

> **Deliverable of Phase 1 below:** a reviewed, exhaustive money/non-money classification of all 134 names (a few are genuinely ambiguous — `taxable`, `pensionable`, `value`, `unit`, `taken` — and must be confirmed against their model before migration).

---

## 3. Recommended architecture

1. **Schema:** change money columns `Float` → `Decimal`. Non-money stay `Float`.
2. **Read coercion:** a single generated Prisma result extension in [`lib/prisma.ts`](../lib/prisma.ts) maps every money field → `.toNumber()` on read, so the app and API responses keep returning `number`.
3. **Write discipline (unchanged):** continue calling `roundMoney(...)` before writes; Prisma stores the exact 2dp decimal.
4. **Codegen, not hand-maintenance:** a small script reads the schema, collects all `Decimal` fields per model, and emits the extension map + the migration/backfill helpers — so the money-field list has one source of truth and new money fields are picked up automatically.

---

## 4. GATE — proof-of-concept spike (do this first, alone)

Do **not** start the bulk migration until this spike passes on a throwaway branch. Migrate **one** model with a couple of money fields (e.g. `PaidBill.amountPaid`, or a synthetic table) and prove, on **both** adapters:

- [ ] The result extension **overrides** the scalar field so `typeof row.amount === 'number'` (the critical unknown).
- [ ] `prisma.model.aggregate({ _sum })` returns correct exact totals for `Decimal` on SQLite **and** Postgres.
- [ ] Writing a JS `number` to a `Decimal` column works and round-trips exactly.
- [ ] `NextResponse.json(row)` serializes the money field as a JSON number (not a string), so client components/`formatCurrency` are unaffected.
- [ ] `prisma db push` applies `DOUBLE PRECISION → DECIMAL` on a **Postgres copy** with existing rows, values preserved.
- [ ] `orderBy` and `where` numeric filters behave on `Decimal` on both adapters.

If the extension cannot override same-named fields → switch to §7 Option B before proceeding.

---

## 5. Phased execution (after the gate passes)

- **P0 — Classification & codegen.** Finalize the money/non-money list (§2). Write the schema-reading codegen for the extension map + a reusable `assertReconciles()` check.
- **P1 — Extension first, still `Float`.** Land the result extension keyed on the (soon-to-be) money fields while columns are still `Float` (coercing a number→number is a harmless no-op). This de-risks the wiring independently of the type change.
- **P2 — Flip columns in tranches by domain**, smallest/most-isolated first, each its own PR with the reconciliation diagnostic run before/after:
  1. Inventory & products (`buyingPrice, sellingPrice, unitCost, unitPrice, price*`)
  2. Collections & reconciliation (`cash, crdb, stanbic, mpesa, total, systemSales, discount, excess*`)
  3. Receivables/bills (`amount, amountPaid, paidAmount, creditLimit*`)
  4. Ledger (`debit, credit, glBalance`) — **highest care**
  5. Expenses & funds (`currentBalance, openingBalance, dailyLimit, allocatedAmount, ...`)
  6. Payroll (`baseSalary, net, gross, totalDeductions, employerCost, taxable, pensionable, ...`)
  7. Banking, budgets, targets, remainder
- **P3 — Sweep** for any remaining raw-Decimal leakage (grep for `.toNumber`, any field the extension missed), and remove now-redundant defensive `Number(...)` wraps only where safe.

Each tranche: change columns → `db push` to dev SQLite → run [`scripts/reconcile-subledgers-to-gl.ts`](../scripts/reconcile-subledgers-to-gl.ts) → run the app's money-touching flows in the preview → confirm trial balance still balances and the diagnostic variances are unchanged.

---

## 6. Deployment mechanics & rollback

- **Confirm the prod path first:** `vercel-build` uses `db push --accept-data-loss`; `build:production` uses `migrate deploy`. Establish which one prod actually runs and make the type change go through a **reviewed migration** if at all possible (safer than `db push` on money columns).
- **Backup before prod apply.** Take a full Postgres backup/snapshot immediately before the deploy that flips columns.
- **Value preservation:** `DOUBLE PRECISION → DECIMAL` keeps values; run `reconcile-subledgers-to-gl.ts` against a **prod copy** post-conversion and compare account balances to pre-conversion.
- **Rollback:** the reverse type change (`DECIMAL → DOUBLE PRECISION`) is also value-preserving; keep the down-migration ready. The result extension is inert when columns are `Float`, so app code rolls back cleanly with the schema.

---

## 7. Fallback options (if the gate fails)

- **Option B — serialization boundary.** If result-extension override is unsupported: keep `Decimal` in the DB, and coerce at the API/`NextResponse.json` boundary + a small typed read helper, rather than field-by-field. Larger touch than the extension, smaller than rewriting 712 sites.
- **Option C — integer minor units.** Store money as `Int` cents. Most invasive (all arithmetic scales by 100, schema + all reads/writes change); not recommended given the `roundMoney` discipline already in place.

---

## 8. Effort & recommendation

- **Spike (§4):** ~0.5–1 day. **Decides feasibility.**
- **Full migration (§5):** large — spread across ~7 tranche PRs, each independently verifiable.
- **Risk:** high (touches every money-bearing table and the ledger) but **contained by** the result-extension mitigation, per-tranche PRs, and the reconciliation diagnostic as an objective before/after gate.

**Recommendation:** approve the **spike only** as the next step. Its result (does the extension override scalars on both adapters?) determines whether the full plan proceeds as written (Option A) or pivots to Option B — and that answer is cheap to get before committing to the large migration.
