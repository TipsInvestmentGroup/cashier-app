# Multi-company programme — Phase 4: company isolation enforced in the data layer

Builds on Phase 3 (`MULTI-TENANT-PHASE3.md`). Until now only ~45 routes filtered by company; the rest relied on outlet
scoping or nothing. Phase 4 moves enforcement **into the shared Prisma client**, so it covers every route, job and lib —
including ones added later — instead of trusting each handler to remember `where: { companyId }`.

## The tenant guard (`lib/tenant-guard.ts`)
Inside a signed-in request (company taken from the verified session; `proxy.ts` strips any client-sent copy):

| Operation | Effect |
|---|---|
| `find*`, `count`, `aggregate`, `groupBy` | `where` is AND-ed with the company condition |
| `update`, `updateMany`, `delete`, `deleteMany`, `upsert` | same — another company's record is simply *not found*, by id as much as in lists |
| `create`, `createMany`, `update`, `upsert` | every foreign key that points at a company-scoped model (outlet, product, person, account, …) must belong to the session company, including `connect` forms and plain-column outlets. The map is **generated from `schema.prisma`** (`lib/tenancy-fks.ts`, 175 keys over 119 models) and CI fails if it goes stale |
| unscoped | system contexts (scripts, seed, cron, public + pre-login routes) and the explicit `prismaSystem` client |

What is scoped: the 60 tenant roots + 40 company-native models by their `companyId`; **child tables queried directly** through their
parent relation, recursively (63 of 64; `lib/tenancy-fks.ts` `CHILD_SCOPE`, generated); **users by membership** (a `role` /
`outletId` / `isActive` condition is evaluated against the membership held *in that company*, not the legacy columns); and
the 14 `(scope, scopeId)` config tables (a company reads `GLOBAL` defaults + its own `COMPANY`/`OUTLET` rows, writes only its
own; `GLOBAL`/`ROLE` rows are the original company's legacy defaults and read-only for others). `Membership` is exempt (it
spans companies by design). NULL/`''` legacy rows count as the **original** company only, and only where the column is
optional (Prisma rejects `companyId: null` on a required column — the first crawl caught this).

Switches: `TENANT_GUARD=off` (guard only), `TENANT_STAMP=off` (write-stamping). `runAsCompany(id, fn)` runs work *as* a company
(scripts, cron); it only narrows, never widens. `prismaSystem` is for identity code that must look across companies
(sign-in, switching, platform console, the tenant layer) — never business data.

## Other enforcement in this change
- **Legacy authority belongs to the original company.** Hard-coded TIPS approver emails, the global owner email and the global
  approver/cash-verifier `Setting` lists apply only in the original company's context (`legacyAuthorityApplies()`); another
  company gets empty lists and sees its *own* owner. The three access screens no longer leak TIPS emails; their setters refuse
  with a clear message for other companies until per-company grants exist (decision D11).
- **`/api/companies`** returns only the caller's own companies.
- **Pre-login MyPOS pickers** (outlets/staff) were listing every company's outlets and waiters to anyone. With one active company
  nothing changes; with several, the terminal must supply a company code (asked once, remembered on the device); unknown/suspended
  codes reveal nothing.
- **Cron jobs run once per company**, each confined to that company (`forEachCompany`): daily summary, monthly payroll and weekly backup
  now go only to that company's directors, with its own figures. Backups are per company; the manual download needs `?company=<code>`
  once there are several; deployment-global settings are excluded from non-original companies' backups.
- **Sales-import aliases** are keyed per company (`''` stays the original company's legacy key).

## How it was verified
- `npm run test:tenancy` — 58 checks on a self-contained two-company fixture (reads, writes, deletes, references, users/roles per company,
  config scopes, audit trails, child tables, legacy authority, pickers, per-company jobs, unscoped paths). Runs in CI.
- **Leak crawler** (calls every parameter-free GET as a signed-in Acme admin and scans for any TIPS identifier/email) and a **guard
  on/off differential** for the original company. It found real defects, all fixed here: 39 routes returning 500 (the NULL-filter bug),
  the config tables, an audit trail, three access screens, `/api/companies`, directly-queried child tables, and the per-company role issue.
  **Final result: 0 leaks in either direction** (205 routes, TIPS admin and Acme admin); TIPS responses identical with the guard on/off
  except where the guard correctly hides the other company's data.
- Regression on the guard-enabled code: Phase 1 (60), Phase 2 isolation (58), rollout window (9) and Phase 3 stamping (9) suites. One Phase 3
  expectation changed on purpose: a TIPS admin writing at an Acme outlet used to produce an Acme-stamped row; it is now rejected.

## Known limits — still blocking onboarding of a second company
1. **Per-company unique keys (Phase 3 step 3e).** Shared-master screens (payment channels, bill types, departments, person categories,
   cancellation/excess reasons…) "seed defaults when empty". For a new company that table *is* empty, and the insert collides with the
   original company's rows on the **global** unique keys (`code`/`name`/`id`) → HTTP 500 on first visit. The guard works (it shows an empty
   list); the keys must become per-company. Same for document numbers/counters (3f) and `Setting` (3g).
2. **Top-level `where` only.** The user `role`/`outletId`/`isActive` mapping applies to top-level conditions, not ones nested in `OR`/`AND`;
   a returned `user.role` is still the legacy mirror (display only — authorisation uses the session's membership role).
3. **Nested relation reads** (`include`) are not intercepted; they are bounded by their (guarded) parent. `PayrollAuditLog` (a plain `runId`
   column, no relation) cannot be scoped by the guard and is only ever reached through its run.
4. A violation on a malicious cross-company write throws `TenantAccessError` (surfaces as HTTP 500 from handlers without their own catch).
   Legitimate users never trigger it.
5. Owner/approver authority in other companies is intentionally minimal until per-company grants (D11).
