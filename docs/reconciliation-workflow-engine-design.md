# Reconciliation Workflow Engine — Design Doc (Draft, not implemented)

Status: **design only**. No schema/code changes made. This is a proposal for how to
extend the existing `BusinessDay` + `BusinessCalendarConfig` + `CollectionModeConfig`
engines into the 5-stage Business Day → Cashier Reconciliation → Finance Reconciliation
→ Financial Close → Archived pipeline, without re-platforming what already works.

**v2 update:** incorporates final decisions on scope, auto-close behavior, payment
verification sourcing, and CashRecon/BankRecon integration (§10 below) — the model
changes from those decisions are folded into §3-§7 directly rather than kept as a
separate diff.

## 1. What already exists vs. what the spec asks for

The spec asks for 5 independently-configurable stages. Today the app has **one**
lockable unit — `BusinessDay` (schema.prisma:317) — with states
`OPEN | CLOSED | REOPENED | ARCHIVED`. "Reconciliation" today is folded into that
single Business Day lifecycle via `CashRecon` / `BankRecon` / `CollectionExcess` /
`CashReconExcess`, which are informational reconciliation records attached to a day,
not a separate stage with its own lock/window/permissions.

So the gap is specifically: **Cashier Reconciliation** and **Finance Reconciliation**
need to become first-class stages with their own open/close windows, own required
permissions, own validation rules, and their own audit trail — sitting *after*
Business Day closes, not bundled into it. `Financial Close` (optional) and `Archived`
already exist conceptually (`FinancialPeriod`, `BusinessDay.status = ARCHIVED`) but
aren't wired into a single cross-stage state machine.

## 2. Design principle: generalize, don't duplicate

`BusinessDay`, `BusinessCalendarConfig`, `CollectionModeConfig`, and
`BusinessDayPolicyConfig` all already share one convention:

- A `{scope: GLOBAL|COMPANY|OUTLET(|ROLE), scopeId}` config row, `@@unique([scope, scopeId])`
- Narrowest-scope-wins resolution in a `lib/<engine>.ts` resolver
- A default-safe fallback so an unconfigured deployment behaves exactly as before
- An append-only `*AuditLog` model, field-diff shaped (`field`, `previousValue`, `newValue`, `reason`, actor)

Rather than inventing a new shape, the Reconciliation Workflow Engine reuses this
convention for a **stage-instance** model that generalizes `BusinessDay`'s per-day
row into "one row per (outlet, date, stage)", plus a **stage-config** model that
generalizes `BusinessDayPolicyConfig`'s per-scope policy into "policy per
(scope, stageKey)".

## 3. New data model (additive — `BusinessDay` is kept, not replaced)

```prisma
// One row per (scope-unit, date, stage) — the unit of lock/unlock for each stage.
// BUSINESS_DAY and CASHIER_RECON are per-OUTLET (outletId set, companyId derived).
// FINANCE_RECON and FINANCIAL_CLOSE are COMPANY-wide by default (outletId null,
// companyId set) — Finance owns the whole company's position, including
// transactions that never touch an outlet (sponsor payments, direct bank
// deposits, online payments, head-office receipts). A company that wants
// per-outlet Finance Recon instead sets ReconciliationStageConfig.scope=OUTLET
// for that stageKey — the same row shape supports either grain; outlet-level
// detail is never lost because CASHIER_RECON stays per-outlet underneath, so
// Finance Recon drill-down (outlet/department/counter/cashier/channel/business
// day) is just a query across the child CASHIER_RECON rows + their linked
// DailyCollection/CashRecon/BankRecon records, not a separate storage layer.
// BusinessDay keeps meaning "stage = BUSINESS_DAY" so existing code/queries
// against BusinessDay keep working untouched; this table is the superset.
model ReconciliationStage {
  id            String   @id @default(cuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id])
  outletId      String?  // null for company-wide stages (FINANCE_RECON, FINANCIAL_CLOSE by default)
  outlet        Outlet?  @relation(fields: [outletId], references: [id])
  date          DateTime
  stageKey      String   // BUSINESS_DAY | CASHIER_RECON | FINANCE_RECON | FINANCIAL_CLOSE | ARCHIVED
  status        String   @default("PENDING") // PENDING | OPEN | INCOMPLETE | CLOSED | REOPENED | SKIPPED | ARCHIVED
  openedAt      DateTime?
  closedAt      DateTime?
  closedById    String?
  closedByName  String?
  autoClosed    Boolean  @default(false) // true only when ForceAutoClose policy actually closed it
  gracePeriodEndsAt DateTime? // configurable grace window before escalation/force-close
  escalatedAt   DateTime? // set when grace period expires and validations still fail
  escalatedToRoles String? // JSON array of role strings notified on escalation
  result        String?  // MATCHED | SHORTAGE | EXCESS | MISSING_TRANSACTION (Cashier/Finance Recon only)
  resultDetail  String?  // JSON — variance breakdown by outlet/channel/counter/cashier
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  unlockRequests ReconciliationStageUnlockRequest[]
  auditLogs      ReconciliationStageAuditLog[]
  checkResults   ReconciliationCheckResult[]

  @@unique([companyId, outletId, date, stageKey])
  @@index([companyId, stageKey, status])
  @@index([outletId, stageKey, status])
  @@index([date])
}

// Same request→approve→reopen workflow BusinessDayUnlockRequest already has,
// generalized to any stage.
model ReconciliationStageUnlockRequest {
  id                String              @id @default(cuid())
  stageId           String
  stage             ReconciliationStage @relation(fields: [stageId], references: [id])
  requestedById     String
  reason            String
  requestedDuration String?
  requestedMinutes  Int?
  status            String              @default("PENDING") // PENDING | APPROVED | REJECTED | COMPLETED | EXPIRED
  approverId        String?
  approverComment   String?
  resolvedAt        DateTime?
  completedAt       DateTime?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([stageId, status])
}

// Immutable field-diff audit trail — identical shape to BusinessDayAuditLog.
model ReconciliationStageAuditLog {
  id             String              @id @default(cuid())
  stageId        String
  stage          ReconciliationStage @relation(fields: [stageId], references: [id])
  action         String              // OPEN | CLOSE | REOPEN | LOCK | AUTO_LOCK | UNLOCK_REQUESTED |
                                      // UNLOCK_APPROVED | UNLOCK_REJECTED | UNLOCK_EXPIRED | ARCHIVE |
                                      // RECONCILE_MATCHED | RECONCILE_VARIANCE | ADJUSTMENT_APPLIED
  field          String?
  previousValue  String?
  newValue       String?
  reason         String?
  approvedById   String?
  approvedByName String?
  userId         String?
  userName       String?
  createdAt      DateTime            @default(now())

  @@index([stageId, createdAt])
  @@index([action])
}

// Per-scope, per-stage config — window, close mode, required permission,
// validation strictness. Same GLOBAL→COMPANY→OUTLET shape as
// BusinessDayPolicyConfig/CollectionModeConfig, narrowest wins. `scope` also
// picks the grain a stage instance is created at (see ReconciliationStage
// comment) — FINANCE_RECON defaults to a COMPANY-scope row (one instance per
// company+date), but a company can add an OUTLET-scope override for that
// stageKey to get per-outlet Finance Recon instead.
model ReconciliationStageConfig {
  id                   String   @id @default(cuid())
  scope                String   // GLOBAL | COMPANY | OUTLET
  scopeId              String?
  stageKey             String   // BUSINESS_DAY | CASHIER_RECON | FINANCE_RECON | FINANCIAL_CLOSE
  startTime            String?  // "HH:mm" — when the stage becomes eligible to open; null = opens on prior stage close
  endTime              String?  // "HH:mm" — deadline before validation/escalation runs
  closeMode            String   @default("MANUAL") // MANUAL | AUTO
  requiredRoles        String?  // JSON array of role strings allowed to close/approve this stage
  validationStrictness String   @default("BLOCK_ON_MISSING") // BLOCK_ON_MISSING | WARN_ON_MISSING | ALLOW
  graceMinutes         Int      @default(0) // window after endTime before escalation fires
  reminderMinutesBefore Int?    // auto-reminder lead time before endTime
  isEnabled            Boolean  @default(true) // lets a company skip Finance Recon / Financial Close entirely

  // Auto-close policy: by default the engine only NOTIFIES + ESCALATES on a
  // missed deadline, it never silently locks a stage with unresolved
  // discrepancies. forceAutoClose must be explicitly turned on for
  // closeMode=AUTO to actually transition OPEN/INCOMPLETE -> CLOSED once
  // graceMinutes elapses; escalationRoles are notified either way.
  forceAutoClose  Boolean  @default(false)
  escalationRoles String?  // JSON array of role strings notified when grace period expires

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([scope, scopeId, stageKey])
}

// Plugin-style required-check registry — which reconciliation checks must be
// COMPLETE before a given stage instance can close, configured per
// scope+stageKey rather than hardcoded. Lets one company require
// Cash+Bank+MobileMoney recon before Cashier Recon closes, another add
// Sponsor Recon or Inventory Recon, with zero code change — a new check type
// is just a new row here plus a resolver function registered in
// lib/reconciliation-checks.ts's CHECK_REGISTRY.
//   checkType: CASH_RECON | BANK_RECON | MOBILE_MONEY_RECON | SPONSOR_RECON |
//              INVENTORY_RECON | PAYMENT_VERIFICATION | <custom>
model ReconciliationRequirement {
  id         String   @id @default(cuid())
  scope      String   // GLOBAL | COMPANY | OUTLET
  scopeId    String?
  stageKey   String
  checkType  String
  isRequired Boolean  @default(true) // false = informational only, doesn't block close
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([scope, scopeId, stageKey, checkType])
}

// One row per (stage instance, checkType) — the evaluated result of running
// a ReconciliationRequirement's resolver against that stage's data. Recomputed
// each time the stage's close-validation runs; kept (not deleted) so the audit
// trail shows exactly what passed/failed at close time.
model ReconciliationCheckResult {
  id           String              @id @default(cuid())
  stageId      String
  stage        ReconciliationStage @relation(fields: [stageId], references: [id], onDelete: Cascade)
  checkType    String
  status       String              @default("PENDING") // PENDING | COMPLETE | FAILED | SKIPPED
  detail       String?             // JSON — e.g. { missingOutlets: [...], variance: 12000 }
  sourceModel  String?             // e.g. "CashRecon", "BankRecon" — which existing table this check read
  sourceId     String?             // id of the specific record checked, when applicable
  evaluatedAt  DateTime            @default(now())

  @@unique([stageId, checkType])
}

// Real-time payment verification, independent of which stage is currently open —
// a payment can be verified the moment it's received, ahead of Cashier Recon.
// Sourced from any of: a live API/webhook integration, a batch file import, or
// manual entry — `source` records which, and `sourceRef` ties it back to the
// originating integration/import batch for traceability.
//   source: API | IMPORT | MANUAL | SYSTEM_GENERATED
model PaymentVerification {
  id             String   @id @default(cuid())
  outletId       String?  // null for company-level receipts not tied to an outlet (sponsor/head-office)
  outlet         Outlet?  @relation(fields: [outletId], references: [id])
  companyId      String
  company        Company  @relation(fields: [companyId], references: [id])
  date           DateTime
  reference      String?  // payment reference/code (bank ref, MoMo txn id, till slip no.)
  channel        String   // CASH | CRDB | STANBIC | MPESA | ... (same channel codes as BankRecon)
  amount         Float
  customerName   String?
  paidAt         DateTime?
  status         String   @default("PENDING") // PENDING | VERIFIED | FAILED | DUPLICATE
  source         String   @default("MANUAL") // API | IMPORT | MANUAL | SYSTEM_GENERATED
  sourceRef      String?  // integration connector id, or import batch id
  matchedStageId String?  // links to the ReconciliationStage it was verified against, once matched
  verifiedById   String?
  verifiedAt     DateTime?
  failureReason  String?
  duplicateOfId  String?  // self-reference when status = DUPLICATE
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([companyId, date, status])
  @@index([outletId, date, status])
  @@index([reference])
}

// One row per configured inbound integration (bank/MoMo/gateway webhook, or a
// scheduled file-import connector) that can create PaymentVerification rows
// with source=API or source=IMPORT. Kept generic (name + kind + config JSON)
// so adding a new provider is a data row, not a schema change.
model PaymentIntegrationConnector {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  name        String   // e.g. "CRDB Bank Webhook", "M-Pesa API", "Monthly Bank Statement Import"
  kind        String   // API_WEBHOOK | FILE_IMPORT
  channel     String   // CRDB | STANBIC | MPESA | ...
  config      String?  // JSON — connector-specific settings (endpoint, mapping, credentials ref)
  isActive    Boolean  @default(true)
  lastSyncAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([companyId, isActive])
}
```

`FinancialPeriod`/`JournalEntry` (already in schema, line ~2200s) remain the system of
record for the optional **Financial Close** stage — `ReconciliationStage{stageKey:
FINANCIAL_CLOSE}` becomes the lock/gate in front of period-close actions that already
exist, it doesn't duplicate ledger data.

## 4. Stage state machine

```
PENDING → OPEN → CLOSED → (REOPENED → CLOSED)* → ARCHIVED
             ↓
        INCOMPLETE  (endTime + graceMinutes elapsed, required checks still failing)
             ↓
        escalate to escalationRoles (always) ─┬─ forceAutoClose=false (default): stays INCOMPLETE,
                                               │   re-notify on a reminder cadence until a human closes it
                                               └─ forceAutoClose=true: transitions to CLOSED,
                                                   autoClosed=true, result carries the failing
                                                   checks so nothing is silently hidden

              stage N+1 cannot open until stage N is CLOSED
              (isEnabled=false on a stage lets it auto-transition
               straight to CLOSED with result=SKIPPED)
```

Auto-close is opt-in and notify-first by design — the default posture is "never
lock-and-skip an unresolved discrepancy":

1. At `endTime`, the engine runs every `ReconciliationRequirement` registered for that
   (scope, stageKey) against the stage's data, writing one `ReconciliationCheckResult`
   per check.
2. All required checks `COMPLETE` → stage auto-closes normally (`status: CLOSED`,
   `autoClosed: true`, no escalation).
3. Any required check not `COMPLETE` → `status: INCOMPLETE`, notify the stage's
   `requiredRoles` immediately (not yet an escalation).
4. If `graceMinutes` elapses and it's still `INCOMPLETE` → `escalatedAt` set,
   notify `escalationRoles` (Supervisor/Admin/Finance, configurable). The stage
   **stays OPEN/INCOMPLETE** — operational data is not locked out from correction —
   unless...
5. `ReconciliationStageConfig.forceAutoClose = true` for that scope+stageKey, in
   which case the engine transitions `INCOMPLETE → CLOSED` at that point,
   `autoClosed: true`, and `resultDetail` carries the list of failing checks so the
   variance is visible downstream (Finance Recon sees it, it's never hidden).

`lib/reconciliation-stage.ts` (new, mirrors `lib/business-day.ts`) exposes
`openStage()`, `runCloseValidation()`, `closeStage()`, `reopenStage()`,
`checkGraceAndEscalate()`, and `advanceToNextStage()` — the only place that knows the
fixed stage order `[BUSINESS_DAY, CASHIER_RECON, FINANCE_RECON, FINANCIAL_CLOSE,
ARCHIVED]`.

- `BusinessDay` (existing model) stays as-is; `closeStage('BUSINESS_DAY', ...)`
  writes through to it so every existing screen/report keeps working, while also
  creating the generalized `ReconciliationStage` row other stages key off of.
- Closing `BUSINESS_DAY` operationally means: lock `Bills/Collections/Sales/Expenses/
  Inventory` entry for that (outlet, date) — already enforced today via `BusinessDay`
  checks in the collection/bill API routes; unchanged.
- `CASHIER_RECON` closing is gated purely by its `ReconciliationRequirement` list —
  default registry ships with `CASH_RECON` and `BANK_RECON` check types whose
  resolvers read the existing `CashRecon`/`BankRecon` tables (see §6), so no new UI
  is required to reach parity with today; a company can add `MOBILE_MONEY_RECON`,
  `SPONSOR_RECON`, `INVENTORY_RECON`, etc. purely by inserting
  `ReconciliationRequirement` rows plus registering a resolver.
- `FINANCE_RECON` defaults to **COMPANY** scope (`ReconciliationStage.outletId =
  null`) — Finance reconciles the company's whole position, including receipts that
  never touch an outlet (sponsor payments, direct bank deposits, online payments,
  head-office receipts, all captured via `PaymentVerification`). Its close-validation
  checks: (a) every child `CASHIER_RECON` stage for that company+date is `CLOSED`,
  (b) every `PaymentVerification` row for that company+date is `VERIFIED` or
  explicitly written off. Drill-down to outlet/department/counter/cashier/channel/
  business day is a read query joining `ReconciliationCheckResult`/child
  `CASHIER_RECON` stages back to `DailyCollection`/`CashRecon`/`BankRecon` — no
  separate storage. A company that wants Finance Recon signed off per outlet instead
  sets an OUTLET-scope `ReconciliationStageConfig` override for `FINANCE_RECON`.

## 5. Payment verification vs. stage closing

`PaymentVerification` is deliberately **not** a required child of any one stage — a
payment can come in (via API webhook, file import, or manual entry — see `source`
field) and get matched/verified in real time, independent of whether Cashier Recon
has opened yet. `PAYMENT_VERIFICATION` is itself a pluggable `checkType` — a company
can add it to `CASHIER_RECON`'s or `FINANCE_RECON`'s requirement list so
close-validation surfaces any `PENDING`/`FAILED`/`DUPLICATE` rows for that window as
blocking issues (same `missingItems` JSON-array pattern `BusinessDay.missingItems`
already uses, now generalized as `ReconciliationCheckResult.detail`).

Ingestion priority when the same payment could arrive from more than one source
(e.g. a webhook fires and the monthly statement import also lists it): `API` >
`IMPORT` > `MANUAL`, matched by `(channel, reference, amount)` — a later lower-
priority arrival for an already-`VERIFIED` reference is written as `status:
DUPLICATE` with `duplicateOfId` set, never silently overwriting the earlier record.

## 6. CashRecon / BankRecon — gate, don't redesign

Decision: **do not redesign or migrate `CashRecon`/`BankRecon` now.** They keep their
current tables, screens, and APIs exactly as-is. The new stage engine only *reads*
them to decide whether `CASHIER_RECON` can close:

- `CASH_RECON` check resolver: for the stage's (outlet, date), every expected
  `CashRecon` row exists and has `verifiedAmount` set (matches today's manual
  verification step) — writes `ReconciliationCheckResult{checkType: CASH_RECON,
  sourceModel: "CashRecon", sourceId: <row id>}`.
- `BANK_RECON` check resolver: same, but per channel — every `BankRecon` row for that
  (outlet, date, channel) has `verifiedAmount` set, `sourceModel: "BankRecon"`.
- If a company adds `MOBILE_MONEY_RECON`/`SPONSOR_RECON`/`INVENTORY_RECON` etc. later,
  each is its own resolver reading whatever table already models that domain (or a
  new minimal one, decided when that requirement is actually built) — the stage
  engine itself never needs to change, only `CHECK_REGISTRY` grows one entry.

This keeps the initial build small: the stage/config/audit models plus two check
resolvers (Cash, Bank) reading data that already exists, rather than a parallel
reconciliation data layer.

## 7. Permissions

Reuse `lib/rbac.ts`'s existing per-user-override > role-default > deny resolution.
Add a new resource namespace `RECONCILIATION_STAGE_RESOURCES` (boolean-only, same
shape as `BUSINESS_DAY_RESOURCES`) with one resource per action per stage, e.g.
`CASHIER_RECON.CLOSE`, `FINANCE_RECON.APPROVE_ADJUSTMENT`, `FINANCIAL_CLOSE.LOCK`.
`ReconciliationStageConfig.requiredRoles` overlays this — if set, it further narrows
who can act on that specific stage instance beyond the general resource permission
(useful for "only the Finance Manager for this specific company can close Finance
Recon", without touching global RBAC).

## 8. Late/adjustment workflow

The spec's "late receipts must use an approved adjustment workflow with full audit
logs" maps directly onto the existing `WorkflowApproval` model (schema.prisma:646) —
add a third nullable FK `reconciliationAdjustmentId` (mutually exclusive with
`stageRecordId`/`transactionId`, same pattern already used) pointing at a new minimal
`ReconciliationAdjustment` record (amount, reason, target stage, target channel).
Approval flows through the same `/api/collection-approvals`-style notify pipeline
already built; every resolution writes a `ReconciliationStageAuditLog` row.

## 9. API surface (new, additive)

- `lib/reconciliation-stage.ts` — resolver + state machine (see §4)
- `lib/reconciliation-checks.ts` — `CHECK_REGISTRY` of `checkType -> resolver`
  (§6), invoked by `runCloseValidation()`
- `lib/payment-verification.ts` — create/match/verify/flag-duplicate, ingestion
  priority logic (§5)
- `app/api/reconciliation-stages/route.ts` — list/get stage status per
  company/outlet+date, with drill-down query params
- `app/api/reconciliation-stages/[id]/close|reopen|unlock-request/route.ts`
- `app/api/reconciliation-stage-config/route.ts` — admin CRUD, same shape as
  existing `business-calendar-config` / `collection-mode-config` admin routes
- `app/api/reconciliation-requirements/route.ts` — admin CRUD for the plugin
  check registry (§3/§6)
- `app/api/payment-verifications/route.ts` + `/[id]/verify|reject|mark-duplicate`
- `app/api/payment-integration-connectors/route.ts` — admin CRUD +
  `/[id]/webhook` (inbound API) and `/[id]/import` (file upload) endpoints that
  both write `PaymentVerification` rows with the matching `source`

## 10. Migration path (no big-bang cutover)

1. Add the new models; backfill one `ReconciliationStage{stageKey: BUSINESS_DAY}`
   row per existing `BusinessDay` row (status/timestamps copied 1:1).
2. Ship with `ReconciliationStageConfig{isEnabled: false}` default for
   `CASHIER_RECON`/`FINANCE_RECON`/`FINANCIAL_CLOSE` at GLOBAL scope, and an empty
   `ReconciliationRequirement` registry — every company keeps today's single-stage
   behavior with zero setup, exactly like `BusinessCalendarConfig` and
   `CollectionModeConfig` do.
3. A company opts in per stage (and per scope) via the new admin config screen,
   picking which checks are required for each stage from the registry; nothing else
   in the app needs to change to support that company running a longer pipeline
   while another still runs Business-Day-only.
4. `forceAutoClose` ships `false` everywhere — every company gets notify-and-escalate
   behavior by default; a company must explicitly opt in to true auto-close.

## 11. Decisions locked in (for reference)

| Question | Decision |
|---|---|
| Finance Recon scope | Company-wide by default, with outlet/department/counter/cashier/channel/business-day drill-down via child `CASHIER_RECON` stages; per-outlet override available |
| Auto-close | Notify + escalate by default; stage stays `INCOMPLETE` until a human closes it unless `forceAutoClose` is explicitly enabled |
| PaymentVerification sourcing | API/webhook, file import, and manual entry all supported; every row tagged with `source`; API > IMPORT > MANUAL on conflicting matches |
| CashRecon/BankRecon | Not redesigned — kept as-is; new stage engine gates on their existing data via pluggable check resolvers |
| Required-checks model | Plugin/config-driven (`ReconciliationRequirement` + `CHECK_REGISTRY`), not hardcoded — new check types (Mobile Money, Sponsor, Inventory recon, ...) are additive, no schema change to the stage engine itself |

## 12. §12 decisions (locked in) — notification, reminders, pilot scope, write-off

### 12.1 Escalation notification channel

In-app notification is mandatory and always fires first; email is mandatory in
addition for anything that reaches escalation level (not for the first reminder).
SMS/WhatsApp is a later, configurable add-on — the notifier is built pluggable now so
adding it later is a new channel implementation, not a redesign.

- `ReconciliationStageConfig` gets a `notifyChannels` JSON field (default
  `["IN_APP"]` for Level 1 reminders, engine always adds `EMAIL` automatically once
  escalation fires regardless of config — escalation email is not optional).
- `lib/reconciliation-notify.ts` (new) exposes `notify(level: 'REMINDER' |
  'ESCALATION', stage, recipients)` — looks up each recipient's role/user via the
  existing `notifyResourceHolders`/`listUsersWithResourcePermission` (lib/notifications.ts),
  writes `Notification` rows for all of them, and additionally calls `lib/email.ts`'s
  `sendMail()` for escalation-level (and any reminder where `notifyChannels` includes
  `EMAIL`), using each recipient's `User.email`.
- Message content follows the two-level template in the brief:
  - Level 1 (reminder): "Missing {checkType label} — Outlet: {outlet}, Business Day:
    {date}, Responsible: {assignee}. Action required."
  - Level 2 (escalation): "Escalation Alert — {checkType label} incomplete for
    {elapsed}. Assigned: {assignee}. Escalated to: {escalationRoles}."
- SMS/WhatsApp: reserved as a third `notifyChannels` value (`SMS`/`WHATSAPP`); not
  built in this pass — `notify()`'s channel dispatch is a switch that a future
  provider integration extends without touching callers.

### 12.2 Reminder cadence

Fully configurable per company via a new `ReconciliationReminderPolicy` config row
(same GLOBAL→COMPANY→OUTLET scope shape as every other config table here). Default
(used when no row exists at any scope — zero-setup parity, same convention as
`BusinessDayPolicyConfig`):

```
Stage opens (0 min)
  ↓
First reminder to responsible user — 30 min after open (or after endTime, whichever
  cadence anchor is configured — see reminderAnchor below)
  ↓
Second reminder, escalated to supervisor — 2 hours after open/endTime
  ↓
Full escalation to Finance/Admin (escalationRoles) — at end of the stage's
  reconciliation window (endTime + graceMinutes)
  ↓
After deadline — an exception report is generated (see §12.2.1)
```

```prisma
model ReconciliationReminderPolicy {
  id                     String   @id @default(cuid())
  scope                  String   // GLOBAL | COMPANY | OUTLET
  scopeId                String?
  stageKey               String?  // null = applies to all stages at this scope
  reminderAnchor         String   @default("STAGE_OPEN") // STAGE_OPEN | END_TIME
  firstReminderMinutes   Int      @default(30)   // -> notify responsible user (Level 1)
  secondReminderMinutes  Int      @default(120)  // -> notify supervisor (Level 1, escalated recipient)
  escalationAtEndOfWindow Boolean @default(true) // Level 2 fires at endTime+graceMinutes regardless of above
  generateExceptionReport Boolean @default(true) // after deadline, see 12.2.1
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([scope, scopeId, stageKey])
}
```

Firing is lazy-check-on-read, the same pattern `autoLockExpiredBusinessDays()`
already uses (no per-minute cron available) — any read of an `OPEN`/`INCOMPLETE`
`ReconciliationStage` calls `checkGraceAndEscalate()` first, which compares `now()`
against the resolved policy's thresholds and fires whichever reminder/escalation
tier hasn't already been sent (tracked via a `lastReminderTier` field on
`ReconciliationStage`, so re-reads don't re-notify).

#### 12.2.1 Exception report

"After deadline → create exception report" is a read-model, not a new mutable
table: `GET /api/reconciliation-stages/exceptions?date=&outletId=` returns every
stage past its full escalation point, joined with its failing
`ReconciliationCheckResult` rows — the report is generated on demand from data
that already exists (`ReconciliationStage` + `ReconciliationCheckResult` +
`ReconciliationStageAuditLog`), not stored separately.

### 12.3 Pilot integration target

Phase 1 pilot is the internal payment ecosystem already running in this app — no
external bank/MoMo API integration in the first cut:

```
Sales/Bills → Cashier Collection → Payment Verification → Cash Recon → Finance Recon
```

Sources wired in this phase, all via the adapter architecture already designed in
§3 (`PaymentIntegrationConnector.kind: API_WEBHOOK | FILE_IMPORT`, plus direct
`MANUAL`/`SYSTEM_GENERATED` writes):

- **Cash** — `source: SYSTEM_GENERATED`, auto-created from `CashRecon` rows as they're
  entered (no separate re-entry).
- **Bank transfer / Mobile Money** — `source: SYSTEM_GENERATED` from `BankRecon` rows
  per channel, same as Cash; `source: MANUAL` for anything entered directly against
  `PaymentVerification` ahead of a `BankRecon` row existing (early verification).
- **POS/MyPOS payments** — `source: SYSTEM_GENERATED` from `PosPayment` rows,
  the highest-volume internal source and the reason this is the highest-value pilot
  flow (it's where most transactions already originate).
- Excel import and true external API/webhook connectors (real bank, real MoMo
  gateway) are the adapter's next two `kind`s — the connector table and
  `PaymentIntegrationConnector.config` JSON shape are built now so adding either
  later needs no reconciliation-engine change, only a new connector row + a
  small adapter function that calls `createPaymentVerification()`.

### 12.4 Write-off handling

No user, including Admin, can delete or silently adjust a reconciliation
discrepancy. A `WriteOffRequest` is a separate, non-destructive record — it never
edits `CashRecon`/`BankRecon`/`DailyCollection` or any original transaction; the
original discrepancy stays exactly as recorded.

```prisma
model WriteOffRequest {
  id               String   @id @default(cuid())
  reconciliationStageId String?
  reconciliationStage   ReconciliationStage? @relation(fields: [reconciliationStageId], references: [id])
  sourceModel      String   // "CashRecon" | "BankRecon" | "CollectionExcess" | "CashReconExcess" | ...
  sourceId         String   // id of the specific discrepancy record being written off
  expectedAmount   Float
  receivedAmount   Float
  amount           Float    // expectedAmount - receivedAmount, the amount being written off
  reason           String
  evidenceUrl      String?  // uploaded evidence attachment (receipt, screenshot, statement excerpt)
  status           String   @default("PENDING") // PENDING | APPROVED | REJECTED | CANCELLED
  requestedById    String
  requestedByName  String
  approverId       String?
  approverName     String?
  approverComment  String?
  resolvedAt       DateTime?
  journalEntryId   String?  // set once approved — the accounting adjustment entry created
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  auditLogs WriteOffAuditLog[]

  @@index([status])
  @@index([sourceModel, sourceId])
}

model WriteOffAuditLog {
  id            String          @id @default(cuid())
  writeOffId    String
  writeOff      WriteOffRequest @relation(fields: [writeOffId], references: [id])
  action        String          // REQUESTED | APPROVED | REJECTED | CANCELLED | JOURNAL_ENTRY_CREATED
  reason        String?
  userId        String?
  userName      String?
  createdAt     DateTime        @default(now())

  @@index([writeOffId, createdAt])
}
```

Flow: Cashier/Supervisor requests (amount, reason, evidence) → Finance Manager
approves/rejects (via the same `WorkflowApproval`-style role-gated action, resource
`WRITE_OFF_RESOURCES.APPROVE`) → on approval, `lib/write-off.ts` creates a
`JournalEntry` adjustment against the existing Finance Platform ledger
(`Account`/`JournalEntry`/`JournalLine`, already in schema) and stamps
`journalEntryId` back onto the request — the original `CashRecon`/`BankRecon` row is
untouched, so the raw discrepancy remains visible in the audit trail forever,
alongside the approved write-off that explains it.
