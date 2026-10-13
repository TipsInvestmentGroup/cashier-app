# Deploying to the Cloud (24/7 + PostgreSQL + auto monthly email)

This app is production-ready for **Vercel + Neon Postgres**. The whole thing
(web app, database, and the monthly auto-email cron) runs without your PC being on.

> The code auto-detects the database: a `postgres://` `DATABASE_URL` → PostgreSQL,
> anything else → local SQLite. No code edits needed to switch.

---

## 1. Create a PostgreSQL database (Neon — free tier)

1. Go to https://neon.tech → sign up → **New Project**.
2. Copy the **connection string** (looks like
   `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`).
   Keep it for step 3.

(Supabase or Vercel Postgres work the same way — any Postgres URL is fine.)

---

## 2. Push the code to GitHub

From `cashier-app/`:
```bash
git init
git add .
git commit -m "Cashier app"
git branch -M main
git remote add origin https://github.com/<you>/cashier-app.git
git push -u origin main
```
(`.env` and `dev.db` are git-ignored, so no secrets are committed.)

---

## 3. Deploy on Vercel

1. https://vercel.com → **Add New… → Project** → import your GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Leave build settings default —
   the repo's `vercel-build` script runs `prisma generate && prisma db push && next build`,
   which creates all tables on first deploy.
3. Add **Environment Variables** (Settings → Environment Variables):

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | your Neon connection string |
   | `JWT_SECRET` | any long random string |
   | `CRON_SECRET` | any long random string (Vercel sends this to the cron) |
   | `SMTP_HOST` | `mail.tips.co.tz` |
   | `SMTP_PORT` | `465` |
   | `SMTP_SECURE` | `true` |
   | `SMTP_USER` | a real mailbox, e.g. `john.onesmo@tips.co.tz` |
   | `SMTP_PASS` | that mailbox's password |
   | `SMTP_FROM` | `Lounge Reports <john.onesmo@tips.co.tz>` |

4. **Deploy.** When it finishes you get a URL like `https://cashier-app.vercel.app`.

---

## 4. Seed the database (one click)

After the database is connected and the app has redeployed, run this once
(replace the host + secret). The secret goes in a **header** — it is rejected in the
URL, because URLs are written to logs and browser history:
```
curl -X POST https://<your-app>.vercel.app/api/admin/seed -H "x-cron-secret: <CRON_SECRET>"
```
It creates the outlets and all Directors/Admins/Staff (from `prisma/persons.seed.json`).
You should see `{"ok":true,...}`.

**Production creates no demo logins** (their passwords were public). To get your first
administrator on a brand-new production database, set `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` (12+ characters) in the environment *before* running the seed; it
creates that one ADMIN account (never overwriting an existing one). Remove the password
variable afterwards. Staging/local still get the demo users (`SETUP.md`) unless you
unset them. Floor staff PINs are not pre-set in production: set each person's PIN in
Setup → Users, otherwise they will not appear on the sign-in picker.

---

## 5. The monthly auto-email (already configured)

`vercel.json` registers a Vercel Cron:
```json
{ "crons": [{ "path": "/api/cron/monthly-payroll", "schedule": "0 5 1 * *" }] }
```
- Runs **1st of each month at 05:00 UTC = 08:00 East Africa Time**.
- Emails the **previous month's** Payroll Deduction Report (PDF + CSV) to every active **Director** user.
- Secured by `CRON_SECRET` — Vercel sends it automatically; outsiders can't trigger it.
- Vercel Cron fires regardless of traffic, so it works 24/7 with your PC off.

Add your directors as **Users** with role **Director** and their real `@tips.co.tz`
emails so they receive it. (Trigger a test anytime from the Payroll page → **✉️ Email Directors**.)

---

## Notes
- **Cron plan**: monthly cron is supported on Vercel's Hobby (free) and Pro plans.
- **Function time**: the cron/email functions are capped at 60s (`maxDuration`) — plenty for SMTP + PDF.
- **Local dev still works** unchanged: `npm run dev` uses SQLite (`dev.db`).
- **Windows Task Scheduler** task from the local setup is now redundant once deployed —
  remove it with: `schtasks /Delete /TN "CashierApp Monthly Payroll Report" /F`.

<!-- deployed to Vercel + Neon -->
