# Cashier Manager — User Guide

Live app: **https://cashier-app-psi.vercel.app**

**First login:** use the email + temporary password you were given, then click **🔑 Change Password** (bottom of the left menu) and set your own. Never share your password.

Money is shown in TSh. Amount boxes auto‑add commas as you type.

---

## 👤 CASHIER — daily routine

You handle the till for **your outlet**. Your main screen is **Daily Collections**.

**1. Record each staff's collection** (Daily Collections → **+ New Collection**)
- Pick **Date**, **Outlet**, and the **Staff** you're collecting from.
- Enter **System Sales** (what the POS says that staff sold).
- Enter what was actually handed in: **Cash, CRDB, Stanbic, M‑PESA**.
- **Cash Collection Required from Staff** fills in automatically = System − (CRDB + Stanbic + M‑PESA). If it goes negative it shows **🟢 Excess Cash**.
- **🚫 Cancellations** — add any voided punches: reason (Double Punch / Out of Stock / Wrong Punch), pick the **product**, qty → amount auto.
- **🧾 Signed Bills** — credit sales this staff served (Admin / Director / Customer / Tips / DJ / Staff Loss).
- **✅ Paid Bills** — old debts this staff collected today. Use **🔗 Link to signed bill** to apply it to the right bill (the category then locks to that bill). Only **Staff Loss** payments reduce the staff's loss.
- The **Staff Loss** preview = System − Collection − Signed − Paid(Staff Loss). Tick **"No other bills"** if there are none, then **Save**.

**2. Signed Bills** — record a customer/admin credit bill; optionally **itemise products** (Amount becomes the products' total).

**3. Paid Bills** — record a payment. Pick the payer (their category auto‑fills), enter the amount; it auto‑settles their oldest bills first. Click any payment row to see its **full story**.

**4. Petty Cash** (only if you're on the request list) — **Cash Request Form**: requester, department, function, purpose, amount, method, payee.

You can only **edit/delete collections for your own outlet**.

---

## 🧮 ACCOUNTANT — money & control

Everything a cashier does, plus:

- **Receivables** — outstanding debts by person, aging, overdue, credit limits. Search + export.
- **Payroll Deductions** — over‑limit Admin/Director bills + staff losses; **Run Deduction**, **Email Directors**, monthly auto‑email.
- **Reports** — Financial Summary, **Daily Cashier Report** (per staff/outlet/customer), **Cash Reconciliation**, **Digital Payment Reconciliation**. All export to CSV / Excel / PDF.
- **Cash Reconciliation** (Petty Cash → 💰) — Opening auto‑fills from yesterday's closing; enter **Cash Deposited**; closing computes. *(Cash Verified is officer‑only.)*
- **Digital Payment Reconciliation** (its own **📲 Digital Reconciliation** page, also Close‑the‑Day Step 3) — per channel enter **Paid bills paid in [channel]** + **Total Sales Collection [channel]**; **Total [channel] Collection** computes automatically and is compared against the system **Reported** figure.
- **Approvals** — you can **Approve / Reject** Cancellations, Tips & DJ Bills, and Customer Bills. **Rejected items drop out of all financial totals.**

---

## 🧑‍💼 MANAGER / DIRECTOR — oversight & approvals

- **Approval Requests** — approve/reject **petty cash** (only the two designated approvers).
- **Cancellations / Tips & DJ Bills / Customer Bills** — review by **Staff / Product / Person** and **Approve / Reject**.
- **Departments & Categories / Payment Channels** — add or edit (if you're an authorized manager).
- **Cash & Digital Reconciliation verification** — if you're a verification officer, enter the **Verified** figures. You verify independently — the cashier's figures are hidden and locked; the report compares both sides. *(Digital: verify **Paid bills** + **Sales collection** per channel; the verified total compares to Reported.)*
- **Reports & Dashboard** — all outlets, outlet‑performance widget, trends.

> Approvers: **r.mlay@tips.co.tz**, **siyer.mkama@tips.co.tz** · Verification officers: **owner, shabinam@tips.co.tz, siyer.mkama@tips.co.tz** (+ owner‑picked).

---

## 👑 OWNER / ADMIN — full control

Everything above, plus **one‑time access setup** (do these once):

- **Users** (⚙️) — create/edit/delete accounts, reset passwords (owner only). Edit/Delete is owner‑restricted.
- **Persons → 🔐 Manage Access** — pick the 3rd person manager (owner + r.mlay + your pick).
- **Petty Cash → 🔐 Manage Request Access** — tick who can submit cash requests.
- **Petty Cash → Cash Reconciliation → 🔐 Extra verifier** — pick the extra verification officer (this setting is shared by both cash and digital verification).
- **Departments / Categories / Payment Channels** — owner + authorized managers can add/edit.
- **Products** — maintain the catalogue (code, prices, unit measure).

**Owner is configured by email** (`NEXT_PUBLIC_OWNER_EMAIL`) — log in with that exact email to get owner powers.

---

## Key rules everyone should know
- **Staff Loss = System Sales − Collection − Signed Bills − Paid Bills (Staff‑Loss category only).**
- **Total Collection (digital) = Paid bills + Sales collection (per channel); Variance = Total − Reported.**
- **Rejected** cancellations/bills are void and **excluded from totals** (Pending still counts until decided).
- A payment auto‑applies to the **same person + same category** bills, **oldest first**; leftover is recorded as a credit.
- Reconciliation **opening balance carries from the previous day's closing** automatically.

*Need help or a change? Contact the system owner.*
