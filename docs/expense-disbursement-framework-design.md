# Universal Expense & Disbursement Management Framework — Design

**Status:** Design only — nothing built yet. This document is the pre-implementation
architecture pass; Phase 1 scope is proposed at the end for sign-off before any code.
**Author:** Solution architecture pass, 2026-07-23.

An industry-agnostic, admin-configurable expense/disbursement module. The goal:
"Petty Cash Request", "Site Expense Request", "Activity Funding Request", "Purchase
Expense Request" and their categories, funding sources, and payment methods become
**configuration, not code** — so restaurants, construction sites, NGOs, retailers,
hotels, hospitals, schools, and logistics companies are supported without source
changes.

## Guiding principle

**Nothing is hardcoded.** Module name, request types, expense categories, funding
sources, payment methods, approval workflows, budget controls, verification rules,
required documents, accounting mappings, and terminology are all admin-defined
records resolved at runtime. "Fuel", "Petty Cash", "M-Pesa", "CRDB" are rows, never
enums.

---

## Relationship to the existing system (critical)

This framework does **not** fork the working Finance Platform. Today the app already
has real, working pieces this design must generalize or reuse — forking any of them
into parallel tables would create a dual source of truth, the same mistake explicitly
rejected in the [Credit Management Framework](credit-management-framework-design.md).

| Concept | Existing model / code | Disposition |
|---|---|---|
| Cash request | `PettyCash` (+ `PettyCashItem` line items) | **Generalize.** Becomes one row-type under the new `ExpenseRequest`; `PettyCash` stays as the legacy table, bridged via nullable FK, no data migration. |
| Allocated fund | `PettyFund` / `PettyFundTxn` | **Generalize** into `FundingSource` (cash-type) + `FundingSourceTxn`. `PettyFund` is the CASH special case of a funding source that also includes bank/mobile-money/card sources today only reachable via free-text `PettyCash.paymentMethod`. |
| Fixed category vocabulary | `PettyFunction`, `Department`, `PettyCash.paymentMethod` (free-text `CASH \| CRDB \| STANBIC \| MPESA`) | **Generalize** into `ExpenseCategory` and `FundingSource`/`PaymentMethod` config rows. Same move the Credit framework made on `lib/bill-types.ts`. |
| Bank/mobile-money/card account | `PaymentChannel`, `CompanyPaymentAccount` | **Reuse as-is.** A `FundingSource` of type BANK/MOBILE_MONEY/CARD wraps a `CompanyPaymentAccount`; no new account model. |
| GL posting | `Account`, `JournalEntry`/`JournalLine`, `lib/ledger.ts` `postJournalEntry()` (single choke point) | **Reuse as-is.** Every expense payment posts through the existing ledger, period-checked the same way procurement/collections already are. |
| Category/source → GL account | `FinanceAccountMapping` (scope/scopeId, narrowest-wins) | **Reuse as-is.** New keys, e.g. `EXPENSE_CATEGORY:<categoryId>`, `FUNDING_SOURCE:<fundingSourceId>` — same resolver `lib/finance-mapping.ts` already implements. |
| Budget vs actual | `Budget` (company/outlet/department/event × Account × period) | **Reuse as-is.** An `ExpenseCategory`'s mapped GL account is exactly the dimension `Budget` already targets; no new budget model needed for Phase 1. |
| Approval | `WorkflowApproval` (today FK'd only to `CollectionStageRecord`/`StaffTransaction`) | **Extend.** Add a nullable `expenseRequestId` FK (same additive-bridge pattern as `SignedBill.creditGroupId`) rather than forking a parallel approval table. |
| Digital payment proof/verification | `PaymentVerification`, `PaymentIntegrationConnector` | **Reuse as-is.** An expense payment made via bank/MoMo produces the same `PaymentVerification` row an inbound collection does — one verification pipeline, not two. |
| Bank/GL reconciliation | `AccountReconciliation` against `CompanyPaymentAccount` | **Reuse as-is.** A funding source backed by a `CompanyPaymentAccount` reconciles exactly like any other bank account already does. |
| Controlled write-off/exception | `WriteOffRequest` pattern (approval + non-destructive JournalEntry adjustment) | **Follow the pattern**, not the table — expense variance write-offs (e.g. receipt short of amount disbursed) get their own request type, same approve→post shape. |
| Outlet-scoped visibility | Outlet Scoping Audit's `readOutletScope()` convention | **Reuse as-is.** Every new list/read endpoint follows the same explicit-role-check convention already enforced app-wide. |

No existing table is renamed or dropped. `PettyCash` keeps working unmodified until
the app layer opts into the new request-type engine.

---

## Stage 1 — Business analysis (summary)

An expense/disbursement event is a **funds-out obligation**: someone requests money
(or is reimbursed after spending their own), it is approved against a policy, paid
from a funding source, and verified before it is considered closed. Every industry
does this under different names and different funding mixes; the invariant is one
workflow, the variants are configuration.

**Key invariants:**
- **Conservation** — `fundingSource.balance = openingBalance + Σreplenishments −
  Σpayments ± Σadjustments` (mirrors `PettyFundTxn`'s existing signed-delta model).
- **Approval-before-exposure** — a request creates no financial commitment until
  approved (mirrors Credit framework's "request-type bills create no exposure until
  approved").
- **Payment ≠ closure** — disbursing cash does not close a request; it must be
  verified (receipt/goods confirmed) before status reaches CLOSED. This is the gap
  `PettyCash.paymentStatus` does not currently model (PAID today effectively means
  "done").
- **Immutable history** — reverse, never edit, exactly like `JournalEntry` reversal
  and `WriteOffRequest`'s non-destructive adjustment.
- **Split funding** — one request may be paid from more than one funding source
  (part cash, part bank), which the current `PettyCash.paymentMethod` single field
  cannot express.

**Industry variations (same workflow, different config rows):** restaurant (Petty
Cash Request funded from Petty Cash/CRDB/M-Pesa), construction (Site Expense Request
funded from Site Cash/Bank/Mobile Money), NGO (Activity Funding Request funded from
Project/Donor accounts, typically with mandatory donor-code budget validation),
retail (Purchase Expense Request funded from Corporate Bank/Card), hotel (Operational
Expense Request funded from Petty Cash/Main Cash/Card/Bank). All six differ only in
`RequestType`, `ExpenseCategory`, and `FundingSource` rows — zero code branches.

---

## Stage 2 — Data model

### New models (Phase 1 scope)

| Model | Purpose |
|---|---|
| `ExpenseModuleConfig` | Module identity + global switches, scope/scopeId (GLOBAL→COMPANY→OUTLET, narrowest wins — identical shape to `CollectionModeConfig`/`CreditModuleConfig`). Holds `moduleName`, `terminology` (JSON), `enabled`, `defaultCurrency`, `requireReceiptDefault`, `allowMixedPayment`, `allowOverBudget` (BLOCK\|WARN\|APPROVE). |
| `RequestType` | Admin-defined request type ("Petty Cash Request", "Site Expense Request", ...). `requiredFields`/`requiredAttachments` (JSON), `approvalWorkflowId` FK, `allowedCategoryIds`/`allowedFundingSourceIds` (JSON id-arrays, Phase 1; graduate to child tables if the UI needs relational filtering), `budgetValidation` (NONE\|WARN\|BLOCK), `statusWorkflowId`. Soft-deleted (`isActive`). |
| `ExpenseCategory` | Generalizes `PettyFunction`. `budgetAccountId` FK → `Account` (so `Budget` targets it directly), `spendingLimit`, `taxRuleId`, `costCenterId`/`departmentId`/`eventId`, `approvalOverride` (optional stricter rule than the request type's default), `isActive`. `legacyFunctionName` bridges to `PettyCash.functionName`. |
| `FundingSource` | Generalizes `PettyFund` + gives bank/MoMo/card a first-class row (today only a free-text `paymentMethod`). `sourceType` (CASH\|BANK\|MOBILE_MONEY\|CARD\|OTHER), `companyPaymentAccountId` FK (null for CASH), `openingBalance`, `currentBalance` (materialized — **CASH only**; see Stage 16 decision 2 — null/unused for BANK/MOBILE_MONEY/CARD, whose balance is always computed live from the wrapped `CompanyPaymentAccount`'s GL balance), `dailyLimit`, `responsibleUserId`, `outletId`, `currency`, `isActive`. |
| `ExpenseRequest` | Generalizes `PettyCash`. `requestTypeId`, `categoryId`, `requestedById`, `amount`, `currency`, `purpose`, `status` (DRAFT\|PENDING_APPROVAL\|APPROVED\|REJECTED\|PARTIALLY_PAID\|PAID\|VERIFIED\|CLOSED\|CANCELLED), `outletId`/`departmentId`/`eventId`, `dueDate`. `legacyPettyCashId` bridges. |
| `ExpenseItem` | Generalizes `PettyCashItem` — unchanged shape (detail/unit/unitCost/amount), FK renamed to `expenseRequestId`. |
| `ExpensePayment` | Generalizes `PettyFundTxn`'s PAYMENT type into its own table (one request can have many). `fundingSourceId`, `amount`, `paymentMethod` (mirrors `PaymentChannel.code`), `payeeName`/`payeeAccount`, `reference` (bank/MoMo txn id), `paidAt`, `paidById`, `journalEntryId`, `verificationId` (→ `PaymentVerification`, when digital). |
| `PaymentAllocation` | One `ExpensePayment` → one `ExpenseRequest`, with `amount` — the join that makes **partial + mixed-source payments** possible (an amount split across two `ExpensePayment` rows against different `FundingSource`s). Absent today: `PettyCash` assumes one payment fully settles one request. |
| `VerificationRecord` | One row per verification stage reached (`RECEIPT_UPLOADED`→`RECEIPT_VERIFIED`→`GOODS_CONFIRMED`→`VALIDATED`), `expenseRequestId`, `stage`, `verifiedById`, `verifiedAt`, `note`, `attachmentId`. Configurable per `RequestType` which stages are required. |
| `Attachment` | Generic file/receipt/proof record, `entityType`+`entityId` (loose ref, same convention as `JournalEntry.sourceType/sourceId`), `url`, `docType`, `uploadedById`. Replaces the single `PettyCash.receiptUrl` string field with unlimited, typed attachments. |

### Bridge FKs (nullable, additive, zero behavior change)

`PettyCash.expenseRequestId` (nullable — set only for requests created through the
new engine); `WorkflowApproval.expenseRequestId` (nullable, alongside the existing
`stageRecordId`/`transactionId`).

### Reused as-is (no new model)

`Account`, `FinancialPeriod`, `JournalEntry`/`JournalLine`, `FinanceAccountMapping`,
`PaymentChannel`, `CompanyPaymentAccount`, `Budget`, `AccountReconciliation`,
`PaymentVerification`, `PaymentIntegrationConnector`, `Department`.

### Later phases (designed, not built)

- **`WorkflowDefinition`/`WorkflowStep`** — first-class approval graph (parallel,
  conditional, escalation, delegation, per-step limits), replacing `RequestType.
  approvalWorkflowId` pointing at a JSON rule set in Phase 1. Same deferral the
  Credit and Payroll frameworks already made — reuse whichever graph engine gets
  built first, do not build two.
- **Append-only `ExpenseLedger`** — immutable signed-amount ledger per
  `FundingSource`, replacing the materialized `currentBalance` at
  millions-of-transaction scale (mirrors the deferred `CreditTransaction` ledger).
- `InstallmentSchedule` (multi-tranche disbursement), first-class `TaxRule`,
  duplicate-expense/fraud-signal tables (Stage 16 future-proofing).

---

## Stage 3 — Configuration framework

Resolution: **Outlet → Company → Global** (narrowest wins), the exact pattern of
`CollectionModeConfig`/`CreditModuleConfig`/`FinanceAccountMapping`. Zero config rows
⇒ module effectively off, today's `PettyCash` flow unchanged. Typed columns for the
common 80% (queryable/indexable); JSON `attributes`/`parameters` for the
industry-specific long tail, validated against a per-`RequestType` schema at write
time — same trade-off already accepted for `CreditGroup.attributes`.

## Stage 4 — Request types

Unlimited, admin-defined. Each carries required fields/attachments, allowed
categories/funding sources, budget-validation mode, and a status workflow. "Petty
Cash Request" and "Site Expense Request" are two rows, not two code paths.

## Stage 5 — Expense categories

Unlimited, admin-defined, each mapped to a GL `Account` (so `Budget` and
`FinanceAccountMapping` work immediately), with its own spending limit, tax rule,
and cost-center/department/event tag. "Fuel" and "Marketing" become rows exactly the
way `CreditGroup` turned bill-type constants into rows.

## Stage 6 — Funding sources

Unlimited, admin-defined, spanning CASH (generalizes `PettyFund`), BANK/MOBILE_MONEY/
CARD (wraps `CompanyPaymentAccount`), and OTHER (director/project accounts with no
GL wrapper yet). Daily limits, responsible officer, and status are per-row, not
hardcoded per payment-method string.

## Stage 7 — Payment engine

`ExpenseRequest` → many `ExpensePayment` → many `PaymentAllocation`. This directly
fixes the current 1:1 assumption in `PettyCash`/`PettyFundTxn` and enables partial,
installment, and mixed-source payment (part CASH, part BANK) without new tables —
just more `ExpensePayment` rows against the same request.

## Stage 8 — Digital payment tracking

Any `ExpensePayment` against a BANK/MOBILE_MONEY/CARD `FundingSource` writes (or
links to) a `PaymentVerification` row — the same model and pipeline inbound
collections already use, giving one reconciliation surface instead of two. Fields
already exist: `reference`, `channel`, `amount`, `status`, `source`,
`verifiedById/At`. No new tracking model needed.

## Stage 9 — Approval workflow

Phase 1: `RequestType.approvalWorkflowId` → a simple ordered-roles JSON (mirrors
Credit framework Phase 1's `approverRoles` JSON), materialized as
`WorkflowApproval` rows via the new nullable `expenseRequestId` FK — reusing the
existing approve/reject/comment/resolvedAt machinery instead of forking it. Later:
graduate to the shared `WorkflowDefinition` graph (Stage 2, later phases) for
parallel/conditional/escalation/delegation once that engine exists — built once,
used by Expense, Credit, and Payroll alike.

## Stage 10 — Verification workflow

`VerificationRecord` rows track: Receipt Uploaded → Receipt Verified → Goods/Services
Confirmed → Expense Validated → Accounting Posted → Reconciled → Closed.
`RequestType` configures which stages are mandatory (a Site Expense Request might
skip "Goods Confirmed"; an Activity Funding Request might require a donor-facing
extra stage via the JSON long tail). Payment alone never advances status past PAID.

## Stage 11 — Accounting integration

`ExpenseCategory.budgetAccountId` and `FundingSource.companyPaymentAccountId`
resolve their GL accounts through the existing `FinanceAccountMapping` resolver
(new keys: `EXPENSE_CATEGORY:<id>`, `FUNDING_SOURCE:<id>`) with the company's seeded
default as fallback — an unconfigured company still posts correctly, exactly the
promise `FinanceAccountMapping` already makes for procurement/collections. Posting
(`Dr Expense Account / Cr Cash-Bank-MoMo Account`) goes through the single
`postJournalEntry()` choke point — period-checked, debit=credit enforced, nothing
new to build there.

## Stage 12 — Reconciliation

Cash `FundingSource`s reconcile the way `PettyFund` balances do today (opening +
Σmovements). Bank/MoMo/Card `FundingSource`s reconcile through the existing
`AccountReconciliation` against their wrapped `CompanyPaymentAccount` — one
reconciliation engine for expense payments and everything else that touches a
company payment account, not a parallel one.

## Stage 13 — Reports and analytics

Expenses by Category/Department/Project/Funding-Source/Payment-Method, Cash Flow,
Digital Payments, Outstanding Requests, Pending Approvals, Unverified Expenses,
Reconciliation Status, Budget vs Actual (reusing `lib/finance-budget.ts`
`computeActual()` unchanged since categories now map to real `Account`s), Spending
Trends, Expense Aging, Audit. All titles/columns pull from
`ExpenseModuleConfig.terminology`, same as Credit framework reports.

## Stage 14 — Security

Extends existing RBAC: `expense.request`, `expense.approve`, `expense.pay`,
`expense.verify`, `expense.config`, `expense.viewBudget`. Outlet-scoped visibility
follows the Outlet Scoping Audit's explicit-role-check convention on every new
read endpoint. Append-only audit; no hard deletes. Multi-company/branch/currency
inherited from the existing tenant model — no new dimension to design.

## Stage 15 — Integrations

Finance/GL (`lib/ledger.ts`, `FinanceAccountMapping` — native), Budgeting (`Budget`
— native), Payroll (staff reimbursement settlement, same seam the Credit framework
already uses for staff settlement), Procurement (a `SupplierInvoice`/`SupplierPayment`
can optionally originate from an approved `ExpenseRequest` rather than duplicating
purchase-request logic), Banking (`CompanyPaymentAccount`/`PaymentVerification`
native), Document Management (`Attachment`), Notifications (existing notification
pipe), Employee Self-Service (staff-submitted reimbursement claims, later phase).

## Stage 16 — Enterprise readiness review (self-diagnostic)

**Hardcoded assumptions eliminated:** `PettyFunction` (category), `PettyCash.
paymentMethod` free-text (funding source/payment method), single-payment-per-request
assumption, single `receiptUrl` string (attachment).

**Deliberately deferred, not missing:**
- Full approval graph (parallel/conditional/escalation) — Phase 1 ships ordered-role
  approval; the shared `WorkflowDefinition` engine is a cross-framework investment,
  not an Expense-specific gap.
- Append-only ledger for `FundingSource` balances — materialized balance is correct
  and fast enough at current transaction volume; ledger is the scale-out path,
  documented so it isn't a surprise later.
- OCR/AI receipt scanning, duplicate-expense detection, predictive budgeting — listed
  in the prompt's future-proofing section; none are load-bearing for Phase 1 and the
  `Attachment`/`VerificationRecord` shape doesn't block adding them later.

**Decisions locked 2026-07-23 (superseding the "open decisions" this doc originally
listed here):**

1. **Rollout: side-by-side, migrate request-type by request-type.** `PettyCash`
   keeps running unmodified. New `RequestType`s are configured and pointed at new
   screens one at a time; `PettyCash.expenseRequestId` stays null until a given
   flow is cut over. No hard cutover, no one-shot data migration on a live daily
   flow. Matches the rollout shape already proven by Credit, Price List, Business
   Period, and Payroll.
2. **`FundingSource` balance ownership: split by type.** CASH sources materialize
   their own `currentBalance` (same shape as `PettyFund` today — there is no GL
   account behind pure cash). BANK/MOBILE_MONEY/CARD sources store **no**
   materialized balance; every read computes it live from the wrapped
   `CompanyPaymentAccount`'s GL balance via `lib/finance-banking.ts
   companyAccountBalance()`. Keeps the GL as the single source of truth for
   anything already backed by a real account — no parallel balance to drift out of
   sync and no new reconciliation surface to build.
3. **Budget scope: company-level only for Phase 1.** One `Budget` row per
   `ExpenseCategory`→`Account`, no required outlet split. `Budget.outletId` is
   already nullable, so outlet-level budgets can be added later purely as more
   config rows — zero schema change, zero code change. Ship with the smallest
   correct slice; don't force outlet-level budget setup before the module can go
   live.

---

## Phase 1 build scope

Configuration + classification + core workflow layer, same shape as Credit
framework Phase 1 (`lib/credit-config.ts` 260 lines / `lib/credit-ledger.ts` 150 /
`lib/credit-seed.ts` 171 + 5 API routes) but roughly double the model count, so
expect roughly double the code. No UI migration of the existing `PettyCash`
screens — they keep working, unbridged, until an outlet's admin configures and
opts into a `RequestType` (decision 1).

### Schema (one migration)

Add: `ExpenseModuleConfig`, `RequestType`, `ExpenseCategory`, `FundingSource`,
`ExpenseRequest`, `ExpenseItem`, `ExpensePayment`, `PaymentAllocation`,
`VerificationRecord`, `Attachment`. Additive bridge FKs: `PettyCash.
expenseRequestId` (nullable), `WorkflowApproval.expenseRequestId` (nullable).
Zero changes to any existing column — a plain additive migration, same risk
profile as the Credit Phase 1 migration.

### lib/ modules (naming mirrors `lib/credit-*.ts`)

| File | Responsibility |
|---|---|
| `lib/expense-config.ts` | `ExpenseModuleConfig` scope resolution (Outlet→Company→Global); CRUD + resolution for `RequestType`/`ExpenseCategory`/`FundingSource`. |
| `lib/expense-requests.ts` | `ExpenseRequest`/`ExpenseItem` create/read/status-transition; budget-validation call-out to `lib/finance-budget.ts` per `RequestType.budgetValidation`. |
| `lib/expense-payments.ts` | `ExpensePayment`/`PaymentAllocation` creation; balance update for CASH `FundingSource` (materialize) vs. live lookup for BANK/MOBILE_MONEY/CARD (delegates to `lib/finance-banking.ts companyAccountBalance()`); posts through `lib/ledger.ts postJournalEntry()` using `lib/finance-mapping.ts` keys `EXPENSE_CATEGORY:<id>` / `FUNDING_SOURCE:<id>`; links digital payments to `PaymentVerification`. |
| `lib/expense-verification.ts` | `VerificationRecord` stage transitions per `RequestType`-configured required stages; `Attachment` create/list. |
| `lib/expense-workflow.ts` | Materializes `WorkflowApproval` rows (`expenseRequestId` FK) from `RequestType.approvalWorkflowId`'s ordered-roles JSON; approve/reject/comment. |
| `lib/expense-access.ts` | RBAC + outlet scoping (`expense.request/.approve/.pay/.verify/.config/.viewBudget`), mirrors `lib/petty-access.ts`'s existing shape. |
| `lib/expense-seed.ts` | Seeds one working default: a "Petty Cash Request" `RequestType`, categories mirrored 1:1 from existing `PettyFunction` rows, a CASH `FundingSource` per existing `PettyFund`, so Phase 1 is validatable against real TIPS data without forcing migration. |

### API routes (mirrors `app/api/credit/*` shape)

`app/api/expense/config`, `.../request-types` (+`[id]`), `.../categories`
(+`[id]`), `.../funding-sources` (+`[id]`), `.../requests` (+`[id]`),
`.../requests/[id]/approve`, `.../requests/[id]/pay`, `.../requests/[id]/verify`,
`.../requests/[id]/attachments`.

### Minimal UI

New section (does not touch existing `/petty-cash` screens): Setup pages for
Request Types / Categories / Funding Sources; one generic "New Expense Request"
form that renders required fields/attachments per the selected `RequestType`; an
approvals inbox (can extend the existing approvals UI that already lists
`WorkflowApproval` rows, since the new FK slots into the same table); a payment
screen supporting split/mixed funding sources; a verification checklist view.
Budget entry and bank reconciliation reuse whatever admin UI already exists for
`Budget`/`AccountReconciliation` — no new screens for those in Phase 1.

### Explicitly out of scope for Phase 1

`WorkflowDefinition` graph engine (ordered-roles JSON only); append-only
`ExpenseLedger` (materialized CASH balance only); any cutover/removal of
`PettyCash` UI; OCR/duplicate-detection/fraud signals; Employee Self-Service
reimbursement claims; outlet-level budget UI (schema supports it, not exposed
yet).

### Sequencing

1. **M1 — Schema.** Migration for the 10 new models + 2 bridge FKs. No app code
   yet; existing `PettyCash` flow completely unaffected.
2. **M2 — Config layer.** `expense-config.ts` + config/request-type/category/
   funding-source API routes + `expense-seed.ts` seeding one real `RequestType`
   from existing TIPS `PettyFunction`/`PettyFund` data.
3. **M3 — Core request/payment workflow.** `expense-requests.ts` +
   `expense-payments.ts` + their API routes — the request→approve→pay→GL-post
   path, split/mixed payment included.
4. **M4 — Approval bridge.** `expense-workflow.ts` wiring `WorkflowApproval.
   expenseRequestId`.
5. **M5 — Verification + attachments.** `expense-verification.ts` +
   `VerificationRecord`/`Attachment` routes.
6. **M6 — Minimal UI + Pre-Commit self-diagnostic pass, then deploy.**

Each milestone is independently shippable and additive — the same
zero-rows-means-off guarantee holds after every step, so this can pause between
any two milestones without leaving the app in a half-migrated state.
