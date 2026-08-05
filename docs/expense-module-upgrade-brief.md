# Expense Module Upgrade — Implementation Brief for Claude Code

## Context
Current system: "Petty Cash" is a single module with one funding pool, one form, and admin-configurable terminology (Module/Category/FundingSource labels already exist under Setup → Expense Settings).

Goal: split this into **three custodian-owned funds** (Cashier Cash, Petty Cash, Digital Expenses), each with its own ledger and allocation rule, governed by an explicit access-control layer, and feeding into Finance.

Before starting, tell Claude Code your stack (frontend framework, backend/DB, ORM) so it can match existing conventions — the instructions below are framework-agnostic on purpose.

---

## 1. Rename navigation section: "Petty Cash" → "Expenses"

- Rename the left-sidebar section label from **Petty Cash** to **Expenses**.
- Because of point 2 (separate ledgers per custodian), restructure the sub-items under it rather than just relabeling:
  - Expenses
    - Expense Form (new request)
    - Cashier Ledger
    - Petty Cash Ledger
    - Digital Expenses Ledger
    - Cash Reconciliation
    - Digital Payment Reconciliation
- Update the default "Module" terminology label in Setup → Expense Settings from "Petty Cash" to "Expenses" as the new default (keep it admin-editable as it already is).

## 2. New entity: Custodian (one per fund)

Introduce a `Custodian` entity — this is the core structural change everything else depends on.

**Custodian**
- `id`
- `name` (e.g. "Jane Cashier – Mikocheni")
- `type`: enum `CASHIER | PETTY_CASH | DIGITAL`
- `outlet_id` (Mikocheni / Coco Beach — confirm whether custodians are per-outlet or business-wide)
- `assigned_user_id` (the person accountable for this fund)
- `status`: active / inactive

**FundingSource** (1:1 with Custodian)
- `id`, `custodian_id`
- `type`: `CASHIER_CASH | PETTY_CASH | DIGITAL`
- `allocation_mode`: `ROLLING_CASH_BALANCE | FIXED_ALLOCATION | BANK_BALANCE` (see §5)
- `current_balance` (computed per type, not a single stored field — see §5)

**Ledger** (1:1 with Custodian)
- `id`, `custodian_id`
- Entries are append-only (see §6)

Each custodian gets their own filtered view of: Expense Form (as the "pay from" option), their Ledger, and their reconciliation screen.

## 3. Expense Form (rename from Petty Cash Request)

- Rename the request form from "Petty Cash Request" / "New Cash Request" to **Expense Form**.
- Add a required **Funding Source** field at the top: `Cashier Cash | Petty Cash | Digital Expenses`.
- Selecting a funding source should:
  - Filter/auto-assign the relevant **custodian** (e.g. the on-duty cashier for that outlet, or the outlet's petty cash custodian).
  - Route approval/payment to that custodian.
  - Validate against that fund's available balance using the rule in §5, applying the existing "Warn — allow but flag" budget policy per fund rather than globally.
- Keep existing fields (requester, department, purpose, amount, method) unchanged.

## 4. Setup → Expense Settings → "Manage Access" (new section)

New tab alongside Module / Request Types / Categories / Funding Sources.

- Admin adds users by email and grants one or more access flags per user:
  1. **Requesting Access** — eligible to submit an Expense Form
  2. **Petty Cash Custodian Access**
  3. **Digital Expenses Custodian Access**
  4. **Cashier Cash Custodian Access**
  5. **First Approver Access**
  6. **Second Approver Access**
- Recommend scoping each grant to an outlet (Mikocheni / Coco Beach), since custodians and approvers likely differ by location — confirm this with Claude Code before building if you want business-wide roles instead.
- Approver roles (5 & 6) should also be assignable per funding source type — you may want different approval chains for Cashier Cash vs Petty Cash vs Digital Expenses, or you may want one shared chain. Decide this before Claude Code builds the routing logic (see §7).
- This access list is the single source of truth that drives:
  - Who appears in the "Requested By" dropdown on the Expense Form.
  - Who can be assigned as a custodian for each fund in §2.
  - Who is routed a request at the first- and second-approval stage.
  - Authorization checks on custodian-only actions (viewing their ledger, approving/paying from their fund, closing daily cash).
- Include an audit trail: `granted_by`, `granted_at`, and ability to revoke (not hard-delete) an access grant.

## 5. Funding source balance logic (differs by type — this is the core business rule)

| Type | Requires manual allocation? | Available balance formula |
|---|---|---|
| **Cashier Cash** | No | Yesterday's closing cash (from Cash Reconciliation) **+** today's cash collected by the cashier from all staff before closing |
| **Petty Cash** | Yes (as today) | Current allocation minus approved/paid disbursements since last top-up |
| **Digital Expenses** | No — funded by bank balance | Current bank account balance (pulled from Digital Payment Reconciliation / linked bank balance field) minus approved/paid disbursements |

Implementation notes for Claude Code:
- Cashier: needs a daily job or on-read calculation that pulls prior day's closing cash from the Cash Reconciliation record and adds same-day cash collected. The collection figure is what the cashier physically collects from each staff member (waiters, bartenders, etc.) during end-of-day handover — **not** the Sales Import total, which reflects system sales rather than actual cash received. This handover amount is presumably what's entered into the existing Cash Reconciliation flow; confirm with Claude Code where in that flow this figure is captured so the calculation reads from the right field. No allocation UI should be shown for this fund type.
- Petty Cash: unchanged from current behavior — keep the existing top-up/allocation flow.
- Digital: needs a bank balance source of truth — either a manually updated field or pulled from Digital Payment Reconciliation. No allocation UI; balance is read-only, sourced externally.
- Each fund type should hide/disable UI elements that don't apply to it (e.g. don't show an "allocation amount" field for Cashier or Digital funds).

## 6. Per-custodian ledger + Finance integration

- Every custodian gets an append-only **debit/credit ledger**:
  - **Debit** (increases fund): cash collections (Cashier), allocation top-ups (Petty Cash), bank deposits (Digital)
  - **Credit** (decreases fund): approved/paid expense disbursements
  - Each entry stores a running balance, reference type/id, and `created_by`.
- Ledger balance must always reconcile to the "available balance" formula in §5 for that fund type — treat any mismatch as a reconciliation flag, not a silent override.
- Map each custodian's ledger to a Finance/Chart-of-Accounts line (e.g. "Cash on Hand – Jane, Mikocheni", "Petty Cash – Coco Beach", "Digital Expenses – [Bank Account]") so month-end close can pull all three into the trial balance/finance module without manual re-entry.

## 7. Notifications by role

Each stage of an expense's lifecycle should notify only the role that needs to act next, plus a status update to the requester. Build this as an event-driven table, not scattered if/else logic — makes it easy to add roles or channels later.

| Event | Requester | First Approver | Second Approver | Custodian |
|---|---|---|---|---|
| Request submitted | Confirmation | **Action needed** | – | – |
| First approver approves | Status update | – | **Action needed** | – |
| First approver rejects | Rejected + reason | – | – | – |
| Second approver approves → request fully approved, **ready to pay** | Status update | Status update (optional) | – | **Action needed: ready to pay** |
| Second approver rejects | Rejected + reason | Status update | – | – |
| Custodian pays | Paid confirmation | – | – | – |
| Custodian marks unpaid / insufficient funds | Alert: funds unavailable | Optional | Optional | – |
| Fund balance low / ledger reconciliation mismatch (§6) | – | – | – | **Alert** |
| Pending approval > X hours (escalation) | – | Reminder | Reminder (if stuck at stage 2) | – |

Implementation notes:
- Route "action needed" notifications only to the specific individual(s) holding that access grant for the relevant outlet/fund — not a broadcast to everyone with that role.
- Support at least two channels: in-app (there's already a notification bell in the header) and email. If you want to push notifications through WhatsApp as well, flag that separately since it needs a different integration.
- Make the escalation timeout (§ "Pending approval > X hours") configurable per funding source under Setup, not hardcoded — Cashier Cash approvals probably need a much shorter SLA than Petty Cash top-up approvals.
- Let each user opt in/out per event type in their profile, except for "Action needed" notifications tied to their own role, which should not be mutable — someone with First Approver access can't silence the one notification their role exists for.
- Notification content should always include: requester, amount, purpose, outlet, funding source, and a direct link to the record — no one should have to hunt for context.
- Give each custodian a **"Ready to Pay" queue/tab** on their fund's ledger screen (not just a one-off toast/email), listing every fully-approved, unpaid request against their fund. A custodian handling several requests a day shouldn't have to rely on remembering individual notifications — the queue is the reliable source, the notification is just the nudge to go check it.

## 8. Petty cash top-up requests (reuse the expense approval flow, direction reversed)

Right now "Record allocation to custodian" (Amount / Reference / Note / Record allocation) credits the petty cash fund directly with no approval trail. Replace the direct-entry-only behavior with a request-based flow that reuses the exact same approval chain and notification engine as §3/§7 — just with the money moving in rather than out.

- Add a **Request Top-Up** action for Petty Cash Custodian Access holders, using the same Amount / Reference / Note fields already in that form.
- Submitting creates a top-up request rather than an immediate ledger entry. It enters the same First Approver → Second Approver chain configured in §4.
- The custodian now sits in the "requester" seat for this flow. Notification routing mirrors §7, reversed:

| Event | Petty Cash Custodian (requester) | First Approver | Second Approver | Allocator |
|---|---|---|---|---|
| Top-up request submitted | Confirmation | Action needed | – | – |
| First approver approves | Status update | – | Action needed | – |
| First approver rejects | Rejected + reason | – | – | – |
| Second approver approves → ready to allocate | Status update | Status update (optional) | – | **Action needed: ready to allocate** |
| Second approver rejects | Rejected + reason | Status update | – | – |
| Allocation recorded | Top-up received confirmation | – | – | – |

- The existing **"Record allocation to custodian"** screen becomes the execution step — it's only actionable against an approved top-up request (not a free-standing entry anymore), and submitting it is what actually creates the DEBIT ledger entry in §6.
- "Allocator" in the table above needs a home — decide whether this is a new access grant (e.g. "Allocation Access"), whether it defaults to whoever has admin rights, or whether the Second Approver's own approval action should just execute the allocation directly rather than adding a separate execution step. Flagged below.

**Decisions to confirm before building this piece:**
- Who executes the final allocation — a distinct role, or does the Second Approver's approval directly create the ledger entry (collapsing approval and execution into one step)?
- Should the allocated amount be locked to whatever was requested, or can the executor adjust it (e.g. a cheque issued for a rounded figure)?
- Should a no-approval "direct allocation" path still exist for admin overrides, or should every petty cash top-up go through this request flow from now on?



1. Data model: `Custodian`, `FundingSource`, `Ledger`, `LedgerEntry`, `AccessGrant`
2. Manage Access UI (§4) — needed before custodians can be assigned
3. Custodian setup + balance logic per type (§5)
4. Expense Form funding-source selector + routing (§3)
5. Per-custodian ledger views + nav restructure (§2, §1)
6. Finance/Chart-of-Accounts mapping (§6)
7. Notification routing engine (§7) — build last, once the approval chain and role assignments from §4 are stable
8. Petty cash top-up request flow (§8) — once §7's notification engine exists, this reuses it rather than adding a parallel system

## Confirm before Claude Code starts

- Is a custodian scoped to one outlet, or can one person be the custodian for both Mikocheni and Coco Beach?
- For Digital Expenses, is the bank balance entered manually, or pulled from an existing integration/reconciliation record?
- Should historical Petty Cash requests be migrated into the new Custodian/Ledger model, or does this start fresh going forward?
- Is the two-tier approval (first approver → second approver) required for every request regardless of amount, or should small requests (e.g. below a threshold) skip straight to the custodian?
- Do you want a single approval chain shared across all three funding sources, or a separate chain per fund type?
- Which notification channels do you actually want at launch — in-app only, in-app + email, or in-app + email + WhatsApp?
- Who executes an approved top-up allocation, and should that be a distinct access grant (§8)?
