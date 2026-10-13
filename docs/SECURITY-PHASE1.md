# Security hardening — Phase 1 (operations notes)

Part of the multi-company programme (see `MULTI-TENANT-ASSESSMENT.md`, §8 Phase 1). Every item here is
worth having with a single company; none of it changes the database schema.

## What changed, and what you must do

### 1. Secrets travel in a header, never in the URL  ⚠ action needed for any manual caller
`/api/cron/*`, `/api/admin/seed`, `/api/admin/reset`, `/api/pos/setup`, `/api/sentry-test` now accept the
`CRON_SECRET` **only** in the `x-cron-secret` header (or `Authorization: Bearer …`, which Vercel Cron sends
itself). A `?secret=` URL is rejected with HTTP 400 so a stale caller notices. Compared in constant time.

| Was | Now |
|---|---|
| `…/api/admin/seed?secret=X` (browser) | `curl -X POST https://<app>/api/admin/seed -H "x-cron-secret: X"` |
| `…/api/cron/backup?secret=X&download=1` | `curl "https://<app>/api/cron/backup?download=1" -H "x-cron-secret: X" -o backup.json` |
| `send-monthly-payroll.ps1` (hard-coded default secret) | reads `-Secret` / `$env:CRON_SECRET`; sends a header |

Already updated: the production and staging deploy workflows (seed step), `send-monthly-payroll.ps1`, `DEPLOY.md`.
**Because earlier URLs containing the secret were logged (Vercel logs, browser history), rotate `CRON_SECRET`
in each environment (and the matching GitHub secrets `PROD_CRON_SECRET` / `STAGING_CRON_SECRET`) after this ships.**

`/api/admin/reset` is additionally **blocked on the live production deployment** (`VERCEL_ENV=production`) unless
`ALLOW_ADMIN_RESET=true` is set deliberately for the duration of an intended wipe.

### 2. Backup export carries no credentials
`lib/backup.ts` no longer includes `password`, `pin`, `resetToken` or `resetTokenExpiry` for users. The weekly
backup email / download can no longer hand anyone offline-crackable hashes. Consequence: restoring *from this JSON*
recreates users without credentials (reset them). True disaster recovery is the Neon point-in-time restore.

### 3. Sessions are revoked immediately (new `proxy.ts`)
Until now only ~5 of ~350 API routes re-checked the database, so a deactivated / demoted / password-reset user
kept working for up to 8 h. `proxy.ts` now rejects, for **every** `/api` request, a validly-signed session token
whose account is deactivated or whose `sessionEpoch` moved on (HTTP 401, `code: "SESSION_REVOKED"`; the app logs
the user out cleanly). Takes effect within ~15 s (per-instance cache).
Safe by construction: it only ever *denies* genuine session tokens of revoked accounts. No/other Bearer values
(cron secrets, webhooks, public routes, login) pass through untouched; if the DB is unreachable it fails **open**.
- Changing your own password now ends all *other* sessions (epoch bump) and hands the current browser a fresh
  token, so you stay signed in.
- New `GET /api/auth/me` re-validates the stored session when the app loads.

### 4. Brute-force / abuse limits on public endpoints
In-memory, per-instance limiter (`lib/rate-limit.ts`): login (30 failures/10 min per IP, 8/10 min per account;
only failures count), PIN-login per-IP failures (on top of the existing per-account DB lockout), forgot-password
(10/h per IP, 3/h per address), reset-password, the pre-login outlet/staff pickers, payment webhooks,
change-password, and the public booking endpoints (creation 10 per 10 min per IP; booking lookup 20/min).
Booking numbers now use a cryptographically-random 8-character suffix instead of a 4-digit `Math.random()`
value (the lookup returns the guest's name and phone, and the old numbers were enumerable); existing numbers
remain valid. Login also performs a dummy password check for unknown emails so response time no longer reveals
which emails exist.
Limitation: serverless instances don't share memory, so this blunts scripted abuse but is not a global guarantee.
The shared-store version arrives with the multi-tenant schema work.

### 5. Payment webhooks must be signed
`POST /api/payment-integration-connectors/:id/webhook` now requires header `x-signature` =
hex `HMAC-SHA256(secret, rawBody)` (a `sha256=` prefix is accepted). Each webhook connector gets its own random
secret, shown **once** on creation / rotation in *Payment Connectors* and never returned again. A connector with
no secret accepts nothing (fails closed): open the page and click **Set signing secret** for any existing one.
Also fixed: every webhook payment used the connector id as its `sourceRef`, which made each payment overwrite
the previous one; it is now unique per payment, so provider retries are idempotent and distinct payments stay distinct.

### 6. Read-by-id endpoints now check ownership
`GET /api/pos/orders/:id`, `/api/signed-bills/:id/story`, `/api/collection-sessions/:id`, `/api/events/:id` were
readable by any signed-in account. Now: CASHIER/WAITER only for their own outlet (or, for events, ones they are
rostered on; for POS orders, their own orders); management and ACCOUNTANT keep cross-outlet oversight. Denials
return 404 (same as "missing") so ids can't be probed.

### 7. The owner's email is no longer in the browser bundle
Server code reads `OWNER_EMAIL` (falling back to the existing `NEXT_PUBLIC_OWNER_EMAIL`, so **no env change is
required**). Client pages get an `isOwner` flag from the server (login / `/api/auth/me`). Recommended: set
`OWNER_EMAIL` in Vercel and later delete `NEXT_PUBLIC_OWNER_EMAIL`. Sessions stored before this ships pick up the flag
on next page load (via `/api/auth/me`).

### 8. Seed no longer plants known credentials in production
`lib/seed-core.ts` runs on every deploy and upserts, so a deleted demo account would silently come back with its
public password. On the production deployment (`VERCEL_ENV=production`) it now creates **no** demo users and **no**
default PIN; new placeholder waiters get a random throw-away password. Staging/local are unchanged. First admin of a
brand-new production DB: set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (≥12 chars) before seeding (`DEPLOY.md`).
Email login is also refused outright for `@staff.internal` placeholder identities (PIN-only staff), which closes the
old `staffLogin123` route for accounts that already exist.

## Run this against production (read-only)
Existing rows keep whatever credentials they were created with. Find the ones still on public defaults:

```bash
DATABASE_URL="<prod url>" npx tsx scripts/ops-check-default-credentials.ts
```
It prints account names/emails only (never hashes) and changes nothing. Reset/deactivate whatever it lists.

## Known limits (deliberately not in Phase 1)
- Rate limiting is per-instance (see §4).
- Individual routes still trust the role in the token for *which* data they return; company-level isolation
  is Phase 2–4 of the multi-tenant plan.
- `users/[id]` lets anyone with EDIT_USER promote an account to ADMIN; scheduled for the access-control pass.
- Public booking creation is rate limited (10 / 10 min per IP) but has no CAPTCHA; a determined attacker rotating IPs could still reserve inventory. Add a CAPTCHA/deposit step if abuse appears.
