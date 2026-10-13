# Multi-company programme — decisions register

Status of the 18 decisions raised in the assessment. "Locked" = the recommended answer was adopted on
2026-10-13 so work can proceed. "Needs you" = depends on a fact, credential or irreversible action only the
business owner can supply; recorded, **not guessed**, and none of them block Phase 2.

| # | Decision | Status | Outcome |
|---|---|---|---|
| D1 | Shared app vs separate deployment | **Locked** | Shared app, one database, `companyId` on tenant data |
| D3 | Group-of-companies level | **Locked** | Not in v1; data model leaves room (`Company` has no parent today) |
| D4 | One login → many companies | **Locked** | `Membership` (user ↔ company, own role/outlet/position); token carries the *active* company |
| D5 | Tenant resolution | **Locked** | Company-code (`slug`) at sign-in now; subdomain later (Phase 7) |
| D6 | Master data | **Locked** | Each company owns its own copy, seeded from templates (Phase 3/5) |
| D7 | Platform-owner access | **Locked** | Separate platform identity; **no implicit access** to company data; break-glass later, audited |
| D11 | Hard-coded approvers/owner | **Locked** | Move to per-company grants (Phase 4); company "owner" = `Membership.isOwner` |
| D12 | Intercompany transactions | **Locked** | Blocked in v1 (cross-company references rejected) |
| D13 | Subscriptions now | **Locked** | Only `Company.status` (ACTIVE/SUSPENDED/ARCHIVED) now; plans/limits/billing later |
| D14 | Float→Decimal money | **Locked** | Separate track (readiness audit #114); finishes before client #2's books go live |
| D15 | Email sender | **Locked** | Per-company from-name/reply-to in Phase 5; per-tenant SMTP later |
| D16 | Phase 1 security fixes | **Done** | PR #156 (CI green) |
| D18 | Offboarding/retention | **Deferred** | Define before client #2's contract is signed |
| D2 | New client's country / currency / language / tax / industry / modules / users / go-live date | **Needs you** | Sizes Phase 5 (payroll statutory pack, chart template, hard-coded SHISHA/FOOD logic). Not needed for Phase 2–4 |
| D8 | Object storage for logos & receipts (Vercel Blob vs S3, cost) | **Needs you** | Needed for Phase 5 only |
| D9 | Production DB state: how migrations are applied; read-only census | **Needs you** | Needed before Phase 3 (backfill/contract). Phase 2's migration is purely additive and safe under either regime |
| D10 | TIPS cut-over window + who signs off reconciliation | **Needs you** | Needed before Phase 3 contract step |
| D17 | Purge real staff PII from git history | **Needs you** | Destructive (history rewrite + force-push on a shared repo); never done without explicit sign-off |

## Phase 1 follow-ups that only you can do
1. Merge PR #156 (merging to `main` triggers the approval-gated production deploy).
2. Rotate `CRON_SECRET` (Vercel + GitHub `PROD_CRON_SECRET` / `STAGING_CRON_SECRET`).
3. Run `scripts/ops-check-default-credentials.ts` against production and reset what it lists.
4. Re-sign existing payment webhook connectors (Payment Connectors → *Set signing secret*).
