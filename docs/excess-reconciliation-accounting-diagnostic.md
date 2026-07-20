# Excess Management & Reconciliation — Accounting Diagnostic

Status: **diagnostic + redesign proposal** (objective #6 of the refactor brief). No
code changed yet. Produced from a read-only audit of the current implementation on
2026-07-21. Grounded against `dev.db` and the live-environment screenshots.

## The core problem in one sentence

The app funnels three economically different things — **reconciliation differences**,
**money owed TO the company (receivables)**, and **money owed BY the company
(payables)** — through one "Excess" pipeline that settles by bumping a `paidAmount`
column and writing an audit log, **never posting to the General Ledger**, so cash
movements and liabilities are invisible to Finance and the reported "Cash in Hand" is
overstated whenever cash is paid out for anything other than petty cash.

## Concept map — current vs. intended

| Economic concept | Current storage | Intended (brief) |
|---|---|---|
| Reconciliation difference (collected vs system; verified cash vs expected) | Collection: `CollectionExcess`(over) / `SignedBill STAFF_LOSS`(short). Cash-recon over/short: **not stored at all** | A first-class *Reconciliation Difference* that must be **classified** before settle |
| Receivable (owed to company) | `SignedBill billType=STAFF_LOSS` → payroll; `StockLossAttribution` (orphaned) | Explicit **Receivable** class → AR/GL |
| Payable (owed by company) | Split across `CollectionExcess/CashReconExcess` (PAYABLE_EXCESS), `ExcessRefund`, supplier AP — **not unified, mostly off-GL** | Explicit **Payable** class → AP/GL |
| Adjustment / investigation | `NON_PAYABLE` audit-only rows | **Adjustment** reconciling items (no cash, but visible) |

---

## Diagnostic findings

Severity: **Critical** = wrong money numbers / untracked cash or liability;
**High** = correctness gap with financial impact; **Medium** = integrity/UX risk;
**Low** = hardening.

### D1 — Cash paid out for refunds/excess settlements is missing from Cash in Hand — **Critical**
- **Issue:** `cashInHand = collection.cash + paidCash − pettyApproved` subtracts only approved petty cash. Cash refunds (`ExcessRefund`) and cash excess settlements (`settle-batch`) are never queried, so the till figure is overstated by every non-petty cash payout.
- **Root cause:** `app/api/reports/daily-report/route.ts:98` reads only 5 models; no excess/refund outflow term.
- **Affected:** Daily Report, Excess Recon, Excess Refunds, Cash Reconciliation.
- **Fix:** Add cash-method payable settlements + refunds as an outflow term; show them as a separate "Settlements paid from till" line, distinct from operational collections.

### D2 — Settlements, refunds, staff-loss recovery, and petty cash post nothing to the GL — **Critical**
- **Issue:** Real cash movements exist with no `JournalEntry`, so the GL Cash account can never reconcile to physical cash, and liabilities/expenses are never recognized.
- **Root cause:** `app/api/excess-recon/settle-batch/route.ts:53`, `app/api/excess-refunds/[id]/route.ts:21`, `app/api/payroll-deductions/run/route.ts`, and all of `app/api/petty-cash/**` update status/columns + `AuditLog` only — no `postJournalEntry` call.
- **Affected:** Finance, General Ledger, Financial Statements, Daily Report, Petty Cash.
- **Fix:** Post a journal entry at each settlement/refund/recovery through the existing `lib/ledger.ts` choke point; add the missing account keys (petty-cash expense, tips-payable, customer-refund-payable, cash-over/short).

### D3 — Customer Excess & Staff Tip are locked to NON_PAYABLE in production (data drift) — **Critical**
- **Issue:** Money the company owes back (customer overpayment) and owes to staff (tips) is treated as **audit-only** in the live environment — no obligation is tracked, cash that belongs to others is silently absorbed. Live screenshots show both as "Non-Payable (audit only)"; `dev.db` has them as `PAYABLE_EXCESS`.
- **Root cause:** create-only seed (`lib/excess-reasons-db.ts:17`, `update:{}`) left prod at the old `NON_PAYABLE` schema default; the reserved-code guard (`app/api/excess-reasons/[id]/route.ts:29`) then **blocks correcting it in the UI**.
- **Affected:** Excess Recon, Collections, Payables, Finance.
- **Fix:** One-time migration to set the correct class for reserved codes in every environment; loosen the guard so an owner can re-classify a reserved code with an audit entry (or ship the correct class as data, not a locked default).

### D4 — Payables are fragmented across three unlinked stores, mostly off-GL — **High**
- **Issue:** A customer overpayment can exist as both a `CollectionExcess/CashReconExcess` (PAYABLE_EXCESS) row **and** an `ExcessRefund`, with no link between them and neither hitting AP/GL. There is no single payables balance; the Finance AP page shows supplier debt only.
- **Root cause:** Two parallel excess tables + a separate refund model, none with a `journalEntryId`; `app/finance/payables/page.tsx` reads supplier data only.
- **Affected:** Payables, Finance, Financial Statements.
- **Fix:** Route every payable-classified difference (and refund) through one settlement path that posts to AP/GL and surfaces on the AP page.

### D5 — The cash-reconciliation over/short is never stored — **High**
- **Issue:** `CashRecon` keeps `verifiedAmount` and `closingBalance` as separate columns with **no over/short field**. The headline number of a cash reconciliation is not persisted, classified, or carried anywhere.
- **Root cause:** `prisma/schema.prisma:1600` (`CashRecon`) has no `variance`/`difference`/classification columns.
- **Affected:** Cash Reconciliation, Daily Report, Finance.
- **Fix:** Store the computed variance + a classification (Receivable/Payable/Adjustment) on the recon, feeding the same settlement pipeline.

### D6 — Sales Revenue may be double-counted (recognition-basis mismatch) — **High**
- **Issue:** Daily Collections credits `SALES_REVENUE` on **money collected** (cash + digital), while credit sales credit `SALES_REVENUE` on **accrual** when a bill is signed; the later receipt only relieves AR. A credit sale that is later paid and swept into a day's collected total can be recognized twice.
- **Root cause:** `app/api/collections/route.ts:332` posts revenue off collected total, not `systemSales`; `lib/finance-ar.ts:57` posts revenue on accrual.
- **Affected:** Finance, General Ledger, Financial Statements, Daily Report.
- **Fix:** Pick one recognition basis. Recommended: recognize revenue on `systemSales` (accrual), and treat collections purely as cash-in relieving AR / clearing the day — so the two paths stop overlapping. (Needs confirmation of how cashiers key collected totals vs debt receipts.)

### D7 — Approved refund is indistinguishable from unpaid; never records the payout — **Medium**
- **Issue:** `ExcessRefund` carries only `approvalStatus` — no `paidAmount`, no `paidAt`, no `journalEntryId`. An approved refund looks identical to one not yet paid.
- **Root cause:** `prisma/schema.prisma:1906` (model shape); `app/api/excess-refunds/[id]/route.ts` flips a flag only.
- **Affected:** Excess Refunds, Finance, Daily Report.
- **Fix:** Add settlement fields + GL posting to the refund lifecycle (folds into D2/D4).

### D8 — Differences can be settled while unclassified ("Needs reason" / UNASSIGNED) — **Medium**
- **Issue:** `syncCollectionExcessTotal` creates payable rows with reason `UNASSIGNED`; the Pay endpoints never check the reason, so money can be paid out against an unclassified row.
- **Root cause:** `lib/collection-excess.ts:72`; `app/api/excess-recon/[id]/route.ts` + `settle-batch` don't validate classification before settling.
- **Affected:** Excess Recon, Finance, Audit.
- **Fix:** Block settlement until the difference is classified into Receivable/Payable/Adjustment with a valid reason.

### D9 — "Others" vs "Other" — near-identical labels, opposite treatment — **Medium**
- **Issue:** `OTHERS` → PAYABLE_EXCESS and `OTHER` → NON_PAYABLE both exist; a cashier can easily pick the wrong one, routing money to a settle-able payable vs an audit-only write-off.
- **Root cause:** `lib/excess-reasons.ts:23,34`.
- **Affected:** Collections, Excess Recon.
- **Fix:** Merge/rename; require an explicit class choice rather than relying on look-alike labels.

### D10 — Two different economic events merged in one ledger (double-count risk) — **Medium**
- **Issue:** `CashReconExcess` ("excess paid **out** of the till" — a disbursement) and `CollectionExcess` ("collected **more** than required" — an overage) are unioned into one Excess Recon view as if interchangeable; the same money can appear twice.
- **Root cause:** `app/api/excess-recon/route.ts:41-97` merges both tables.
- **Affected:** Excess Recon, Finance.
- **Fix:** Model them as distinct event types; never sum them into one balance without a transfer link.

### D11 — Report `paidCash` diverges from GL receipts — **Medium**
- **Issue:** The report counts all CASH-method `PaidBill`s, but `postReceipt` only posts receipts tied to a `signedBillId` whose credit sale was itself posted. Unlinked/unposted receipts inflate cash-in-hand relative to the GL.
- **Root cause:** `app/api/reports/daily-report/route.ts:87` vs `lib/finance-ar.ts:82`.
- **Affected:** Daily Report, Finance.
- **Fix:** Reconcile the two definitions; post all cash receipts (see D2/D6).

### D12 — `StockLossAttribution` is orphaned from the receivable/payroll path — **Medium**
- **Issue:** Stock-count losses attributed to a staff member never become `SignedBill` debts or payroll deductions — only the collections "Staff Loss" path does.
- **Root cause:** `prisma/schema.prisma:1530` has no link to `SignedBill`/payroll.
- **Affected:** Receivables, Inventory, Payroll.
- **Fix:** Feed stock-loss attributions into the same Receivable class.

### D13 — Two divergent definitions of "receivable" — **Medium**
- **Issue:** The operational Receivables page includes `STAFF_LOSS`; GL AR (finance-ar/dashboard) excludes it, so the two AR figures disagree by design.
- **Root cause:** `lib/finance-receivables.ts:11` (no billType filter) vs `CREDIT_BILL_TYPES` excluding STAFF_LOSS.
- **Affected:** Receivables, Finance.
- **Fix:** Decide whether staff-loss is AR or a separate "staff advances/receivable" account; make both views agree.

### D14 — API accepts STAFF_LOSS category for non-reserved custom reasons — **Low**
- **Issue:** The write whitelist allows `STAFF_LOSS`; a direct API call could create a non-reserved reason that auto-generates staff-debt bills, bypassing the single-reserved-code intent.
- **Root cause:** `app/api/excess-reasons/route.ts:28`; dispatcher branches on category not code (`app/api/collections/route.ts:258`).
- **Affected:** Collections, Receivables.
- **Fix:** Reject `STAFF_LOSS`/`RECEIVABLE` class for non-reserved codes.

### D15 — Category is a mutable snapshot; historical rows don't re-stamp — **Low**
- **Issue:** Re-categorizing an `ExcessReason` doesn't update existing rows (by design), so a row's `category` can drift from the reason's current meaning.
- **Root cause:** snapshot columns `prisma/schema.prisma:1629,1660`.
- **Affected:** Excess Recon, reporting.
- **Fix:** Acceptable if intentional; document it and surface the as-recorded class in the UI.

### D16 — Payable/non-payable excess row creation writes no per-row audit — **Low**
- **Issue:** Only the STAFF_LOSS branch writes an `AuditLog`; PAYABLE_EXCESS/NON_PAYABLE rows are created silently.
- **Root cause:** `app/api/collections/route.ts:266` vs `:299`.
- **Affected:** Audit trail.
- **Fix:** Write an audit row for every classified difference.

### D17 — No petty-cash expense account exists in the chart of accounts — **Low**
- **Issue:** There is no petty-cash `EXPENSE` key in `DEFAULT_ACCOUNTS`, so even if petty cash posted to the GL there's no account to hit.
- **Root cause:** `lib/finance-accounts-defaults.ts` account list.
- **Affected:** Finance, Petty Cash.
- **Fix:** Add the account keys needed by D2.

---

## Proposed redesign — the three-category model

**Reconciliation Difference** is the *event*. Every difference (collection variance,
cash-recon over/short) must be **classified** before it can be settled, into exactly
one of:

- **Receivable** — owed TO the company. Settlement = collection (cash receipt or
  payroll deduction). GL: Dr Cash/AR-control, Cr the difference-clearing/AR account.
- **Payable** — owed BY the company. Settlement = payout (cash or transfer). GL:
  Dr the payable/clearing account, Cr Cash/Bank.
- **Adjustment / Investigation** — a reconciling item that explains the difference
  but moves no third-party money (discount, cancellation, transfer error, cash
  over/short pending investigation). Visible, audited, may post a variance entry, but
  is not a settle-able obligation.

### Proposed reason → class mapping

| Reason | Today (prod) | Proposed class | Rationale |
|---|---|---|---|
| Staff Loss | STAFF_LOSS | **Receivable** | Staff owes the company |
| Cash Shortage (recon short) | *not modeled* | **Receivable** (→ investigate) | Missing cash owed to company |
| Customer Excess / Overpayment | NON_PAYABLE ⚠️ | **Payable** | Company owes the customer a refund |
| Duplicate Payment | *ad-hoc refund* | **Payable** | Company owes it back |
| Staff Tip | NON_PAYABLE ⚠️ | **Payable** *(confirm)* | Tips are owed to staff — unless treated as pass-through |
| Kitchen Sales | PAYABLE_EXCESS | **Payable / transfer** *(confirm)* | Depends: inter-dept transfer vs revenue |
| Cash Over (recon over) | *not modeled* | **Adjustment** (→ investigate) | Unexplained surplus, investigate before booking |
| Signed Bill / Cancellation / Discount / Complimentary / Walk Away / Transfer Error | NON_PAYABLE | **Adjustment** | Explains the variance; no third-party money |

### Phased implementation plan (each phase independently shippable)

1. **Data model** — add a `variance` + `classification` to `CashRecon`; add `paidAmount`/`paidAt`/`journalEntryId` to `ExcessRefund`; add the missing GL account keys. Migration to correct reserved-code classes (D3).
2. **Classification gate** — require Receivable/Payable/Adjustment on every difference before settle; block settling UNASSIGNED (D8); tighten reason API (D14).
3. **GL integration** — post journal entries on every settlement/refund/recovery/petty-cash through `lib/ledger.ts` (D2, D7, D17); reconcile revenue recognition (D6, D11).
4. **Cash in Hand** — add the settlement-outflow term and a separate "settlements paid from till" line; introduce Cash-in-Safe if wanted (D1).
5. **Unify payables/receivables** — one settlement path feeding AP/AR + Finance pages; wire in stock-loss attributions (D4, D12, D13).
6. **Self-diagnostic endpoint** — a read-model that re-runs these checks on live data (invalid class mappings, receivable-as-payable, off-GL settlements, cash-in-hand mismatches) and renders this report shape on demand.

### Design rules honored

No hardcoded reason types (reasons stay data-driven); category taxonomy becomes the
fixed accounting primitive (Receivable/Payable/Adjustment) that reasons map onto;
every settlement posts to the GL and writes audit; multi-company via the existing
scope convention; complete audit trail preserved; one consistent set of numbers across
dashboards, reports, reconciliation, Finance, and the GL.
