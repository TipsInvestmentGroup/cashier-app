# Expense Module Upgrade — Implementation Record

Running record of the build described in
[`expense-module-upgrade-brief.md`](expense-module-upgrade-brief.md): decisions
taken, what was already built before it started, what each phase shipped, how it
was verified, and what was deliberately deferred.

The brief is the requirement. This document is what was actually done and why —
read it before changing anything in this area, because several of the choices
below deliberately diverge from the brief's literal wording.

**Started:** 2026-08-05. Branch `feature/expense-three-funds`.

---

## The starting position was not what the brief assumed

Both briefs open with "Petty Cash is a single module with one funding pool".
That was already out of date. Commit `071df1f` *"Begin petty-cash → Expense
Framework migration (Phases 0-5)"* had already shipped most of the earlier
version of the brief (§1–§6). Before writing any code, the following already
existed:

| Brief asks for | Already existed as |
|---|---|
| `Custodian` entity | `FundingSource` (`outletId`, `responsibleUserId`, `sourceType`) + `FundingSourceCustodian` (M:N — a fund may have several custodians) |
| `Ledger` / `LedgerEntry` | `FundingSourceTxn` — append-only signed rows (`OPEN\|REPLENISH\|PAYMENT\|ADJUST`), running balance via `listFundingSourceLedger()` |
| §5 per-type balance logic | `getFundingSourceBalance()` in `lib/expense-ledger.ts`, already branching by `sourceType` |
| §7 notifications | `lib/notifications.ts` — in-app + email, with 7 `EXPENSE_*` event types already wired through `lib/expense-workflow.ts` |
| §3 request form | `/expense-requests` — but funding source is chosen at *payment* time, not on the request |

**§5's Cashier Cash question was already answered by the code.**
`computeAvailableCashToday()` in `lib/cash-recon.ts` computes
`previousClosing` (yesterday's `CashRecon.closingBalance`) `+ DailyCollection.cash`
`+ cash paid bills − cash disbursements`. `DailyCollection` stores `cash` and
`systemSales` as **separate columns**, one row per `staffName` — so it already
reads the physical handover figure per staff member, not the Sales Import total.
The brief's concern was already satisfied.

### Two places the code and the brief disagree

Both resolved in favour of the code, deliberately:

1. **The cashier formula also adds cash received on paid bills and subtracts
   cash already disbursed.** §5's formula omits both. The code is right — that
   cash physically enters and leaves the drawer.
2. **Petty Cash balance is all-time** (`opening + Σreplenish − Σpayments`), not
   "since last top-up" as §5 says. All-time is the correct conservation formula
   and reconciles to the ledger; "since last top-up" would drift.

---

## Decisions taken 2026-08-05

| Question | Decision |
|---|---|
| Approval chain: shared or per fund? | **Per funding source.** The chain is not stored — it is whoever holds a `FIRST_APPROVER`/`SECOND_APPROVER` grant for that fund's class and outlet, so each fund gets its own chain purely from grant rows. |
| Two-tier approval always, or threshold? | **Threshold.** Requests at/below `FundingSource.approvalThreshold` skip the chain and land in the custodian's Ready-to-Pay queue. `0` = never skip. |
| Notification channels at launch | **In-app + email.** Both already implemented. `WHATSAPP` is a valid channel value the dispatcher ignores until that integration exists, so enabling it later needs no schema change. |
| Who executes an approved top-up allocation? | **The Second Approver's approval executes it directly.** No separate allocator to staff, no approved-but-unallocated limbo. `ALLOCATOR` exists as a reserved grant type so splitting execution back out later is config, not a migration. |
| Can the allocated amount differ from the requested amount? | **Yes** — the approver may adjust at approval (a cheque rounded to 500,000 against a 487,300 request). Both figures are stored (`amount`, `allocatedAmount`) so the variance stays auditable. |
| Keep a no-approval admin override for allocations? | **Yes**, gated to admin and flagged in the ledger as unapproved. Removing it entirely risks locking the business out operationally. |
| Custodian scoping | Grant `outletId` is **nullable — null means business-wide**. One person can custody or approve across both Mikocheni and Coco Beach, which the existing `FundingSourceCustodian` M:N already permitted. |
| Digital bank balance: manual or integration? | **Neither is new** — a `BANK`/`MOBILE_MONEY`/`CARD` fund wraps a `CompanyPaymentAccount` and computes live from its GL balance. Already built. |
| Migrate historical Petty Cash requests? | **No** — already locked as side-by-side rollout (design doc Stage 16 decision 1). `PettyCash.expenseRequestId` stays null until a flow is cut over. |

---

## The `Custodian` / `Ledger` / `LedgerEntry` tables were NOT created

The brief's build order step 1 asks for `Custodian`, `FundingSource`, `Ledger`,
`LedgerEntry`, `AccessGrant`. Three of those were not built, on purpose:
`FundingSource`, `FundingSourceCustodian` and `FundingSourceTxn` already model
exactly those things, and forking them would create the dual source of truth
[`expense-disbursement-framework-design.md`](expense-disbursement-framework-design.md)
rejects throughout.

The brief's three fund "types" are therefore a **derived view** over
`FundingSource.sourceType` (`lib/expense-funds.ts` `fundClassOf`), not a stored
column that could drift from the balance logic already branching on the same
field:

| Fund class | `sourceType` | Balance source | Allocation mode |
|---|---|---|---|
| `CASHIER_CASH` | `CASHIER_DRAWER` | live cash-recon position | `ROLLING_CASH_BALANCE` |
| `PETTY_CASH` | `CASH` | materialized + txn ledger | `FIXED_ALLOCATION` |
| `DIGITAL` | `BANK` / `MOBILE_MONEY` / `CARD` | live GL balance | `BANK_BALANCE` |

Verified consistent with `expense-ledger.ts:29-59`, `expense-payments.ts:47-181`
and `expense-seed.ts:143`.

**`sourceType: OTHER` maps to no fund class.** Folding a director/project float
into Petty Cash would put money under a custodian who never agreed to hold it.
Those sources keep working as they do today and simply do not appear in the three
fund screens.

---

## Phase 1 — data model (`05956dc`)

Additive only; every new column defaulted, so existing rows keep their exact
meaning.

**New models:** `ExpenseAccessGrant`, `ExpenseNotificationRule`,
`NotificationPreference`.

**`FundingSource`** gained `approvalThreshold`, `escalationHours`,
`lowBalanceThreshold` — the per-fund *policy*. The chain itself is not stored
here (see decisions above); Cashier Cash and Digital need materially different
thresholds and SLAs even under one request type, which is why the policy is
per-fund rather than on `RequestType`.

**`ExpenseRequest`** gained `direction` (`OUT` default), `fundingSourceId`,
`allocatedAmount` — so §8's top-up reuses this table with the direction
reversed, inheriting `WorkflowApproval`, the status machine and the notification
engine instead of forking a parallel flow.

**New module:** `lib/expense-funds.ts` — fund-class derivation,
`allocationModeFor()`, `supportsManualAllocation()`.

### Three latent defects found by the pre-commit diagnostic

Adding `direction` opened these; all three would have detonated in Phase 8:

1. **`createExpensePayment` would have disbursed against a top-up request.** An
   approved `IN` row satisfies the existing `APPROVED`/`PARTIALLY_PAID` status
   gate, so money would have left the fund on a request meant to bring money
   *in*, crediting the ledger twice. Guarded at the single payment choke point.
2. The requests list would have mixed top-ups into "my expense requests".
3. The expense report would have counted top-ups as expenditure, overstating
   spend by every replenishment in the period.

### `ExpenseAccessGrant`'s unique index does not enforce what it looks like

`fundClass`, `outletId` and `revokedAt` are all nullable, and **both SQLite and
Postgres treat NULLs as distinct in a unique index** — so the commonest case (a
live, business-wide grant, where `outletId` and `revokedAt` are both null) would
not be rejected by the database at all. The constraint is a backstop only. Real
enforcement lives in `lib/expense-grants.ts` `grantAccess()`. Do not trust the
index as a database guarantee.

---

## Phase 2 — Manage Access, §4 (`bb06bae`)

- **`lib/expense-grants.ts`** — grant/revoke/query, with the uniqueness
  enforcement above.
- **`app/api/expense/access-grants`** (+ `[id]`) — ADMIN-gated list/grant/revoke.
  `POST` accepts a batch of flags so "add a user and tick the boxes" is one
  atomic request rather than six that could half-apply.
- **Manage Access tab** in Expense Settings — grouped by user, revoked audit
  trail behind a toggle.

The six flags in §4 are **five grant types**: the three custodian flags are one
`CUSTODIAN` type carrying a `fundClass`. Holding the petty cash float does not
make someone the Digital custodian, and `(grantType, fundClass)` says that in one
place instead of three enum values each needing their own branch downstream.

The grant vocabulary lives in `lib/shared-constants.ts` (dependency-free by
design) so the client component can read it without pulling Prisma into the
bundle; `lib/expense-grants.ts` re-exports it for server callers — the pattern
`lib/cash-verify.ts` already uses for `CASH_VERIFIERS_FIXED`.

### `ExpenseAccessGrant(CUSTODIAN)` vs `FundingSourceCustodian`

Not duplicate records of one fact:

- **`ExpenseAccessGrant(CUSTODIAN, fundClass)` = eligibility.** "May hold a Petty
  Cash fund at Mikocheni." §4's wording is precisely "who *can* be assigned".
- **`FundingSourceCustodian(fundingSourceId, userId)` = the assignment.** "Holds
  *this* fund row."

One fund class can have several `FundingSource` rows (two outlets, or a float per
site), so eligibility cannot substitute for the assignment, and the assignment
cannot express "eligible but not currently holding anything".

---

## Phase 3 — custodian setup + §5 balance logic

**Eligibility is now enforced on assignment.** `assignFundingSourceCustodian()`
checks the `CUSTODIAN` grant for the fund's class and outlet before writing the
assignment, closing the gap Phase 2 documented. Two deliberate escape hatches: a
fund with no fund class (`OTHER`) is exempt rather than unassignable, and
`skipEligibilityCheck` exists for the backfill path, which derives grants *from*
these assignments and so cannot require them first.

The rejection surfaces as **400 with its message**, not 500 — it is a validation
failure, and the message tells the admin to grant access under Manage Access.

**`scripts/backfill-custodian-grants.ts`** must run before that enforcement
reaches real data, or the Funding Sources screen starts rejecting people who
legitimately hold a fund today. Idempotent; run once against production after
deploy:

```
npx tsx scripts/backfill-custodian-grants.ts
```

It backfills from both `FundingSourceCustodian` rows and each fund's legacy
single `responsibleUserId`, skips funds with no fund class, and skips
deactivated users (whose grants `usersWithGrant` filters out at read time
anyway).

**The custodian picker now reads eligibility from grants, not `User.role`.** It
previously offered anyone with a management role, which would let an admin assign
a fund to someone the access list never authorized. New endpoint
`GET /api/expense/access-grants/eligible?grantType=&fundClass=&outletId=`.
ADMIN-only for now — Phase 4's "Requested By" dropdown needs the same primitive
with `grantType=REQUEST` and will have to widen it. Deliberately not widened
ahead of a caller, since the response carries names and emails.

**§5 balance logic is now surfaced for every type, not just `CASHIER_DRAWER`.**
`GET /api/expense/funding-sources` returns a computed `availableBalance` for
every fund plus derived `fundClass` / `allocationMode` /
`supportsManualAllocation`, so no caller needs to know which types materialize a
balance and which compute it live. The old `liveBalance` field is gone (its only
consumer was the settings page).

**Allocation UI is gated by one shared rule.** `allowsManualAllocation(sourceType)`
in `lib/expense-funds.ts` is the single definition, used by both the Funding
Sources editor and the ledger screen, so they cannot disagree with each other or
with `replenishFundingSource()`'s own guard. `OTHER` deliberately stays
allocatable — silently removing its allocation UI would strand any
director/project float relying on it.

Where the allocation panel is hidden, the ledger screen now says **why** —
otherwise a custodian reasonably concludes the screen is broken.

**Per-fund policy is editable**: `approvalThreshold`, `escalationHours`,
`lowBalanceThreshold` on the Funding Sources editor, with negatives clamped to 0
(the meaningful "off" for all three).

---

## Phase 4 — Expense Form funding source + routing, §3

**The Expense Form now leads with "Pay From".** Selecting a fund drives
everything below it: the custodians who will pay it (shown inline, with a warning
when none are assigned), the available balance, and whether the amount is below
the fund's threshold and so needs no approval at all. `createExpenseRequest`
accepts `fundingSourceId` and `direction`, validates the fund is active and
allowed by the request type, and enforces its per-request `dailyLimit`.

**§5 balance validation is per fund.** The policy *value* is still the existing
`ExpenseModuleConfig.allowOverBudget` (`BLOCK|WARN|APPROVE`); what changed is
that it is evaluated against **each fund's own computed balance** instead of one
shared pool. `WARN`/`APPROVE` return a `balanceWarning` ("allow but flag"),
`BLOCK` throws. A `direction=IN` top-up skips the check entirely — it *adds* to
the fund, so measuring it against the current balance would be backwards.

**Approval is routed by grant, not by job title.** This is the significant
behavioural change:

- `WorkflowApproval.approverRole` now holds a **stage grant**
  (`FIRST_APPROVER`/`SECOND_APPROVER`) for expense approvals, rather than a
  `User.role`. Use `isStageGrant()` to tell the two apart.
- The chain is two-tier by design (§4 defines exactly those two stages), narrowed
  to the stages actually staffed for that fund class and outlet. Stage 2 is
  dropped when nobody holds `SECOND_APPROVER`, since a two-tier chain with an
  empty second tier would strand every request in `PENDING_APPROVAL` forever.
- The chain is scoped to the **fund's** outlet when it has one, not the
  requester's — a fund belongs to an outlet, and its approvers are whoever holds
  access there.
- **Submission is refused when approval is required but stage 1 is unstaffed.**
  Auto-approving would let a forgotten access grant turn into unapproved money
  going out; leaving it pending with no approver would strand it invisibly. The
  error names the fix.
- `RequestType.approverRoles` is kept purely as the "does this need approval at
  all" switch (unchanged semantics); grants decide *who*.

Both consumers of `WorkflowApproval` had to follow:
`GET /api/collection-approvals` fetches expense rows alongside role-matched ones
and narrows them by grant in code (they can't be filtered by `approverRole` in
SQL), and the decide endpoint checks the grant instead of role equality —
**without which anyone sharing the approver's job title could decide it**, exactly
what §4 exists to prevent. Rows whose `approverRole` is a `User.role` predate this
and keep the role test, so nothing already pending vanishes on deploy.

**The threshold shortcut still nudges the custodian.** A skipped request is
immediately payable, so it fires the same `READY_FOR_PAYMENT` notification a
fully-approved one does — otherwise the shortcut would make small requests *less*
visible than large ones.

**Requesting Access is enforced with a zero-rows-means-off gate**
(`requestGateActive`). Until any `REQUEST` grant exists, submitting stays open to
any authenticated user exactly as before, so this needed no backfill. The
trade-off is deliberate and worth knowing: **granting `REQUEST` to one user
silently closes the gate for everyone else.** Management roles may raise a
request on someone else's behalf, but that person must still hold the grant.

`/api/expense/access-grants/eligible` was widened, but split rather than opened:
ADMIN (or a `COLLECTION_APPROVALS` holder) may query any grant type; everyone who
can reach the Expense Form may query `REQUEST` only, so the approval structure
stays hidden.

### A resolver bug found while verifying this

`resolveExpenseModuleConfig` only ever derived the company **from an outlet**, so
any caller without an `outletId` skipped straight to `GLOBAL` and **silently
ignored a company-scoped policy an admin had deliberately saved**. That hit the
new per-fund `BLOCK` check (a request with no outlet), and also
`GET /api/expense/config` — meaning the Expense Settings screen was already
showing global defaults rather than the saved company config. The resolver now
takes an optional `companyId` and falls back to the default company, so the
COMPANY tier is always reachable. Note this is a real behaviour change for any
deployment that had saved company-scoped config: it now takes effect.

---

## Phase 5 — per-custodian ledger views + nav restructure, §1/§2

**The sidebar section is renamed `Petty Cash` → `Expenses`** and its sub-items
restructured. `PETTY_TABS` became `EXPENSE_TABS` (with a back-compat alias, so
the seven pages importing `PETTY_TABS` needed no edit). The module's default
terminology label is now `Expenses` too (still admin-editable).

**One ledger page serves all three fund classes via `?fund=`.** Cashier Ledger,
Petty Cash Ledger and Digital Expenses Ledger are three nav entries into
`/petty-cash-ledger` differing only by query string — the per-custodian ledger
views of §2 as one screen rather than three near-identical pages. The page reads
`?fund=`, filters the fund dropdown to that class (via `sourceTypesFor`), titles
itself accordingly, and reselects within the class when the view changes.

`SectionTabs` was made **query-aware** to support this: a tab whose href carries
a `?fund=` only matches when that query is present, so the three ledger tabs
highlight independently instead of all lighting up on the shared path. Because
that reads `useSearchParams`, the component now wraps its inner body in a
`Suspense` boundary — without it, `useSearchParams` would force every page
rendering a `SectionTabs` (i.e. most of the app) into client-side rendering
during prerender. The boundary is internal, so no consumer changed.

**The "Ready to Pay" queue** (§7's queue half, which belongs on the ledger
screen) is a third tab on the ledger page, backed by
`GET /api/expense/funding-sources/[id]/ready-to-pay`. It lists every
fully-approved-or-partially-paid, unsettled OUT request **naming that fund**,
each with its outstanding balance (amount − already allocated), and a tab-badge
count.

A design flaw surfaced during verification and was fixed: the endpoint first
also included **fund-agnostic** approved requests (no `fundingSourceId`) that a
request type allowed. dev.db had exactly such a row, and it showed up in *all
three* funds' queues at once, triple-counting in `totalOutstanding`. The queue
is now scoped to requests that name the fund; fund-agnostic ones stay payable
from the request detail page, which is unaffected.

### Cash Reconciliation + Digital Payment Reconciliation (§1, completing the six items)

Both were initially deferred, then built on the user's decision (2026-08-05) as
**custodian-facing, read-only** views — deliberately not re-entering data the
existing Cash Reconciliation flow (`/api/cash-recon`) and Payment Verifications
screen already own, which would have been the duplicate-source mistake.

One endpoint, `GET /api/expense/funding-sources/[id]/reconciliation`, does the §6
comparison for any fund. A shared `components/ReconciliationView.tsx` renders it;
two thin routes (`/cash-reconciliation` filtered to `CASHIER_CASH`,
`/digital-payment-reconciliation` filtered to `DIGITAL`) supply the class.

**The endpoint returns an honest three-state `status`, not a green/red boolean:**
`RECONCILED` (an independent figure was compared and agrees), `MISMATCH` (compared
and disagrees — §6's flag, never a silent override), or `UNVERIFIABLE` (there is
nothing independent to compare against, so a green tick would be a lie). This
replaced a `mismatch` boolean found to be misleading — see the finding below.

What each reconciles, per §6:
- **Cashier Cash** — `UNVERIFIABLE` by design: the balance *is* the live cash
  position (`getFundingSourceBalance` reads `computeAvailableCashToday`), so there
  is no separate stored ledger to drift against. The genuine reconciliation is the
  physical count, so it surfaces the daily cash breakdown (opening + collection +
  cash paid bills − disbursed) and the latest `CashRecon` variance, linking
  physical-count entry back to the Daily-screen flow.
- **Petty Cash** — the one class with a real independent check: it sums the
  append-only `FundingSourceTxn` rows **directly** and compares to
  `currentBalance`. A fund born in the framework has an `OPEN` row, so the two
  must be equal — any gap is genuine drift (`MISMATCH`). A fund seeded from a
  legacy `PettyFund` has `currentBalance` but no `OPEN` row and no migrated
  history, so there is no anchor to check against → `UNVERIFIABLE`, with the
  pre-ledger opening shown explicitly rather than faked as reconciled.
- **Digital** — the balance reads live from the wrapped account's GL, so it ties
  to the statement by construction; the meaningful gap is unverified payments, so
  `MISMATCH` here means "N payments still lack proof," linking to Finance →
  Payment Verifications.

### Finding fixed during verification (2026-08-05)

The WIP first backed the §6 check with `listFundingSourceLedger`, whose
`closingBalance` is **back-derived** as `currentBalance − Σtxns` and therefore
*always* equals `currentBalance`. So the comparison could never disagree: the
petty-cash "mismatch" the doc claimed to detect was structurally impossible to
fire, and cashier/digital have no separate ledger at all — yet the UI reported a
confident green "the append-only ledger agrees." The endpoint now sums the txns
independently (real drift detection, verified by tampering `currentBalance` in a
test), and reports `UNVERIFIABLE` where the seed threw away the history rather
than showing a check that didn't happen. Confirmed: the live seeded "Petty Cash"
and "Cashier Janeth Drawer" funds correctly read `UNVERIFIABLE`.

All of §1/§2 is now done.

### Scope note — legacy flow retained

The legacy Petty Cash tabs (`Petty Cash (legacy)`, `Approval Requests`,
`Payments`) are kept in the Expenses section, below the new items. They are still
the live production flow under the side-by-side rollout, and hiding them before
the cash-drawer cutover (`CASHIER_CUTOVER_ENABLED`) would strand a working
screen. They drop off at cutover.

---

## Verification approach

`next build` **does not complete on the current dev machine** — bare
`npm run build` dies with a Turbopack OOM (`memory allocation of N bytes
failed`); with `NODE_OPTIONS=--max-old-space-size=4096` it compiles successfully
(~4 min) but the TypeScript worker then crashes (`exit code 3221226505` =
Windows `0xC0000409`). Compilation itself succeeds. Verify types with
`npx tsc --noEmit` separately rather than reading the build failure as a code
defect. **CI/Vercel is the first place a green end-to-end build will be seen.**

Also note: **`npm run db:push` does not regenerate the Prisma client.** After a
schema edit, run `npx prisma generate` too or `tsc` will report new fields as
nonexistent.

Phases 1–2 were verified by 45 assertions against `dev.db`:

- **23 on grant scope semantics** — null-as-wildcard in *both* dimensions
  simultaneously, plus every deny case (right fund/wrong outlet, right
  outlet/wrong fund, revoked, wrong grant type).
- **22 on the route handlers** — 401 unauthenticated, 403 non-admin, each
  validation branch, batch atomicity (a partially-invalid batch writes nothing),
  email lookup, idempotent revoke.

Phase 3 added **31 more**: the full fund-class mapping (including `OTHER` and an
unknown value both mapping to no class), the allocation-mode table, and
enforcement — assignment refused without a grant, refused with a grant for the
*wrong* fund class, accepted with the right one, `400` rather than `500` from the
API, a revoked grant blocking new assignments while leaving existing ones intact,
and `CASHIER_DRAWER`'s reported balance equalling `computeAvailableCashToday()`
exactly.

Phase 4 added **34 more**: per-fund balance validation under both `WARN` and
`BLOCK`, the fund's per-request limit, a fund disallowed by the request type, the
threshold shortcut end-to-end, an unstaffed chain refusing submission and leaving
the request `DRAFT`, single- vs two-stage chains by staffing, the approval row
carrying a stage grant rather than a role, inbox visibility (stage-1 approver sees
it, stage-2 approver does not, ungranted user does not, and it swaps over once
stage 1 is decided), decide authorization by grant, stage-2 progression, rejection
stopping the chain, and the threshold-skip custodian nudge.

Phase 5 added **20** for the nav + Ready-to-Pay: the nav structure (Expense Form
leads, three fund ledgers sharing a path but differing by `?fund=`, legacy flow
retained), the query-aware tab matcher highlighting each ledger independently, and
the Ready-to-Pay endpoint (approved appears, draft does not, IN top-up excluded,
partial payment nets outstanding down while staying in the queue, fully-paid drops
out, 401 unauthenticated).

The reconciliation views added **14 more**: auth gating (401/403/404), an
anchored fund reconciling before and after a payment, **genuine drift detected by
tampering `currentBalance` away from Σtxns** (`MISMATCH` with the right amount), a
seeded fund with no `OPEN` row reporting `UNVERIFIABLE` with its pre-ledger
opening surfaced, and every live fund resolving to a valid status without
throwing. Both new pages confirmed rendering in the browser with the full
Expenses nav and no console errors.

All were throwaway `scripts/_tmp-*.ts` files run via `npx tsx`, deleted after
use. Worth recreating if this area changes.

One trap to note: a cleanup step that deletes a user's `CUSTODIAN` grants will
also delete grants the backfill created. Re-run
`scripts/backfill-custodian-grants.ts` afterwards.

The `scopeWhere()` null-as-wildcard logic is the piece most worth re-testing on
any change: a grant with `outletId = null` is business-wide and applies to every
outlet, while `null` in the *query scope* means "don't filter on this" — an
asymmetry that is easy to break.

**Browser caveat:** an unauthenticated browser session returns `401` from these
endpoints, and the Manage Access table's empty state is indistinguishable from
the error fallback. Do not read an empty table as a passing API.

---

## Deferred, with reasons

| Deferred | Why | Lands in |
|---|---|---|
| ~~Enforcing the `CUSTODIAN` grant on assignment~~ | — | **Done in Phase 3** |
| ~~Widening `/api/expense/access-grants/eligible`~~ | — | **Done in Phase 4** (split by grant type) |
| WhatsApp notifications | Needs a Business API integration (provider account, template approval). The channel abstraction is built; the value is simply ignored by the dispatcher. | Post-launch |
| `ALLOCATOR` grant issuance | The Second Approver executes allocations, so nothing to staff. Enum value reserved. | Only if the decision reverses |
| Staging/production migration SQL | Both still deploy via `db push` per [`MIGRATIONS.md`](MIGRATIONS.md). All Phase 1 changes are additive with defaults, so they carry no data-loss risk. | The Postgres baseline in `MIGRATIONS.md` |
