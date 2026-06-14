# 👑 Owner / Admin — Quick Guide
**tips · Cashier Management** — https://cashier-app-psi.vercel.app

You have everything plus full configuration. **Log in with the owner email** (`johnonecmo@gmail.com`) to get owner powers.

## One‑time access setup
- **Users (⚙️)** — create / edit / delete accounts and reset passwords *(owner only)*.
- **Persons → 🔐 Manage Access** — choose the 3rd person‑manager (owner + r.mlay + your pick).
- **Petty Cash → 🔐 Manage Request Access** — tick who can submit cash requests.
- **Petty Cash → Reconciliation → 🔐 Extra verifier** — pick the extra verification officer.
- **Departments / Categories / Payment Channels** — maintain the dropdown lists.
- **Products** — maintain the catalogue (code auto‑generated, prices, unit measure).

## First‑time production setup (run once)
1. Set Vercel env: strong `JWT_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_OWNER_EMAIL`, `SMTP_*`.
2. `…/api/admin/seed?secret=CRON_SECRET` — outlets + persons.
3. `…/api/admin/setup-team?secret=CRON_SECRET&password=<TEMP>` — creates the real staff accounts.
4. Share temp passwords privately; everyone changes theirs on first login.

## Watch
- **Dashboard** — live totals, per‑outlet performance, top debtors.
- **Payroll Deductions** & **Reports** — full financial picture, exports, director emails.

## Key rules
- **Rejected** cancellations/bills are void → excluded from totals (Pending still counts).
- Reconciliation **opening carries from yesterday's closing**; verification is independent of the cashier figures.
- Money is rounded to the shilling on save.

*You are the final point of contact for access and changes.*
