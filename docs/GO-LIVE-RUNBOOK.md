# Go‑Live Operations Runbook — tips Cashier Management

Production: **https://cashier-app-psi.vercel.app** · Host: **Vercel** · DB: **Neon Postgres** · Repo via **GitHub Desktop (TipsInvestmentGroup)**.

---

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)
Confirm all are set for **Production**, with strong random values:
- `DATABASE_URL` (pooled, Neon) and `DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING` (for db push)
- `JWT_SECRET` — long random string (≥ 32 chars)
- `CRON_SECRET` — long random string (protects `/api/admin/*` and `/api/cron/*`)
- `NEXT_PUBLIC_OWNER_EMAIL` = `johnonecmo@gmail.com`
- `SMTP_HOST=mail.tips.co.tz`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
> Changing a `NEXT_PUBLIC_*` value requires a redeploy to take effect.

## 2. Database backups (Neon) — **do before go‑live**
Neon keeps continuous history; enable/confirm it:
1. Neon Console → your project → **Settings → Storage / History retention** → set retention to **at least 7 days** (30 if available).
2. **Point‑in‑Time Restore test:** Branches → **Create branch** → “Restore from a time” → pick 1 hour ago → verify data → delete the test branch. (Confirms you *can* recover.)
3. Optional weekly logical dump: from any machine with `pg_dump`:
   `pg_dump "$DATABASE_URL_UNPOOLED" -Fc -f tips-backup-YYYYMMDD.dump`
   Store off‑site (Google Drive / OneDrive). Restore with `pg_restore`.
4. Write down **who** runs/checks backups and **how to restore** (branch restore is the fastest path).

## 3. Error monitoring (Sentry) — recommended
1. Create a free project at sentry.io → **Next.js** platform → copy the **DSN**.
2. In the project run: `npx @sentry/wizard@latest -i nextjs` (generates config) **or** add `@sentry/nextjs` and set `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` in Vercel.
3. Trigger a test error and confirm it appears in Sentry (UAT §8).
> Until Sentry is wired, use **Vercel → Project → Logs** for runtime errors and `AuditLog` (in DB) for the who/what/when of data changes.

## 4. Seed / team setup (one time, in production)
1. Sign in as owner → set access pickers (Persons manager, Petty requesters, Cash verifier).
2. If starting empty: `…/api/admin/seed?secret=<CRON_SECRET>` (outlets + persons), then create staff accounts in **Users** (or `…/api/admin/setup-team?...` if used). Share temp passwords privately.
3. Verify Products, Categories, Payment Channels, Departments.

## 5. Deploy procedure
1. GitHub Desktop → review changed files (**include `public/tips-logo.png`**) → Commit → **Push origin**.
2. Vercel auto‑builds (`vercel-build` runs `prisma db push` → applies new tables/columns) → wait for ● **Ready**.
3. Smoke test: log in, open Dashboard, record a test collection, delete it.

## 6. Rollback
- **Bad deploy:** Vercel → Deployments → previous green build → **Promote to Production** (instant).
- **Bad data:** Neon → restore a branch to a time before the issue (§2), then repoint `DATABASE_URL` or copy data back. Practice this once before go‑live.

## 7. Routine ops
- **Monthly:** payroll email auto‑sends (cron `0 5 1 * *`, 08:00 EAT). Confirm directors received it.
- **Weekly:** check backup retention is active; skim Vercel logs / Sentry for errors.
- **Access changes:** add/disable users in **Users**; update petty‑cash requesters & verifier via the owner pickers (no deploy needed). Fixed approvers (`r.mlay`, `siyer.mkama`) are in code — changing them needs a code edit + deploy.

## 8. Known limitations to watch during pilot
- A collection's stored staff‑loss is computed at save time; rejecting a bill later updates live reports/receivables but not that one stored figure.
- Lists cap at 200–500 rows (no pagination yet) — fine for pilot, revisit as data grows.
- No automated tests yet — rely on the UAT checklist.
