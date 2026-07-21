# Universal Payroll Management Framework — Design

**Status:** Design only — no code written. Ready to phase in behind the existing
deduction report.
**Author:** Solution architecture pass, 2026-07-21.

An industry-agnostic, admin-configurable payroll engine. The goal: earnings,
deductions, benefits, allowances, cycles, formulas, statutory rules, workflows,
terminology and reports become **configuration, not code**, so a restaurant,
hospital, school, factory, NGO, or bank all run on the same engine without
source changes.

## Guiding principle

**Nothing is hardcoded.** Module name, pay cycles, employee categories, pay
groups, every earning/allowance/benefit/deduction, formulas, tax/pension/social
-security rules, approval chains, payment methods, currency, cost centres,
reports, notifications and terminology are all admin-defined records resolved at
runtime. The engine computes pay by *interpreting configuration*, never by
branching on a company or country in code.

---

## Relationship to the existing system (critical)

This framework does **not** fork the working core, and it does **not** throw away
the payroll surface that already exists. Three of its four foundations are
already built and in production — the design is mostly *assembly plus a new
compensation domain*, not green-field.

| Concern | What exists today | What the framework does |
|---|---|---|
| **Payroll periods** | `BusinessPeriodVersion` (effective-dated, scoped) already carries `payrollStartDay` / `payrollProcessingDay` / `payrollPaymentDay` / `payrollLockDay`; math in `lib/business-periods-shared.ts` (`payrollPeriodForDate`), resolver `lib/business-periods.ts` (`resolveEffectivePeriodFields`) | **Reuse verbatim.** No new period logic. A run reads its window + settlement dates from here. |
| **Config resolution** | Scoped-row pattern `scope`/`scopeId`/`@@unique([scope,scopeId])`, narrowest-wins. `lib/collection-mode.ts` is the only resolver with a **ROLE** scope (ROLE→OUTLET→COMPANY→GLOBAL→default) | **Copy the pattern.** New payroll config tables follow the same shape; `collection-mode.ts` is the template when role-scoping is needed. |
| **General ledger** | Single posting choke point `lib/ledger.ts` `postJournalEntry()` / `reverseJournalEntry()`; config-driven `FinanceAccountMapping` (`resolveAccountId`); `FinancialPeriod` OPEN/LOCKED enforcement (`assertPeriodOpen`) | **Post through it.** Add payroll mapping keys; the payroll `lockDay` aligns to the `FinancialPeriod` lock. |
| **Debt-from-salary recovery** | `lib/payroll.ts` `computePayrollReport()` reads `SignedBill` (`PAYROLL_ELIGIBLE_BILL_TYPES`) + `Person.creditLimit`; "Run" writes `PaidBill{paymentMethod:'PAYROLL'}`; Credit framework's `CreditAccount.currentBalance` / `userId` + `defaultSettlementMethod='PAYROLL_DEDUCTION'` | **Becomes one deduction source**, not the whole module. Recovery moves *inside* the payroll run — closing **Credit-framework Phase 5**. |
| **Approvals** | `WorkflowApproval` (role-routed, single-level) + several bespoke `*Request` + `*AuditLog` triads; no multi-level graph yet | **Reuse now** (extend `WorkflowApproval`); `WorkflowDefinition` graph is a later phase (shared with Credit). |
| **Audit** | Global `AuditLog` (coarse) + domain insert-only field-diff tables (`BusinessCalendarAuditLog`, `WriteOffAuditLog`, …) | Add `PayrollAuditLog` (insert-only field-diff) + emit coarse events to global `AuditLog`. |
| **Identity / RBAC** | `User` (login: role string ∈ CASHIER\|ACCOUNTANT\|MANAGER\|DIRECTOR\|ADMIN\|WAITER, `outletId`, `isCasual`); `Person` (party/debtor: `type`, `creditLimit`, `code`); **no FK links them**; RBAC via `RolePermission`+`UserPermission` (`lib/rbac.ts`) | **Introduce the missing Employee master** (below) and extend `RESOURCES` with `payroll.*`. |

**The one genuine gap:** there is no compensation domain. No `Employee`, no
salary, no earning, no payslip — the word "payroll" in the app today means
*deduction reporting only*. Everything below builds that domain; everything else
is wiring into engines that already work.

---

## Stage 1 — Business analysis

**The invariant.** Payroll is a periodic settlement of a labour obligation:
for each person, for each period, compute *gross* (what they earned) minus
*deductions* (what is withheld/recovered) = *net* (what is paid), while the
employer simultaneously incurs *employer contributions* (its own statutory/benefit
cost). Every industry does exactly this; only the *components*, *rates*,
*cadence*, *approvals* and *names* differ. The invariant is modelled once; the
variants are configuration.

**Why each core requirement exists:**

- *Configurable components* — a restaurant pays Tips + Service Charge; a factory
  pays Piece Rate + Production Bonus; a hospital pays Risk + Call Duty. Same
  engine, different rows. Hardcoding component types is the exact mistake
  `lib/bill-types.ts` made for credit and that the Credit framework then had to
  generalize; we start generalized.
- *Configurable cycles* — monthly, fortnightly, weekly, daily-wage, 25th-to-25th.
  Already solved by `BusinessPeriodVersion`; payroll must not reinvent it.
- *Formula engine* — gross/net/overtime/proration cannot be a fixed formula when
  taxability, pensionability and rounding differ per component and per country.
- *Effective-dated statutory rules* — PAYE bands and pension rates change by
  Finance Act; re-running an old month must reproduce the rates in force *then*
  (the same historical-accuracy requirement `BusinessPeriodVersion` versioning
  solves for periods).
- *Immutable runs + reverse-never-edit* — payroll is money and a legal record;
  corrections post a reversal + a correction run, never an in-place edit (mirrors
  `reverseJournalEntry` and the Credit ledger's "reverse, never edit").
- *Approval-before-pay* — no cash leaves and no GL posts until the run is approved
  and locked (mirrors credit's "no A/R until approved").

**Payroll lifecycle:** prepare → validate attendance/leave → calculate →
draft → approve (n levels) → lock → generate payslips → generate payment file →
post to GL → pay → (reopen only via correction run).

**Edge cases the design must cover** (revisited in Stage 13): mid-period
joiners/leavers (proration), retroactive pay after a backdated raise or a
backdated statutory change, negative net pay (deductions exceed gross — cap &
carry-forward), off-cycle / bonus / 13th-month runs, final settlement + terminal
benefits, multi-currency at the run-date FX rate, suspended/unpaid-leave months,
and re-running a locked period.

**Non-functional:** multi-tenant (Company→Outlet), multi-currency, effective-dated
everything, append-only audit, field-level salary confidentiality, and
millions-of-payslips scale via materialized run/payslip totals (never re-aggregate
history) — the same scale approach the Credit ledger uses.

---

## Stage 2 — Universal data model

New models, grouped by role. Every scoped config table uses the house shape
(`scope` GLOBAL|COMPANY|OUTLET(|ROLE), `scopeId`, `@@unique([scope,scopeId])`,
GLOBAL row via `findFirst`). Statuses/types stay app-enforced strings (no SQLite
enums), documented in the schema header like every other module.

### 2.1 Identity & organisation

| Model | Purpose / key fields |
|---|---|
| **`Employee`** | **The missing master.** Thin wrapper unifying identity: `personId @unique` → `Person` (single source of identity, exactly as `CreditAccount` does), `userId?` → `User` (login link — may be null for casuals/kitchen with no account; *this is the FK that does not exist today*), `employeeNumber` (reuses `Person.code` `EMPLOYEE_NUMBER` mode), `categoryId`, `payGroupId`, `departmentId?`, `costCenter?`, `outletId?`/`companyId?` (tenant scope — the piece `Person` lacks), `hireDate`, `probationEndDate?`, `terminationDate?`, `status` (ACTIVE\|PROBATION\|SUSPENDED\|ON_LEAVE\|TERMINATED), `baseCurrency`, `paymentMethod`, `bankRef?`/`mobileMoneyRef?` (opaque payout handle — never the raw account number in plaintext beyond what today's bank fields hold), `baseSalary?`. Relations: payslips, component assignments, leave balances, loans. |
| **`EmployeeCategory`** | Config rows generalizing today's boolean `User.isCasual`: Permanent, Casual, Contract, Consultant, Intern, Director, Seasonal, Part-time — unlimited, soft-deleted. Carries default pay frequency, statutory applicability flags, default leave scheme, and `attributes` JSON. **No enum.** |
| **`Department`** *(extend existing)* | Today `Department` is an isolated lookup used only by budgets, and staff department is free-text. Add `Employee.departmentId` FK + optional `parentId` (hierarchy) so cost-centre payroll reporting has a real dimension. |

### 2.2 Rules & components (the heart)

| Model | Purpose / key fields |
|---|---|
| **`PayGroup`** | The configurable rule bundle (the payroll analogue of `CreditGroup`): `code`, `name`, `payFrequency` (override of the period cycle when a group differs), `componentSetJson` (default component ids), `overtimePolicyId?`, `leaveSchemeId?`, `statutoryProfileId?`, `approverRoles` JSON (Phase-1 routing, same as `CreditGroup.approverRoles`), `priority`, `terminology` JSON. |
| **`PayComponent`** | **One table for every payslip line kind**, discriminated by `componentType` (EARNING\|ALLOWANCE\|BENEFIT\|DEDUCTION\|EMPLOYER_CONTRIBUTION\|STATUTORY). Fields: `code`, `name`, `calcMethod` (FIXED\|PERCENTAGE\|RATE_QTY\|FORMULA\|TABLE\|SOURCED), `parameters` JSON, `formulaId?`, `taxable`, `pensionable`, `frequency` (per run\|one-time\|monthly\|annual), `priority` (calc order tiebreak), `minLimit`/`maxLimit`, `proratable`, `roundingRule`, `glMappingKey` (→ `FinanceAccountMapping`), `costCenterAllocation` JSON, `requiresApproval`, `effectiveFrom`/`effectiveTo`, `terminology`. Generalizes `lib/bill-types.ts` groupings and the Credit `parameters`-JSON policy style into admin data. "Service Charge", "Risk Allowance", "Piece Rate" are **rows**. |
| **`ComponentAssignment`** | Attaches a component to a **PayGroup** *or* an **Employee**, effective-dated, with an optional per-target parameter/amount override. Resolution mirrors config: **Employee override → PayGroup → component default**. Recurring items (housing allowance, a loan) live here; one-off items are entered on the run. |
| **`PayrollFormula`** | The reusable formula/variable registry for the engine: `name`, `expression` (safe DSL string), `variablesJson` (declared inputs), `returnType`, `effectiveFrom`/`To`. Shared across components (Stage 7). |
| **`StatutoryRule`** | Effective-dated tax/pension/social-security config — the **compliance pack**: `jurisdiction` (e.g. `TZ`), `authority` (TRA\|NSSF\|PSSSF\|NHIF\|WCF\|SDL\|…), `ruleType` (TAX_BAND\|FLAT_RATE\|CAP\|THRESHOLD), `parameters` JSON (e.g. progressive bands), `employeeRate`, `employerRate`, `ceiling`, `floor`, `glMappingKey`, `effectiveFrom`/`To`. Rates are **never** in code. |

### 2.3 Inputs (attendance / time / leave)

| Model | Purpose / key fields |
|---|---|
| **`AttendanceRecord`** | `employeeId`, `date`, `source` (MANUAL\|BIOMETRIC\|POS_SHIFT\|SCHEDULE\|IMPORT\|API), `status`, `hours`, `units` (pieces), `outletId`. **Prefer feeding from what exists** — the Scheduling module and POS sessions — over rebuilding capture. |
| **`Timesheet` / `OvertimeRecord`** | Period-aggregated worked/overtime hours per employee, with `approvalStatus`; overtime multipliers come from `OvertimePolicy` config, not code. |
| **`LeaveType`** | Config rows: Annual, Sick, Maternity, Paternity, Compassionate, Study, Unpaid — each with `accrualRule`, `carryForwardRule`, `encashable`, `paid`, `payrollImpact` JSON, `approverRoles`. |
| **`LeaveBalance` / `LeaveRequest`** | Per-employee accrued/taken balances; requests route through `WorkflowApproval`; approved unpaid leave feeds proration. |

### 2.4 Processing & output (the payroll ledger)

| Model | Purpose / key fields |
|---|---|
| **`PayrollRun`** | The immutable batch: `periodKey` (from `BusinessPeriodVersion`), `scope`/`companyId`/`outletId`/`payGroupId?`, `runType` (REGULAR\|OFF_CYCLE\|BONUS\|FINAL\|CORRECTION), `status` (DRAFT\|CALCULATED\|PENDING_APPROVAL\|APPROVED\|LOCKED\|PAID\|POSTED\|REVERSED), `periodStart`/`periodEnd`/`processingDate`/`paymentDate`/`lockDate` (resolved via `resolveEffectivePeriodFields`), materialized `totalGross`/`totalDeductions`/`totalNet`/`totalEmployerCost`, `currency`, `journalEntryId?`, `reversalOfId?`, `lockedAt?`, `paymentBatchId?`. Mirrors `FinancialPeriod` locking + reverse-never-edit. |
| **`Payslip`** | Per-employee per-run **snapshot**: `runId`, `employeeId`, snapshot of category/pay-group/base, `gross`, `totalDeductions`, `net`, `taxable`, `employerCost`, `currency`, `status`, `ytdGross`/`ytdTax` accumulators. Immutable once the run locks. |
| **`PayslipLine`** | **Append-only** per-component line (the payslip analogue of `JournalLine`/`CreditTransaction`): `payslipId`, snapshot `componentCode`/`name`/`type`, `amount`, `base`/`rate`/`qty` (audit of the calc), `taxable`, `glAccountId`, `sourceRef?` (e.g. the `SignedBill`/loan a SOURCED deduction settles), `sortOrder`. |
| **`Loan` / `SalaryAdvance` + `LoanSchedule`** | Amortized recoveries: principal, balance, per-period instalment, `status`. A DEDUCTION component with `calcMethod=SOURCED, source=LOAN_SCHEDULE` pulls the due instalment. |
| **`PaymentBatch` / `PaymentInstruction`** | The payout file: per-employee net, `method` (BANK\|MOBILE_MONEY\|CASH), `status`, export format; settles `NET_PAY_PAYABLE` when marked paid. |
| **`PayrollAuditLog`** | Insert-only field-diff (`action`, `field`, `previousValue`, `newValue`, `reason`, `userId`, `userName`, `createdAt`) — the house pattern; coarse events also to global `AuditLog`. |

**Bridge FKs (nullable, additive):** `Person.employee` (1:1), `User.employee?`,
`SignedBill` already has the credit tags a SOURCED deduction reads. Zero
behaviour change until app code opts in — same additive discipline as the Credit
framework's bridge FKs.

---

## Stage 3 — Payroll configuration

**`PayrollModuleConfig`** (scope/scopeId, mirrors `CreditModuleConfig`):
`moduleName`, `terminology` JSON (screens read "Payslip" for TIPS, "Wage Advice"
elsewhere), `enabled`, `defaultCurrency`, `exchangeRatePolicy`,
`approvalRequiredDefault`, `roundingPolicy`, `negativeNetPolicy`
(BLOCK\|CARRY_FORWARD\|CAP), `payElementVisibilityDefault`.

Everything else the request lists is already config: **frequency, business
month, closing/lock/reopen rules, working & holiday calendar, weekend rules** all
resolve through the **Business Calendar + Business Period engines** — payroll adds
no parallel calendar. Resolution is **narrowest-wins** (ROLE→OUTLET→COMPANY→
GLOBAL→default), copying `resolveCollectionMode`. **Zero rows ⇒ module off ⇒
today's deduction-report behaviour, unchanged** — the same safety guarantee every
other engine here ships with.

Typed columns for the common 80% (queryable/indexable); JSON `parameters`/
`attributes` for the industry long tail, validated against a per-`calcMethod` /
per-`ruleType` schema at write time (as Credit validates policy `parameters`).

---

## Stage 4 — Employee categories & pay groups

Unlimited, admin-defined, soft-deleted (`status=INACTIVE`). `EmployeeCategory`
generalizes the single `User.isCasual` boolean into first-class rows;
`PayGroup` carries the rule bundle. An employee has one category + one primary
pay group; group changes are **effective-dated** via `ComponentAssignment`
history rather than destructive edits, so historical runs stay reproducible. Each
group defines its own components, overtime policy, leave scheme, statutory
profile and approver roles — a Director group and a Casual group run through the
identical engine on different rows.

---

## Stage 5 — Earnings, benefits & allowances

All are `PayComponent` rows with `componentType ∈ {EARNING, ALLOWANCE, BENEFIT,
EMPLOYER_CONTRIBUTION}`. Each supports fixed / percentage / rate×qty / formula /
table / sourced calculation, effective+expiry dates, frequency, taxability,
pensionability, approval requirement, priority, min/max limits, rounding, and
cost-centre allocation. Basic Salary, Housing, Transport, Meal, Responsibility,
Risk, Service Charge, Tips, Commission, Attendance Bonus, Performance Bonus,
Overtime, Holiday Pay, Night Shift are **seed rows**, not code. Restaurant Tips
and Service Charge distribution are `FORMULA`/`SOURCED` components fed by POS
data.

---

## Stage 6 — Deductions

`PayComponent` rows with `componentType ∈ {DEDUCTION, STATUTORY}`. Same attribute
set plus effective dates, min/max limit, priority (deduction order when net is
tight), recurring-vs-one-time, approval requirement. The distinguishing feature
is **`calcMethod=SOURCED`** with a `source` key that pulls the amount from a
provider adapter:

| `source` | Adapter reads | Notes |
|---|---|---|
| `CREDIT_BALANCE` | `CreditAccount.currentBalance` (via `lib/credit-ledger.ts`) for accounts whose group `defaultSettlementMethod='PAYROLL_DEDUCTION'`; falls back to `computePayrollReport()` | **This is how today's deduction report plugs in** — as a source, not the module. |
| `LOAN_SCHEDULE` / `ADVANCE` | due instalment from `LoanSchedule` | Amortized recovery. |
| `STATUTORY` | `StatutoryRule` engine output | PAYE, pension, SSF, health, WCF, SDL. |
| `MANUAL` | one-off entry on the run | Court orders, uniform, parking. |

PAYE, Pension, Health Insurance, Loan Repayment, Salary Advance, Staff Purchases,
Credit Bills, Union Fees, Savings, Uniform, Meals, Parking, Court Orders are all
configurable rows.

---

## Stage 7 — Formula engine

**No hardcoded payroll math.** A component's amount is produced by one of the
`calcMethod`s; `FORMULA` evaluates a `PayrollFormula.expression` in a **safe,
sandboxed evaluator** — not JS `eval`. Design:

- **Whitelisted expression DSL** — arithmetic, comparisons, and a fixed function
  set (`min`, `max`, `round`, `if`, `band(x, tableId)`, `lookup`, `prorate`,
  `clamp`). No property access, no I/O, no host calls. Parsed once, cached.
- **Variable namespace** populated per employee per run: `base`, prior component
  results (by code), attendance/timesheet aggregates (`hoursWorked`,
  `overtimeHours`, `daysPresent`), leave (`unpaidDays`), statutory outputs
  (`taxable`, `pensionable`), and YTD accumulators.
- **Dependency ordering** — components declare the codes they read; the engine
  builds a dependency graph, **topologically sorts** it (breaking ties by
  `priority`), and **detects cycles** at save time. Gross → taxable → statutory →
  net is a resolved order, not a fixed sequence.
- **Validation at write time** — `parameters`/`expression` validated against the
  `calcMethod` schema (same discipline as Credit policy validation), so a bad
  formula is rejected when saved, never at run time.

This computes Gross, Net, Taxable Income, Overtime, Bonuses, Allowances,
Deductions, employer/employee contributions, commission, service-charge/tips
distribution, leave pay and terminal benefits — all from configuration.

---

## Stage 8 — Attendance, time & leave

**Pluggable sources, prefer reuse.** `AttendanceRecord.source` abstracts capture;
the first adapters wrap what already exists — the **Scheduling module** (staff
assignments) and **POS sessions/shifts** — before any biometric/GPS integration.
Manual entry and Excel import (reusing the generic Sales Import pipeline pattern)
cover the rest; biometric/face/fingerprint/mobile/API are later adapters behind
the same interface.

Leave is fully configurable (`LeaveType` + `LeaveBalance` + `LeaveRequest`):
accrual, carry-forward, encashment, approval (via `WorkflowApproval`) and payroll
impact are per-type rows. Approved unpaid leave and mid-period joins/leaves feed
the engine's `prorate()` function.

---

## Stage 9 — Payroll workflow

A configurable lifecycle expressed as an explicit state machine on `PayrollRun`
(states drive behaviour; the *chain* is config):

```
DRAFT → CALCULATED → PENDING_APPROVAL → APPROVED → LOCKED
      → PAYSLIPS → PAYMENT_FILE → POSTED (GL) → PAID
```

- **Approval** — Phase 1 uses `PayGroup.approverRoles` + `WorkflowApproval`
  (role-routed, single-level, the pattern already in production). Unlimited
  sequential/parallel/conditional levels, delegation and escalation arrive with
  the shared `WorkflowDefinition` graph (a later phase, co-built with Credit).
- **Lock** — locking a run aligns with the payroll `lockDate` and sets/depends on
  the covering `FinancialPeriod` being lockable; `postJournalEntry`'s
  `assertPeriodOpen` then guards the GL.
- **Reopen = correction run.** A locked run is **never edited**. A `CORRECTION`
  run posts the delta and `reverseJournalEntry` unwinds the original GL entry —
  the same reverse-never-edit rule the ledger and Credit already enforce.

### GL posting (closing the Credit loop)

On `POSTED`, the run emits **one balanced `JournalEntry`** via
`postJournalEntry(tx, {sourceModule:'PAYROLL', sourceType:'PayrollRun', …})`, with
accounts resolved through **new `FinanceAccountMapping` keys**:

```
Dr  SALARY_EXPENSE / ALLOWANCE_EXPENSE      (per component, cost-centre via JournalLine.outletId)
Dr  EMPLOYER_CONTRIB_EXPENSE                (WCF, SDL, employer pension)
    Cr  NET_PAY_PAYABLE                     (cleared when PaymentBatch pays)
    Cr  PAYE_PAYABLE / PENSION_PAYABLE / SSF_PAYABLE / HEALTH_PAYABLE
    Cr  STAFF_ADVANCE_RECEIVABLE            (loan/advance recovery)
    Cr  ACCOUNTS_RECEIVABLE                 (staff signed-bill / staff-loss recovery)
```

That final `Cr ACCOUNTS_RECEIVABLE` line is **Credit-framework Phase 5**: the run
writes the `PaidBill{paymentMethod:'PAYROLL'}` rows against the settled
`SignedBill`s (unifying today's separate "Run Payroll Deduction" button into the
run) and posts the matching GL credit — one atomic transaction, no dual source of
truth.

---

## Stage 10 — Reports & analytics

Titles/columns/labels pull from `terminology` (a screen reads "Payslip" or "Wage
Advice" per config). Reports read **materialized `PayrollRun`/`Payslip` totals +
the append-only `PayslipLine` ledger — never re-aggregate raw history** (the
Credit-ledger scale rule). Registers ride the Business Period cycle, not
hardcoded month boundaries: Payroll Register, Payslips, Earnings/Deduction
summaries, Tax/Pension/Social-Security statutory reports, Bank-Transfer &
Cash-Payroll files, Department/Cost-Centre/Project payroll, Overtime & Leave
analysis, Headcount, Variance (period-over-period), Historical comparison, and a
Workforce-Cost dashboard — all wired through the existing Analytics hub's
`businessMonth` preset and shared `DateRangeFilter`.

---

## Stage 11 — Security & compliance

- **Extends existing RBAC** (`lib/rbac.ts`): new `RESOURCES` entries
  `payroll.view`, `payroll.calculate`, `payroll.approve`, `payroll.lock`,
  `payroll.pay`, `payroll.config`, `payroll.viewSalary` — with `RolePermission`
  defaults + `UserPermission` overrides.
- **Field-level salary confidentiality** is the one capability today's RBAC
  lacks (it gates resources, not fields). The design adds pay-element masking
  keyed on `payroll.viewSalary` — flagged as a required extension, not assumed.
- **Multi-company / branch / currency / country** inherited from the tenant model
  + `Employee.companyId/outletId` + effective-dated `StatutoryRule` packs.
- **Locking, append-only audit, no hard deletes, data retention** as per the
  house conventions (insert-only `PayrollAuditLog`, `FinancialPeriod` locks,
  reverse-never-edit).

### Tanzania statutory caveat

TZ packs (PAYE progressive bands, PSSSF/NSSF pension, NHIF/health, WCF, SDL,
HESLB) are **effective-dated `StatutoryRule` configuration seeded by an
authorized person**, not code, and **not a substitute for professional tax
advice** (per the HR-system compliance caveats). The framework guarantees the
*mechanism* (correct bands applied for the run's date, reproducible historically);
the *rates* are the organisation's responsibility to enter and keep current.

---

## Stage 12 — Integrations

HR/attendance/leave (native), **POS** (tips/service-charge/commission source),
**Scheduling** (attendance source), **Finance/GL** (`lib/ledger.ts` — native),
**Credit** (deduction source + A/R settlement — Phase 5), Banking / **Mobile
Money** (`PaymentBatch` export + reconciliation into Daily Collections),
Procurement/Projects/CRM (cost dimensions), Employee/Manager Self-Service portal,
and government/pension/insurance filing. Seam is **API-first + an event bus**
(`PayrollCalculated`, `PayrollLocked`, `PayrollPosted`, `PaymentIssued`) —
the same extraction seam Credit defines — so ESS, statutory e-filing and future
service extraction subscribe rather than couple.

---

## Stage 13 — Enterprise-readiness review (self-diagnostic)

**Hardcoded assumptions to kill:** currency symbol/format (→ `PayrollModuleConfig`
+ company config), statutory rates (→ effective-dated `StatutoryRule`, never
code), rounding (→ `roundingPolicy`), pay cycle (→ `BusinessPeriodVersion`),
component vocabulary (→ `PayComponent` rows).

**Configuration gaps:** field-level salary masking (RBAC extension required, not
present today); `Department` is free-text on most models (formalize the FK for
cost-centre reporting); no multi-level approval graph yet (shared
`WorkflowDefinition` deferred).

**Missing scenarios now explicitly designed for:** proration
(joiners/leavers/unpaid leave), retro pay (backdated raise *or* backdated
statutory change → correction run), negative net (`negativeNetPolicy`), off-cycle
/ bonus / 13th-month (`runType`), final settlement + terminal benefits, multi
-currency at run-date FX.

**Scale:** materialized run/payslip totals + append-only lines (no history
re-aggregation); runs process employees in chunks inside a `$transaction`;
balance/version discipline + nightly reconciliation, exactly as the Credit ledger.

**Security/performance/integration risks:** salary data at rest (masking +
audit), payout handles kept opaque, biometric/API adapters sandboxed behind the
`source` interface, event bus prevents tight coupling.

**Assumption challenged:** *does payroll need its own period engine?* No —
reusing `BusinessPeriodVersion` is strictly better (one source of truth, already
effective-dated). *Its own approval engine?* Not yet — `WorkflowApproval` covers
single-level today; the graph is a genuine shared future need, not a payroll
-specific one. *Its own ledger?* No — `postJournalEntry` is the single money
choke point and payroll must not bypass it.

---

## Future-proofing

Statuses stay code-level (drive the state machine); everything else is config.
Hooks already latent in the model: `PayrollAuditLog` + snapshots → **AI anomaly
detection / payroll validation**; `PayslipLine` history → **predictive workforce
costing**; event bus → **ESS / Manager SS / digital payslips / e-signatures**;
`terminology` → **multi-language**; effective-dated `StatutoryRule` +
`jurisdiction` → **multi-country compliance packs / plugin architecture**;
SQLite-local setup → **offline payroll capture**; API-first + event seam →
**microservice extraction**.

---

## TIPS seed (planned Phase 1)

Module `"Payroll"` (GLOBAL, **disabled** on install — zero behaviour change),
TZS, monthly cycle from the existing `BusinessPeriodVersion` payroll fields.
Categories: Permanent, Casual (from `User.isCasual`), Director, Event Staff.
One `Employee` per staff `Person`/`User`, linked by the new FK. Components seed:
Basic Salary, Service Charge, Tips, Overtime, Night Shift (earnings) + PAYE,
PSSSF, NHIF, Staff Purchases (`SOURCED=CREDIT_BALANCE`), Salary Advance
(deductions). TZ `StatutoryRule` pack effective the current Finance Act date.
Seeding is idempotent & additive (`lib/payroll-seed.ts`, called from
`lib/seed-core.ts`), following `lib/credit-seed.ts`.

---

## Phasing plan

| Phase | Ships | Behaviour change |
|---|---|---|
| **1 — Foundation** | `Employee` master (+ `User`/`Person` FK), `EmployeeCategory`, `PayGroup`, `PayrollModuleConfig`, resolver (`lib/payroll-config.ts` copying `collection-mode.ts`), seed | None — module disabled; existing deduction report untouched. |
| **2 — Calc** | `PayComponent`, `ComponentAssignment`, `PayrollFormula`, the formula engine, **draft (read-only) payslip preview**; wire `CREDIT_BALANCE` deduction source to `computePayrollReport()` | None to money — preview only. |
| **3 — Run + GL** | `PayrollRun`/`Payslip`/`PayslipLine` lifecycle, approvals, lock, `postJournalEntry` posting, `PaidBill{PAYROLL}` unification | **Closes Credit-framework Phase 5.** First real pay + GL. |
| **4 — Statutory & time** | Effective-dated TZ `StatutoryRule` packs, `AttendanceRecord`/`Timesheet`/`OvertimeRecord` (Scheduling + POS adapters), `LeaveType`/`LeaveBalance`/`LeaveRequest` | Additive. |
| **5 — Output & ESS** | Reports/analytics, `PaymentBatch` (bank/mobile-money export), digital payslips, Employee/Manager Self-Service | Additive. |
| **Later** | Multi-level `WorkflowDefinition` graph (shared w/ Credit), biometric/API attendance adapters, AI anomaly detection, multi-country packs, service extraction | Additive. |

Each phase is additive and independently shippable — zero-config always reduces
to today's exact behaviour, the invariant every engine in this codebase holds.

---

## Phase 1 (implemented) — foundation, module disabled

- **Schema** (`prisma/schema.prisma`): `PayrollModuleConfig` (scoped
  GLOBAL→COMPANY→OUTLET, mirrors `CreditModuleConfig`; ships `enabled = false`),
  `EmployeeCategory` + `PayGroup` (`@@unique([companyId, code])`, soft-deletable),
  and `Employee`. One bridge line added to `Person` (`employee Employee?`);
  `Employee.personId` carries the relation, `Employee.userId` is a bare unique
  scalar with no relation (leaves the large `User` model untouched, exactly as
  `CreditAccount.userId`).
- **Design refinement vs the sketch above:** `Employee.personId` and `userId` are
  **both nullable & unique, at least one required** (app-enforced) — not a strict
  1:1-over-`Person`. Reality forced this: floor staff exist only as a `User` (no
  `Person`), directors/admins often only as a `Person`. `Employee` is the unifier
  that holds whichever links exist. Tenant scope (`companyId`/`outletId`) and
  `departmentId` are bare indexed scalars in Phase 1 (a formal `Department` FK
  arrives with cost-centre reporting later).
- **Resolver** (`lib/payroll-config.ts`): `resolvePayrollConfig`
  (OUTLET→COMPANY→GLOBAL, falls back to a **disabled** module),
  `isPayrollEnabled` (the gate every future payroll action must check),
  `resolvePayrollTerminology`, `setPayrollModuleConfig` (GLOBAL via `findFirst`,
  same NULL-scopeId handling as `setCreditModuleConfig`). Mirrors
  `lib/credit-config.ts` exactly.
- **Seed** (`lib/payroll-seed.ts`, called from `lib/seed-core.ts`): idempotent &
  additive — module config (GLOBAL, disabled), 5 employee categories, 3 pay
  groups, and **one `Employee` per `User`**. Deliberately does **not** fuzzy-match
  `User`→`Person` by name (error-prone); the `personId` link (which lets a Phase-3
  run settle a person's signed bills) is a curated admin action. So Phase-1
  employees carry `userId`, `personId = null`.
- **Verified end-to-end** on local SQLite: `prisma validate` + `generate` +
  `db push` clean; `tsc --noEmit` and `eslint` pass; seed produces config
  (`enabled=false`), 5 categories, 3 pay groups, 58 employees = 58 users
  (all `userId`-set, `personId` null); a second full seed reproduces identical
  counts (idempotent, no duplicates). Module disabled ⇒ existing deduction report
  and all other behaviour unchanged.

## Phase 2 (implemented) — components + formula engine + read-only preview

- **Schema**: `PayComponent` (one table for every payslip line kind, discriminated
  by `componentType` + `calcMethod`; `parameters` JSON per method), `PayrollFormula`
  (reusable expression registry), `ComponentAssignment` (attach to a pay group or
  a single employee, effective-dated, employee overrides group). Back-relations
  added to `PayGroup`/`Employee`. Still no run/payslip persistence and no GL.
- **Formula engine** (`lib/payroll-formula.ts`): a **safe, hand-written evaluator**
  — tokenizer + recursive-descent parser over a fixed grammar (arithmetic,
  comparisons, `&&`/`||`/`!`, and a whitelisted function set: `min` `max` `abs`
  `round` `floor` `ceil` `if` `clamp` `prorate`). **Not `eval`**: no property
  access, no host calls, variables come only from the supplied namespace, unknown
  var/function or division-by-zero throw `FormulaError`. `extractVariables` +
  `validateExpression` support dependency ordering and write-time validation.
- **Component calc** (`lib/payroll-components.ts`): `resolveEffectiveComponents`
  (employee-override-beats-group, effective-dated) and `computeComponentAmount`
  for every `calcMethod` — `FIXED` / `PERCENTAGE` (of a named var) / `RATE_QTY` /
  `TABLE` (progressive marginal bands) / `FORMULA` / `SOURCED`. Never throws: a
  bad component yields `{ amount: 0, error }`. **`SOURCED=CREDIT_BALANCE` reads
  the employee's outstanding from the Credit framework** (`CreditAccount.currentBalance`,
  matched by `personId` then `userId`) — returns 0 when unlinked (the normal
  Phase-1 state), so it is safe and activates the moment an admin links an
  Employee to a Person. `LOAN_SCHEDULE`/`ADVANCE`/`STATUTORY` sources are stubbed
  to 0 (later phases); `MANUAL` reads a per-run entry.
- **Preview engine** (`lib/payroll-calc.ts`): `previewPayslip` — **read-only**,
  two-tier (earnings define gross/taxable/pensionable → deductions/employer read
  them), topological ordering within each tier by declared dependencies then
  priority (cycle-safe with a warning), `negativeNetPolicy` applied, period window
  from the **Business Period Engine** (`resolveEffectivePeriodFields` +
  `payrollPeriodForDate` — reused, not reinvented). Returns lines + gross /
  taxable / pensionable / totalDeductions / net / employerCost / totalCost /
  warnings, plus `moduleEnabled`.
- **API**: `GET /api/payroll/preview?employeeId=&date=&overtimeHours=` —
  supervisor-gated (ACCOUNTANT/MANAGER/DIRECTOR/ADMIN), read-only, works whether
  or not the module is enabled (dry-run before switching on).
- **Seed** (`lib/payroll-seed.ts`): a `BASE_PAY` formula, 5 demonstrative
  components (Basic Salary FORMULA, Housing 20% PERCENTAGE, Overtime RATE_QTY,
  Pension 10% PERCENTAGE, Staff Purchases SOURCED=CREDIT_BALANCE) and group-level
  assignments. Idempotent (create-only).
- **Verified end-to-end** on local SQLite (30 checks): evaluator precedence /
  functions / rejection of unknown var/function & div-by-zero; MANAGEMENT preview
  (base 1,000,000 → gross 1,200,000, pension 100,000, net 1,100,000);
  FLOOR_STAFF + 10h overtime (gross 350,000, net 320,000); `CREDIT_BALANCE`
  picking up a linked account's real 100,000 balance. `prisma validate`/`generate`/
  `db push`, `tsc`, `eslint` all clean. Module still disabled ⇒ nothing pays anyone.

### Next: Phase 3 — PayrollRun + payslips + approvals + GL posting (closes Credit Phase 5).
