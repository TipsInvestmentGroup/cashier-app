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
| Widening `/api/expense/access-grants/eligible` beyond ADMIN | The response carries names and emails; not widened ahead of a real caller. | Phase 4 (Requested By dropdown) |
| WhatsApp notifications | Needs a Business API integration (provider account, template approval). The channel abstraction is built; the value is simply ignored by the dispatcher. | Post-launch |
| `ALLOCATOR` grant issuance | The Second Approver executes allocations, so nothing to staff. Enum value reserved. | Only if the decision reverses |
| Staging/production migration SQL | Both still deploy via `db push` per [`MIGRATIONS.md`](MIGRATIONS.md). All Phase 1 changes are additive with defaults, so they carry no data-loss risk. | The Postgres baseline in `MIGRATIONS.md` |
