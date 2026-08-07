// One-time REPORT (writes nothing): the migration check from the Close-the-Day
// Cash Requests redesign §3.3, run BEFORE the legacy Petty Cash screens
// (/petty-cash, /approvals, /petty-payments) are relied on as retired.
//
// It surfaces legacy PettyCash rows that still hold live money — anything not
// yet settled — grouped by outlet, so no outlet's open/pending cash request is
// stranded when the legacy pages drop out of the nav. "Live" here means:
//   status IN (PENDING, APPROVED)   — still in the approval workflow, or
//   paymentStatus = UNPAID          — approved but the cash hasn't been paid out
// and NOT already bridged onto the new framework (expenseRequestId set).
//
//   npx tsx scripts/check-legacy-petty-cash.ts
//
// Read-only: safe to run against production any time. A clean run (0 rows)
// means the legacy tables carry no unresolved money and retirement is safe.
import { prisma } from '@/lib/prisma'

async function main() {
  const rows = await prisma.pettyCash.findMany({
    where: {
      // Not yet migrated onto an ExpenseRequest — a bridged row is served by the
      // new framework, so it is not "stranded" by hiding the legacy screen.
      expenseRequestId: null,
      OR: [
        { status: { in: ['PENDING', 'APPROVED'] } },
        { paymentStatus: 'UNPAID' },
      ],
    },
    orderBy: { date: 'asc' },
    select: {
      id: true, date: true, requestedBy: true, department: true, purpose: true,
      amount: true, status: true, paymentStatus: true, pettyType: true, outletId: true,
    },
  })

  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } })
  const outletName = new Map(outlets.map((o) => [o.id, o.name]))

  console.log(`\nLegacy PettyCash rows still holding live money (unresolved): ${rows.length}`)
  console.log('(status PENDING/APPROVED, or paymentStatus UNPAID, and not bridged to the new framework)\n')

  if (rows.length === 0) {
    console.log('✅ Clean — no open/pending/unpaid legacy petty cash. Safe to keep the legacy pages retired.')
    return
  }

  // Group by outlet so a per-outlet cutover (Mikocheni / Coco Beach …) can see
  // exactly what it must resolve or migrate first.
  const byOutlet = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.outletId || '(no outlet)'
    if (!byOutlet.has(key)) byOutlet.set(key, [])
    byOutlet.get(key)!.push(r)
  }

  for (const [outletId, group] of byOutlet) {
    const label = outletId === '(no outlet)' ? outletId : (outletName.get(outletId) || outletId)
    const total = group.reduce((s, r) => s + r.amount, 0)
    console.log(`── ${label} — ${group.length} row(s), TSh ${total.toLocaleString()}`)
    for (const r of group) {
      const d = r.date.toISOString().slice(0, 10)
      console.log(`   ${d}  ${r.status.padEnd(9)} ${(r.paymentStatus || '—').padEnd(7)} ${r.pettyType.padEnd(10)} TSh ${r.amount.toLocaleString().padStart(12)}  ${r.requestedBy} — ${r.purpose}`)
    }
    console.log('')
  }

  console.log('⚠ Resolve or migrate these into the Cashier Cash fund before treating the legacy pages as fully retired — otherwise this money becomes untracked.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
