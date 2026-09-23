// #102 — Void duplicate live payroll runs so at most ONE non-reversed run
// remains per scope + period, matching the new invariant enforced by
// lib/payroll-run.ts createPayrollRun() and the partial unique index
// PayrollRun_active_period_scope_key.
//
// A "scope" is (companyId, outletId, payGroupId). Within a scope + periodKey,
// if more than one non-reversed run exists, we KEEP the most-advanced / newest
// run and void the rest by setting them to REVERSED (with a payroll audit note).
//
// SAFETY: a run that is already POSTED or PAID has GL impact and MUST be undone
// with a real reversal, not silently voided. If a group contains more than one
// POSTED/PAID run this script REFUSES to touch that group and reports it for
// manual handling. Non-posted duplicates (DRAFT/CALCULATED/PENDING_APPROVAL/
// APPROVED/LOCKED) have no GL entry, so voiding them is safe.
//
// Idempotent — re-running after a clean pass is a no-op.
//
// Bootstraps its own Prisma client (adapter-by-DATABASE_URL, like prisma/seed.ts).
//
// Usage:
//   npx tsx scripts/dedupe-payroll-runs.ts            # apply
//   npx tsx scripts/dedupe-payroll-runs.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')

// Most-advanced first; ties broken by newest createdAt. A more-advanced run is
// the more authoritative one to keep.
const STATUS_RANK: Record<string, number> = {
  PAID: 7, POSTED: 6, LOCKED: 5, APPROVED: 4, PENDING_APPROVAL: 3, CALCULATED: 2, DRAFT: 1,
}
const POSTED_STATES = new Set(['POSTED', 'PAID'])

function scopeKey(r: { companyId: string; outletId: string | null; payGroupId: string | null; periodKey: string }) {
  return `${r.companyId}|${r.outletId ?? ''}|${r.payGroupId ?? ''}|${r.periodKey}`
}

async function main() {
  const runs = await prisma.payrollRun.findMany({
    where: { status: { not: 'REVERSED' } },
    select: { id: true, companyId: true, outletId: true, payGroupId: true, periodKey: true, status: true, createdAt: true },
  })

  const groups = new Map<string, typeof runs>()
  for (const r of runs) {
    const k = scopeKey(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }

  let voided = 0
  let refused = 0
  for (const [key, group] of groups) {
    if (group.length < 2) continue

    const postedOrPaid = group.filter((r) => POSTED_STATES.has(r.status))
    if (postedOrPaid.length > 1) {
      refused++
      console.error(`[dedupe] REFUSING scope ${key}: ${postedOrPaid.length} POSTED/PAID runs — reverse the extras manually (they have GL entries).`)
      console.error(`         runs: ${postedOrPaid.map((r) => `${r.id}(${r.status})`).join(', ')}`)
      continue
    }

    const ordered = [...group].sort((a, b) => {
      const byRank = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0)
      if (byRank !== 0) return byRank
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
    const keep = ordered[0]
    const toVoid = ordered.slice(1)

    console.log(`[dedupe] scope ${key}: keep ${keep.id} (${keep.status}); void ${toVoid.map((r) => `${r.id}(${r.status})`).join(', ')}`)
    if (DRY_RUN) { voided += toVoid.length; continue }

    for (const r of toVoid) {
      await prisma.payrollRun.update({ where: { id: r.id }, data: { status: 'REVERSED', reversedAt: new Date() } })
      await prisma.payrollAuditLog.create({
        data: {
          runId: r.id,
          action: 'VOID_DUPLICATE',
          userId: 'system',
          userName: 'dedupe-payroll-runs',
          previousValue: r.status,
          newValue: 'REVERSED',
          reason: `Duplicate live run for the same scope + period; kept ${keep.id}. (#102 dedupe)`,
        },
      })
      voided++
    }
  }

  console.log(`\n[dedupe] ${DRY_RUN ? 'would void' : 'voided'} ${voided} duplicate run(s); ${refused} group(s) refused (manual reversal needed).`)
  if (refused > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
