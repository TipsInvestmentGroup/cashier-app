import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

/**
 * Clear TRANSACTIONAL data to start the pilot on a clean slate.
 * DELETES: bill items, paid bills, cancellations, signed bills, daily
 *          collections, BI sessions, petty cash, cash & bank reconciliations.
 * KEEPS:   the audit log (the forensic trail must survive a reset), plus users,
 *          outlets, persons, products, categories, payment channels,
 *          departments, functions, settings.
 *
 * POST only, and authenticated as a real ADMIN / system owner — never a secret
 * in the URL (which leaks into proxy/server logs). Requires an explicit confirm
 * token in the JSON body so it can never fire by accident:
 *   POST /api/admin/reset   { "confirm": "RESET" }   (Authorization: Bearer <login token>)
 * ⚠️ Irreversible — take a backup first (/api/cron/backup).
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email) && !requireRole(user, ['ADMIN'])) {
    return NextResponse.json({ error: 'Forbidden — only an administrator can reset transactional data' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== 'RESET') {
    return NextResponse.json({ error: 'Send { "confirm": "RESET" } in the body to confirm. This permanently deletes transactional data.' }, { status: 400 })
  }

  // businessSession is the denormalized BI mirror of dailyCollection; clearing
  // collections without it leaves every dashboard/report reading stale rows.
  const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

  // Delete children before parents (foreign-key safe). The audit log is
  // deliberately NOT cleared — a reset is exactly the kind of event the trail
  // must retain.
  const [billItems, paidBills, cancellations, signedBills, collections, businessSessions, pettyCash, cashRecon, bankRecon] =
    await prisma.$transaction([
      prisma.billItem.deleteMany({}),
      prisma.paidBill.deleteMany({}),
      prisma.cancellation.deleteMany({}),
      prisma.signedBill.deleteMany({}),
      prisma.dailyCollection.deleteMany({}),
      db.businessSession.deleteMany({}),
      prisma.pettyCash.deleteMany({}),
      prisma.cashRecon.deleteMany({}),
      prisma.bankRecon.deleteMany({}),
    ])

  const deleted = {
    billItems: billItems.count, paidBills: paidBills.count, cancellations: cancellations.count,
    signedBills: signedBills.count, collections: collections.count, businessSessions: businessSessions.count,
    pettyCash: pettyCash.count, cashRecon: cashRecon.count, bankRecon: bankRecon.count,
  }

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'RESET_TRANSACTIONAL_DATA', entity: 'System', details: JSON.stringify({ by: user.name, deleted }) },
  })

  return NextResponse.json({ ok: true, message: 'Transactional data cleared. Audit log and setup/master data kept.', deleted })
}
