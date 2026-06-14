# tips — Cashier Management System
### Director briefing · one page

**What it is:** a single online system that runs the daily cashier operation across all tips outlets — replacing scattered manual books. Live at **cashier-app-psi.vercel.app**, usable on computer or phone.

---

## What it does
- **Daily collections** per staff: system sales vs cash/CRDB/Stanbic/M‑PESA, with automatic **staff‑loss** calculation and **cash‑required** figures.
- **Bills & debts:** signed (credit) bills, payments that auto‑settle the right debts, full **receivables** with credit limits and aging.
- **Requests & approvals:** Customer / Tips / DJ / Cancellation requests and petty‑cash requests — each **approved or rejected** by the right manager before it counts.
- **Reconciliation:** daily **cash** and **digital‑channel** reconciliation with independent officer verification.
- **Payroll deductions** for over‑limit and staff losses, **emailed to directors** monthly.
- **Reports & exports** (Excel / PDF) across outlets, with a live dashboard.

## What protects the money & data
- **Role‑based access** — cashiers, accountants, managers, approvers, verifiers, owner — each sees and does only their part; **cashiers are locked to their own outlet**.
- **Approvals gate the numbers** — a request does **not** count in any total until approved; rejected items are excluded.
- **All‑or‑nothing saves** — a collection and its linked entries save together or not at all (no half‑records).
- **Error monitoring (Sentry)** — the owner is **emailed automatically** if anything breaks. *(Tested and confirmed.)*
- **Backups** — the full database is **emailed to directors weekly**, plus on‑demand download, so data can be recovered.

## Status today
✅ Built, deployed, and hardened (security, approvals, backups, monitoring all in place and tested).
✅ Branding, user guides, and an operations runbook are ready.
⏳ Not yet validated against real daily figures — that's what the pilot is for.

## Recommendation — approve a short pilot, then roll out
Run the system at **one outlet for ~1–3 weeks, alongside the existing manual books.** Each day we compare the app's totals to the manual records. When they match for a full week with no unexplained difference, we have proof it's correct → **approve full roll‑out to all outlets.**

**Why a pilot, not a big‑bang switch:** it protects the business — if anything doesn't add up, the manual books are still there, and we fix it before it touches every outlet.

## Costs
- Currently running on **free** hosting/database tiers — **no monthly cost** to start.
- For the long term, a small managed‑database plan (~$19/month) would add automatic professional backups; optional, can decide after the pilot.

## The ask
> **Approve the pilot** at one outlet and nominate the pilot cashier + the manager who signs off the daily comparison.

*Full feature list, user guides, UAT checklist and operations runbook are available in the project's `docs` folder.*
