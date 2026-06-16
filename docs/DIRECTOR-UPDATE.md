# Cashier Management System — Director Update
**tips Investment Group** · Mikocheni · Coco Beach · Tips Events
**Date:** 16 June 2026 · **Status:** Ready for pilot

---

## 1. In one line
The Cashier Sales & Receivables system is **built, secured, and live** at
**https://cashier-app-psi.vercel.app** — ready to run a controlled pilot at one outlet.

---

## 2. What the system does today
A single place to record and oversee every shilling per outlet, per cashier, per day:

- **Daily Collections** — system sales vs money in (Cash, CRDB/Lipa Hapa, Stanbic, M-PESA), with automatic **Cash Required** and **Staff Loss** calculation.
- **Signed Bills** (credit given) — Admin, Director, Customer, Tips, DJ, Staff-Loss — with product line items.
- **Paid Bills** — debts collected, auto-applied to the oldest outstanding bill.
- **Cancellations** — voided punches with reason, product and quantity.
- **Petty Cash** — cash-request forms with an approval workflow.
- **Receivables** — outstanding debt by person, aging and credit limits.
- **Payroll Deductions** — over-limit bills and staff losses, emailed to directors monthly (automatic).
- **Reports** — Financial Summary, Daily Cashier Report, Cash & Digital Reconciliation, with CSV / Excel / PDF export.
- **Dashboard** — performance across all outlets and top debtors.

---

## 3. What we completed most recently
| Area | What changed | Why it matters |
|---|---|---|
| **Security** | Locked every screen to the right role; cashiers see only their own outlet | A cashier can't view or edit another outlet's money |
| **Approval rule** | Customer / Tips / DJ bills count **only after approval** | Pending requests no longer inflate the figures |
| **Money accuracy** | Every amount rounded to the shilling on save | No fractional-cent drift in reports |
| **Error monitoring** | Live error alerts (Sentry) — confirmed working | We're notified the moment something breaks |
| **Backups** | Full database emailed to directors **every Monday**, plus on-demand | The data is recoverable |
| **Product catalogue** | **146 products imported** with codes, cost & selling prices, de-duplicated | Real catalogue loaded; no duplicates possible |
| **Daily Report** | One-page report (Collection, Signed, Paid, Cancellations, Petty Cash, Cash-in-Hand) with **one-tap "Share to WhatsApp"** | A cashier can send the day's report to the directors' group from their phone |
| **Phone app** | Installable on Android/iPhone (no app store needed) | Cashiers use it like a normal app |
| **Stability fix** | Resolved a crash on the Users screen | Reliability |

---

## 4. The ask
1. **Approve a 2–4 week pilot at one outlet** (recommend Mikocheni) to validate the system with real daily use.
2. **Confirm the team list & access** so we can create their logins.
3. **Decide on the database plan** — the free tier has limited backup durability; a paid managed database (~modest monthly cost) is recommended before full roll-out (see Runbook §2).

---

## 5. What's next (after a successful pilot)
- Roll out to all three outlets.
- **Extra collection channels** (e.g. Airtel Money, NMB) wired fully through totals & reconciliation.
- Pagination on long lists as data grows.
- Automated tests on the money calculations.
- Consider the official tips logo (a web-optimised version) once available.

---

## 6. How to try it now
Open **https://cashier-app-psi.vercel.app** on a phone or computer, sign in, and:
- Record a test collection on **Daily Collections**.
- Open **Daily Report** → **📲 Share to WhatsApp** to see the share-ready PDF.
- Browse **Products** to see the 146-item catalogue.

*References: `docs/DIRECTOR-SUMMARY.md` (one-pager), `docs/GO-LIVE-RUNBOOK.md` (operations), `docs/UAT-CHECKLIST.md` (pilot sign-off).*
