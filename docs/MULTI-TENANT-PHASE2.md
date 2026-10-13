# Multi-company programme — Phase 2: tenant identity foundation (operations notes)

Builds on Phase 1 (`SECURITY-PHASE1.md`). Decisions: `MULTI-TENANT-DECISIONS.md`.

## The model
- **User** = a login identity. **Company** = a tenant. **Membership** = a user's role / outlet / position *in one
  company* (a person may have several). A session token is bound to exactly **one** company
  (`JWTPayload.companyId`, plus `owner` = owner of that company).
- **Platform admin** = the product owner. A separate identity (`PlatformAdmin`) with no membership and **no access to
  any company's business data**; it can only list/create/suspend companies via `/api/platform/*`.
- Token kinds: a normal session token has no `kind`; company-selection and platform tokens carry `kind` and are
  rejected by `getAuthUser`, so they can never act as a session (and a session can never call `/api/platform/*`).

## What changed
| Area | Change |
|---|---|
| Schema (additive migration `20261013120000_tenant_identity_foundation`) | `Company.slug`, `Company.status`; new tables `Membership`, `PlatformAdmin`, `PlatformAuditLog`. Nothing existing is altered or dropped. |
| Sign-in | `POST /api/auth/login` auto-selects the company when there is one; with several it returns `needsCompany` + a 5-minute selection token → `POST /api/auth/select-company`. `login` also accepts `company` (code or id). PIN login binds to the company that owns the waiter's outlet. |
| Switching | `POST /api/auth/switch-company` (re-validated against the DB). The app reloads, clears per-company local caches, and **refuses to switch while unsent offline orders exist**. |
| API gate (`proxy.ts`) | In addition to Phase 1's revocation: the session's membership must still be active and its company `ACTIVE`; a suspended company gets `403 COMPANY_SUSPENDED` immediately (≈15 s cache). |
| Users | `GET/POST /api/users`, `PUT/DELETE /api/users/[id]` are company-scoped: you only see/edit/remove your own company's people, can only place them at your company's outlets; removing someone who also belongs elsewhere removes only the membership. Duplicate email → 409. |
| ~45 finance / reconciliation / payment / expense-config / credit / petty / excess routes | The company now comes from the **session**. A client-supplied `companyId` is honoured only if it equals the session's company; anything else is treated as "no company" (empty / 404). By-id routes 404 for another company's record. Foreign ids in bodies (accounts, GRNs, invoices, outlets, categories…) are validated against the caller's company. |
| Owner | `Membership.isOwner` (owner of *that* company) replaces "this email, everywhere" for user management. |
| Seed | `backfillTenantIdentity()` runs on every deploy seed: slug for every company, orphan outlets join the original company, a membership for every user, legacy owner flagged on the original company. Idempotent, fill-only. |

## Rollout order is forgiving
The migration only adds tables/columns. Until the seed backfill runs, the app behaves exactly as before: a user with no
membership is treated as belonging to the original company, a membership is created on demand at sign-in / first API use,
and tokens issued before the deploy (no company claim) keep working until they expire. Verified in a dedicated test.

## Platform owner (one-time)
```bash
PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='<12+ chars>' \
DATABASE_URL=<target db url> npx tsx scripts/create-platform-admin.ts
```
Then `POST /api/platform/auth/login` → `GET/POST /api/platform/companies`, `PATCH /api/platform/companies/:id`
(`{"status":"SUSPENDED"|"ACTIVE"|"ARCHIVED"}`). Everything is written to `PlatformAuditLog`. No UI yet (Phase 5).

## Known limits — deliberately next
- **Phase 3:** `companyId` on the ~140 tables that lack it; make `Outlet.companyId` / `Company.slug` required; composite
  uniques; per-company numbering; `Setting` per company. Until then, many *list* endpoints (bills, collections, POS,
  inventory, reports, persons, products…) are still scoped by outlet only, **so a second company must not be onboarded
  yet**. The remaining default-company fallbacks live in libs (`collection-gl`, `stock`, `finance-ar`, `credit/expense/payroll-config`, …).
- **Phase 4:** the sibling `expense/*/[id]` routes, payroll/employee routes, inventory, POS, persons, products, events,
  notifications, audit log; per-company approver lists; remaining `isOwner(email)` call sites.
- A company with no users cannot be signed in to; provisioning its first admin/outlets/seed pack is Phase 5 (`createCompany`).
