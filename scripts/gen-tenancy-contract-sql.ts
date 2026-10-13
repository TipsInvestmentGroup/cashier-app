// Prints the Postgres SQL for the multi-company "CONTRACT" step - generated from lib/tenancy-registry.ts so it
// can never drift from the schema. It is deliberately NOT a migration and is NOT applied by anything:
//
//   npx tsx scripts/gen-tenancy-contract-sql.ts > contract.sql
//
// Preconditions (all must hold; the script's own first statement enforces the data one):
//   1. The expand migration + backfill have been live long enough to be sure of the write path
//      (`scripts/tenancy-census.ts` reports READY on the target database, repeatedly).
//   2. A Neon branch/restore point exists, the rehearsal on a clone of production passed, and the TIPS
//      cut-over window is agreed (docs/MULTI-TENANT-DECISIONS.md D9, D10).
//   3. The release that ships this also changes schema.prisma (`String?` -> `String` for these columns,
//      Company.slug required) and removes the remaining default-company fallbacks.
// After applying: `prisma migrate resolve --applied <name>` when this SQL is committed as a migration.
import { TENANT_ROOTS } from '../lib/tenancy-registry'

const roots = Object.keys(TENANT_ROOTS)
const out: string[] = []
out.push('-- Multi-company Phase 3 CONTRACT. Generated from lib/tenancy-registry.ts. Run in ONE transaction, in a quiet window.')
out.push('BEGIN;')
out.push('')
out.push('-- Safety gate: abort if ANY tenant-owned row is still unassigned.')
out.push('DO $$ DECLARE n bigint; BEGIN')
for (const t of ['Outlet', ...roots]) {
  out.push(`  SELECT COUNT(*) INTO n FROM "${t}" WHERE "companyId" IS NULL; IF n > 0 THEN RAISE EXCEPTION '${t}: % rows have no company', n; END IF;`)
}
out.push(`  SELECT COUNT(*) INTO n FROM "Company" WHERE "slug" IS NULL; IF n > 0 THEN RAISE EXCEPTION 'Company: % rows have no slug', n; END IF;`)
out.push('END $$;')
out.push('')
out.push('-- Required company on the outlet and a required sign-in code on the company.')
out.push('ALTER TABLE "Outlet" ALTER COLUMN "companyId" SET NOT NULL;')
out.push('ALTER TABLE "Company" ALTER COLUMN "slug" SET NOT NULL;')
out.push('')
out.push('-- Required company + foreign key on every tenant-root table.')
for (const t of roots) {
  out.push(`ALTER TABLE "${t}" ALTER COLUMN "companyId" SET NOT NULL;`)
  out.push(`ALTER TABLE "${t}" ADD CONSTRAINT "${t}_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`)
}
out.push('')
out.push('COMMIT;')
console.log(out.join('\n'))
