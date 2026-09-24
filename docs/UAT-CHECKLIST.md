# UAT Checklist — tips Cashier Management
**Goal:** confirm the system is correct and safe before full go‑live. Run this at **one pilot outlet for ~1–3 weeks, in parallel with the manual books.** Sign off only when the app's figures match the manual records.

> `scripts/smoke/*` (see `npm run smoke`, wired into the staging/production
> deploy pipeline per `docs/GO-LIVE-RUNBOOK.md` §5) now mechanically checks
> that core routes are reachable and don't 500 — permissions, POS order
> validation, a real collection post, reconciliation-stages, a signed bill,
> pricing, HR, payroll (skips cleanly if disabled), business calendar, and
> inventory stock-levels. That's plumbing-level coverage, not correctness —
> everything below (exact figures, approval semantics, edge cases, "does
> this match the manual books") still needs a human running this checklist.

App: https://cashier-app-psi.vercel.app · Tester: ______________ · Period: ____________

Legend: ✅ pass · ❌ fail (log issue) · ⬜ not tested

---

## 0. Access & setup
- ⬜ All real staff accounts exist with correct emails & roles; everyone changed their first‑login password.
- ⬜ Owner set: Persons manager, Departments manager, Petty‑cash requesters, Cash/Digital verifier.
- ⬜ Outlets, Persons, Products, Categories, Payment Channels, Departments all loaded/correct.
- ⬜ Each role sees only the menu items they should (cashier ≠ manager ≠ owner).

## 1. Daily Collections (the core)
- ⬜ Record a collection for a staff: System Sales + Cash/CRDB/Stanbic/M‑PESA.
- ⬜ **Cash Required** = System − (CRDB+Stanbic+M‑PESA) is correct; negative shows “Excess”.
- ⬜ Add signed bills + paid bills + cancellations in the same entry; **Staff Loss** preview matches a hand calc: *System − Collection − Signed − Paid(Staff‑Loss only)*.
- ⬜ Duplicate guard: a 2nd collection for the same staff/day/outlet is blocked.
- ⬜ A cashier can **only** edit/delete their **own outlet's** collections.
- ⬜ Edit a collection → staff loss recomputes correctly.
- ⬜ **Atomicity:** if a save errors, **no** half‑saved collection/bills appear.

## 2. Bills & payments
- ⬜ Create a Signed Bill (with and without product line items); itemised amount = sum of lines.
- ⬜ Admin/Director credit‑limit warning fires when exceeded.
- ⬜ Record a Paid Bill: payer category auto‑fills; payment settles **oldest bill first**; overpayment → credit.
- ⬜ Multi‑bill payment + “link to signed bill” lock the category correctly.
- ⬜ Click a payment → **Payment Story** shows bill, every payment, running balance.

## 3. Approvals & “Pending doesn't count”
- ⬜ File a **Customer / Tips / DJ / Cancellation** request → shows **Pending**.
- ⬜ While **Pending**, it does **NOT** appear in Receivables / Dashboard / Reports totals.
- ⬜ **Approve** it → it now **counts** in those totals.
- ⬜ **Reject** it → it is **excluded** everywhere (but still visible with a Rejected badge).
- ⬜ Only authorised approvers can Approve/Reject (others can't).

## 4. Petty cash
- ⬜ Only listed requesters can submit a Cash Request; others can't.
- ⬜ Only the two approvers can Approve/Reject; status filter (All/Pending/Approved/Rejected) works.

## 5. Reconciliation
- ⬜ **Cash Recon:** opening auto = yesterday's closing; deposited entered; closing computes correctly.
- ⬜ **Cash Verified** is officer‑only; variance (verified − closing) correct.
- ⬜ **Digital Recon** (standalone 📲 page + Close‑the‑Day Step 3): per channel, Reported auto‑fills; enter Paid bills + Sales collection; Total Collection = Paid bills + Sales collection; Variance = Total − Reported (Loss/Excess wording correct).
- ⬜ Officer verifies Paid bills + Sales collection **independently** (can't see/edit cashier figures); Verified Amount = Verified Paid bills + Verified Sales collection.
- ⬜ Old Opening/Closing inputs no longer shown; historical records with Opening/Closing still readable.
- ⬜ Reports show Verified + Variance + Verified By.

## 6. Reports, payroll & exports
- ⬜ Daily Cashier / Financial Summary / Cash & Digital Recon reports load and filter by date/outlet.
- ⬜ CSV / Excel / PDF exports open correctly with right figures.
- ⬜ Payroll Deductions report correct; **Email Directors** sends and arrives.

## 7. 🔑 The decisive test — match the books
For the pilot period, compare **app vs manual** for each outlet/day:
- ⬜ Total collections (cash + each channel) match.
- ⬜ Staff losses match.
- ⬜ Receivables / outstanding match.
- ⬜ Cash & digital reconciliation closing balances match.
> **Go‑live is approved only when these match for a full continuous week with no unexplained variance.**

## 8. Non‑functional
- ⬜ Works on the devices cashiers actually use (incl. phone).
- ⬜ Performance acceptable with a week of real data.
- ⬜ Database backup verified (see Go‑Live Runbook).
- ⬜ A test error is captured by monitoring (see Go‑Live Runbook).

---

### Sign‑off
| Role | Name | Signature | Date |
|---|---|---|---|
| Pilot Cashier | | | |
| Accountant | | | |
| Manager | | | |
| Director (approval to go live) | | | |

**Issues log:** _(attach list of ❌ items, owner, status)_
