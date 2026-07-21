# Universal Credit Management Framework — Design

**Status:** Phase 1 (configuration + classification layer) implemented & seeded.
**Author:** Solution architecture pass, 2026-07-21.

An industry-agnostic, admin-configurable credit module. The goal: "Signed Bills"
/ "House Accounts" / "Accounts Receivable" and their groups become
**configuration, not code**, so restaurants, hotels, hospitals, schools,
wholesalers, etc. are supported without source changes.

## Guiding principle

**Nothing is hardcoded.** Module name, groups, policies, limits, terms, grace,
interest, penalties, approvals, required documents, settlement methods, and
terminology are all admin-defined records resolved at runtime.

## Relationship to the existing system (critical)

This framework does **not** fork the working Accounts-Receivable core. Today the
app already implements A/R:

| Concept | Existing model / code |
|---|---|
| Credit invoice | `SignedBill` (+ `BillItem` line items) |
| Receipt / payment | `PaidBill` |
| Write-off | `SignedBillWriteOff` / `WriteOffRequest` |
| Approval | `WorkflowApproval` (role-based) |
| GL posting | `lib/finance-ar.ts` → `postJournalEntry()` (Dr A/R / Cr Sales; Dr Cash/Bank / Cr A/R) |
| Per-person limit | `Person.creditLimit` |
| Credit cycle / aging | `BusinessPeriodVersion.creditStartDay/creditResetDay/creditGraceDays` |
| Fixed group vocabulary | `lib/bill-types.ts` (`CREDIT_BILL_TYPES`, `REQUEST_BILL_TYPES`, `PAYROLL_ELIGIBLE_BILL_TYPES`, `CREDIT_LIMIT_BILL_TYPES`) |

The framework **generalizes the hardcoded `lib/bill-types.ts` groupings into
admin records** and wraps the debtor in a first-class account, while the
transactional core (invoice/payment/write-off/GL) stays the single source of
truth for money. Forking that into parallel ledger tables would create a dual
source of truth — explicitly rejected.

---

## Stage 1 — Business analysis (summary)

A credit sale is a **deferred settlement**: goods leave now, cash arrives later.
Every industry does this under different names/rules. The invariant (an
obligation created now, settled over time, under a policy) is modelled once; the
variants (names, groups, rules, approvals) are configuration.

**Key invariants:** balance conservation (`outstanding = Σinvoices − Σpayments −
Σwrite-offs + Σinterest/penalty`); limit enforcement (block/warn/approve on
over-limit); approval-before-commit (request-type bills create no exposure until
approved); immutable history (reverse, never edit).

**Industry variations proven:** restaurant (Signed Bills), hospital (Insurance
Claims), wholesaler (A/R), hotel (City Ledger), school (Fee Accounts),
manufacturing (Trade Credit) — all differ only in config rows.

---

## Stage 2 — Data model

### Phase 1 (implemented)

| Model | Purpose |
|---|---|
| `CreditModuleConfig` | Module identity + global switches per `scope`/`scopeId` (GLOBAL→COMPANY→OUTLET, narrowest wins — same shape as `CollectionModeConfig`). Holds `moduleName`, `terminology` (JSON), `enabled`, `defaultCurrency`, `approvalRequiredDefault`, `allowPartialPayments`, `allowOverLimit` (BLOCK\|WARN\|APPROVE), `requireAttachmentsDefault`. |
| `CreditPolicy` | Reusable, versioned rule bundle (`policyType` INTEREST\|PENALTY\|LIMIT\|SETTLEMENT\|WRITEOFF; `method`; `parameters` JSON; effective-dated). Shared across groups. |
| `CreditGroup` | The configurable classifier. Generalizes `lib/bill-types.ts`: `isCreditBearing` (= CREDIT_BILL_TYPES), `requiresApproval` (= REQUEST_BILL_TYPES), `settlementMethods`+`defaultSettlementMethod` (= payroll-eligibility, now per-group configurable), `maxCredit`, `paymentTermsDays`, `gracePeriodDays`, interest/penalty/limit policy FKs, `approverRoles` (JSON), `riskRating`, `priority`, `documentsRequired`, allowed-scope JSON id-arrays, `attributes`. `legacyBillTypeCode` bridges to `SignedBill.billType` with no data migration. |
| `CreditAccount` | The debtor — thin 1:1 wrapper over `Person` (`personId @unique`), plus `userId` for staff, `accountType`, `status`, `creditLimitOverride`, materialized `currentBalance` + `balanceVersion`, `currency`, `riskRating`. |
| `CreditAccountGroup` | Effective-dated M:N — "one account, many groups". Limit resolution when multi-group is config-driven (default: min of group limits). |

**Bridge FKs (nullable, additive):** `SignedBill.creditGroupId` /
`SignedBill.creditAccountId`; `Person.creditAccount` (1:1). Zero behavior change
until app code opts in.

### Later phases (designed, not built)

- **Append-only `CreditTransaction` ledger** — one immutable signed-amount row
  per event; balance = `SUM(signedAmount)`. Would sit under SignedBill/PaidBill
  as the canonical ledger at millions-of-transactions scale. Deferred to avoid
  reworking the working A/R now.
- **`WorkflowDefinition` + `WorkflowStep`** — first-class approval graph
  (sequential/parallel/conditional, escalation, delegation, per-step limits).
  Phase 1 uses `approverRoles` JSON + existing `WorkflowApproval`.
- `PaymentSchedule`, `Dispute` (freezes aging), `Settlement`, `PaymentAllocation`
  (one payment → many invoices), first-class `Attachment` per required-doc type.

---

## Stage 3 — Configuration framework

Resolution: **Outlet → Company → Global** (narrowest wins), reusing the exact
pattern of `CollectionModeConfig` / `FinanceAccountMapping` /
`BusinessCalendarConfig`. Zero rows ⇒ module effectively off / today's hardcoded
behavior, unchanged. Typed columns for the common 80% (queryable/indexable);
JSON `parameters`/`attributes` for the industry-specific long tail (validated
against a per-`policyType` schema at write time).

## Stage 4 — Credit groups

Unlimited, admin-defined, soft-deleted (status=INACTIVE). All attributes
configurable; allowed-scope (outlets/products/customer-groups) as JSON id-arrays
in Phase 1, graduating to child tables when the admin UI needs relational
queries. **No enum anywhere** — "DJ Bills" is a row.

## Stage 5 — Credit accounts

INDIVIDUAL / COMPANY / STAFF / GOVERNMENT / GROUP. 1:1 to the existing `Person`
master (single source of identity). M:N to groups with deterministic limit
resolution. Multi-address/contact/ID children deferred to a KYC phase.

## Stage 6 — Credit workflow

Create sale → cash? complete : select account+group → resolve effective limit &
policy → validate limit (block/warn/approve) → approval required? (PENDING, no
A/R) : generate SignedBill (OPEN) → GL Dr A/R Cr Sales → collections (reuse
Collection Workflow Engine) + reminders → payments (PaidBill) → PARTIAL/PAID →
auto-close. Secondary states: rejected, expired, suspended, overdue, reopened,
disputed, written-off, reversed — all as status transitions, each audited.

## Stage 7 — Approval workflow

Phase 1: role-based via `CreditGroup.approverRoles` + `WorkflowApproval`. Later:
`WorkflowDefinition` graph — unlimited levels, sequential/parallel/conditional,
per-approver limits, time-based escalation, delegation.

## Stage 8 — UI

Role-shaped views + terminology-driven labels (a screen reads "Signed Bill" for
TIPS, "Folio" for a hotel). Screens: Dashboard (exposure/overdue/DSO/aging),
Credit Configuration, Groups, Policies, Accounts (360°), Credit Sale (inline in
POS with a live limit gauge), Approvals inbox, Collections board, Settlement,
Outstanding, Reports/Analytics, History/Audit, Attachments, Notifications.

## Stage 9 — Reports

Titles/columns pull from `terminology`. Aging buckets ride the Business Period
Engine's Credit Cycle (not hardcoded 30/60/90). Reports read materialized
balances + the A/R ledger, never re-aggregate full history.

## Stage 10 — Security

Extends existing RBAC: `credit.sale`, `credit.approve`, `credit.writeoff`,
`credit.config`, `credit.viewRisk` (+ field-level gating). Outlet-scoped data
visibility (per the Outlet Scoping Audit). Append-only audit; no hard deletes.
Multi-company/branch/currency inherited from the tenant model.

## Stage 11 — Integrations

POS (native — credit is a tender type), Inventory (stock still depletes),
Finance/GL (`lib/finance-ar.ts`, 3-class model), **Payroll** (staff settlement —
see below), CRM, Procurement (A/P mirror), Banking/Mobile Money (payments
reconcile into Daily Collections), API-first + event bus (`InvoiceCreated`,
`PaymentReceived`, `LimitBreached`) as the seam for future extraction to a
service.

## Stage 12 — Enterprise readiness

Statuses stay code-level (drive the state machine); everything else is config.
Scale handled via materialized balance + version lock + nightly reconciliation.
Future hooks: event bus → customer portal/self-service; `riskRating` +
`attributes` → credit scoring/AI; policy engine → limit recommendations;
`terminology` → multi-language; period + currency → multi-country tax; offline
capture rides the existing SQLite-local setup.

---

## Settlement (decision: "Both — configurable")

Settlement method is **per-group configuration**, not a global rule:
`CreditGroup.settlementMethods` is the allowed list; `defaultSettlementMethod`
is the pick. Staff-facing groups (Admin, Director, Staff) allow
`PAYROLL_DEDUCTION`; customer-facing groups (Customer, Tips, DJ) do not. The
Payroll module, when built, consumes `defaultSettlementMethod = PAYROLL_DEDUCTION`
to recover balances from pay.

## TIPS seed (Phase 1)

Module `"Signed Bills"` (GLOBAL, enabled, TZS, over-limit=WARN). Two shared no-op
policies (TIPS charges no interest/penalty). Six groups ↔ the six legacy
billType codes, plus a `CreditAccount` per existing `Person` linked to its group:

| Group | legacy | creditBearing | approval | default settlement |
|---|---|---|---|---|
| Admin | ADMIN | ✓ | — | PAYROLL_DEDUCTION |
| Director | DIRECTOR | ✓ | — | PAYROLL_DEDUCTION |
| Customer | CUSTOMER | ✓ | ✓ (MANAGER) | CASH (net-30) |
| Staff | STAFF_LOSS | ✗ (internal marker) | — | PAYROLL_DEDUCTION |
| Tips Bills | TIPS | ✓ | ✓ (MANAGER) | CASH |
| DJ Bills | DJ | ✓ | ✓ (MANAGER) | CASH |

Seeding is idempotent & additive (`lib/credit-seed.ts`, called from
`lib/seed-core.ts`).

## Next phases

1. **Resolver + config lib** — `lib/credit-config.ts` (scope resolution,
   effective limit, terminology) mirroring `lib/collection-mode.ts`.
2. **Wire SignedBill capture** to tag `creditGroupId`/`creditAccountId` and
   enforce limits via the resolver (replacing the hardcoded `bill-types.ts`
   reads incrementally).
3. **Credit Settings admin UI** (module, groups, policies, accounts).
4. **Append-only `CreditTransaction` ledger** + materialized-balance
   reconciliation.
5. **Payroll-deduction settlement** integration.
