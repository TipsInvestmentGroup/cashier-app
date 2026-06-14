import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Clear TRANSACTIONAL data to start the pilot on a clean slate.
 * DELETES: bill items, paid bills, cancellations, signed bills, daily collections,
 *          petty cash, cash & bank reconciliations, audit logs.
 * KEEPS:   users, outlets, persons, products, categories, payment channels,
 *          departments, functions, settings.
 *
 * Guarded by CRON_SECRET + an explicit confirm word so it can never fire by accident:
 *   /api/admin/reset?secret=<CRON_SECRET>&confirm=RESET
 * ⚠️ Irreversible — take a backup first (/api/cron/backup?secret=...&download=1).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })

  const sp = req.nextUrl.searchParams
  if (sp.get('secret') !== secret) return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  if (sp.get('confirm') !== 'RESET') {
    return NextResponse.json({ error: 'Add &confirm=RESET to confirm. This permanently deletes transactional data.' }, { status: 400 })
  }

  // Delete children before parents (foreign-key safe).
  const [billItems, paidBills, cancellations, signedBills, collections, pettyCash, cashRecon, bankRecon, auditLogs] =
    await prisma.$transaction([
      prisma.billItem.deleteMany({}),
      prisma.paidBill.deleteMany({}),
      prisma.cancellation.deleteMany({}),
      prisma.signedBill.deleteMany({}),
      prisma.dailyCollection.deleteMany({}),
      prisma.pettyCash.deleteMany({}),
      prisma.cashRecon.deleteMany({}),
      prisma.bankRecon.deleteMany({}),
      prisma.auditLog.deleteMany({}),
    ])

  const deleted = {
    billItems: billItems.count, paidBills: paidBills.count, cancellations: cancellations.count,
    signedBills: signedBills.count, collections: collections.count, pettyCash: pettyCash.count,
    cashRecon: cashRecon.count, bankRecon: bankRecon.count, auditLogs: auditLogs.count,
  }
  return NextResponse.json({ ok: true, message: 'Transactional data cleared. Setup/master data kept.', deleted })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
