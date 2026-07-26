# Database Migrations

## Why this exists

Production's Postgres schema was built entirely via `prisma db push --accept-data-loss`
on every deploy — never `prisma migrate deploy`. The 4 migration folders under
`prisma/migrations/` were authored while `prisma/schema.prisma` had
`provider = "sqlite"`, so their SQL bodies use SQLite syntax and
`migration_lock.toml` is (still, deliberately, until the steps below run) locked
to `provider = "sqlite"` even though staging/production run Postgres.

This doc is the one-time procedure to move staging/production onto real,
trackable `prisma migrate deploy` history, plus the ongoing rule for every
migration after that.

## One-time baseline (requires a real Postgres connection — not yet run)

This cannot be completed from a repo checkout alone; it requires a live
Postgres connection string for the target database (Neon staging DB, then
prod). Recorded here so it can be run as soon as those exist:

1. Point `DATABASE_URL_UNPOOLED` at the **staging** Neon database (created per
   `docs/GO-LIVE-RUNBOOK.md` §1), then run `node scripts/prepare-db.mjs` to
   flip `prisma/schema.prisma`'s `provider` to `"postgresql"`.
2. Generate a fresh, Postgres-native baseline migration reflecting the
   *current* schema:
   ```
   npx prisma migrate dev --create-only --name init_postgres_baseline
   ```
   This creates one new migration folder whose SQL is a full `CREATE TABLE …`
   for every model in `schema.prisma`, and rewrites `migration_lock.toml` to
   `provider = "postgresql"`.
3. Apply it for real against the (empty) staging DB:
   ```
   npx prisma migrate deploy
   ```
4. Against **production**, do NOT run the baseline's SQL — its tables already
   exist (built by years of `db push`). Instead mark the migration as already
   applied, without executing it:
   ```
   npx prisma migrate resolve --applied init_postgres_baseline
   ```
   Run this once, manually, from a maintainer's machine with production's
   `DATABASE_URL_UNPOOLED` set. **Never run this in CI** — it's a one-time,
   high-privilege step against live data.
5. Verify with `npx prisma migrate status` against both staging and
   production — staging should show the baseline applied normally; production
   should show it resolved (not pending, not re-runnable).
6. Only after both staging and production pass step 5, switch their build
   commands from `db push --accept-data-loss` to `prisma migrate deploy`
   (`npm run build:staging` / `npm run build:production`, already added to
   `package.json` — wire these in as Vercel's per-environment build command
   override once the baseline is confirmed).

Until this baseline runs, staging/production continue on `db push` and
`scripts/validate-config.ts --env=staging|production` will correctly fail
(by design) because `migration_lock.toml` still says `sqlite`.

## The rule for every migration after the baseline

- Author new migrations with `DATABASE_URL` pointed at the **staging**
  Postgres database, not SQLite — `prisma migrate dev --create-only` emits
  provider-specific SQL, and it must be Postgres-native to run correctly via
  `migrate deploy` later.
- Local day-to-day dev keeps using SQLite + `prisma db push` (`npm run dev`,
  `npm run db:push`) — that never touches migration files and stays fast.
  `db push` doesn't read `migration_lock.toml`, so this is safe to keep
  forever regardless of what the lock file says.
- Never edit or delete an already-applied migration folder. If a migration
  turns out to be wrong, ship a new corrective migration — never rewrite
  history.

## Rollback approach: forward-fix + Neon branch restore (not down-migrations)

Prisma has no first-class down-migration runner, and hand-maintained
`down.sql` scripts are extra process for a small team to keep in sync. Neon
(already the database) provides instant branch-based point-in-time restore,
which `docs/GO-LIVE-RUNBOOK.md` §2 already documents as the practiced recovery
path. Concretely:

- **Bad app code, migration itself was fine:** Vercel → Deployments →
  previous green build → **Promote to Production**. The migration stays
  applied; if it was purely additive (new nullable column/table) this is
  harmless.
- **Bad migration that changed/destroyed data:** Neon Console → Branches →
  create a branch "restore from time" to just before the deploy → verify data
  → either repoint `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at the restored
  branch, or copy the affected data back onto the main branch → then ship a
  **new forward migration** that corrects the schema. Do not edit the
  already-applied migration file.
