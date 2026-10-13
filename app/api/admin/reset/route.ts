import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

/**
 * Clear TRANSACTIONAL data to start the pilot on a clean slate.
 * DELETES: bill items, paid bills, cancellations, signed bills, daily collections,
 *          petty cash, cash & bank reconciliations, audit logs.
 * KEEPS:   users, outlets, persons, products, categories, payment channels,
 *          departments, functions, settings.
 *
 * Guarded by CRON_SECRET (header) + an explicit confirm word so it can never fire by accident:
 *   POST /api/admin/reset?confirm=RESET   with header  x-cron-secret: <CRON_SECRET>
 * ⚠️ Irreversible — take a backup first (GET /api/cron/backup?download=1, secret in the header).
 *
 * HARD-BLOCKED on the live production deployment (VERCEL_ENV=production) unless
 * ALLOW_ADMIN_RESET=true is deliberately set for the duration of an intended wipe:
 * a single leaked secret must not be enough to erase the business's records.
 */
async function handle(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (process.env.VERCEL_ENV === 'production' && process.env.ALLOW_ADMIN_RESET !== 'true') {
    return NextResponse.json(
      { error: 'Reset is disabled on the production deployment. Set ALLOW_ADMIN_RESET=true temporarily if a wipe is truly intended.' },
      { status: 403 },
    )
  }

  const sp = req.nextUrl.searchParams
  if (sp.get('confirm') !== 'RESET') {
    return NextResponse.json({ error: 'Add ?confirm=RESET to confirm. This permanently deletes transactional data.' }, { status: 400 })
  }

  // businessSession is the denormalized BI mirror of dailyCollection; clearing
  // collections without it leaves every dashboard/report reading stale rows.
  const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

  // Delete children before parents (foreign-key safe).
  const [billItems, paidBills, cancellations, signedBills, collections, businessSessions, pettyCash, cashRecon, bankRecon, auditLogs] =
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
      prisma.auditLog.deleteMany({}),
    ])

  const deleted = {
    billItems: billItems.count, paidBills: paidBills.count, cancellations: cancellations.count,
    signedBills: signedBills.count, collections: collections.count, businessSessions: businessSessions.count,
    pettyCash: pettyCash.count, cashRecon: cashRecon.count, bankRecon: bankRecon.count, auditLogs: auditLogs.count,
  }
  return NextResponse.json({ ok: true, message: 'Transactional data cleared. Setup/master data kept.', deleted })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
