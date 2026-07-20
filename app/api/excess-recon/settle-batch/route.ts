import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { UNASSIGNED_EXCESS_REASON } from '@/lib/excess-reasons'
import { classForReason } from '@/lib/reconciliation-classification'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

interface Target { id: string; source: 'CASH_RECON' | 'COLLECTION' }

/** Settle several excess rows (any mix of sources) with one payment, allocated
 *  in the given order — cap each row at its own balance, carry the rest forward. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role) && !(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'settle'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const items: Target[] = Array.isArray(body.items) ? body.items : []
  const amount = roundMoney(body.amount)
  if (items.length === 0) return NextResponse.json({ error: 'Select at least one excess record' }, { status: 400 })
  if (amount <= 0) return NextResponse.json({ error: 'Payment amount must be greater than zero' }, { status: 400 })
  for (const it of items) {
    if (it.source !== 'CASH_RECON' && it.source !== 'COLLECTION') {
      return NextResponse.json({ error: 'Each item must specify source CASH_RECON or COLLECTION' }, { status: 400 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelFor = (source: Target['source']) => (source === 'CASH_RECON' ? prisma.cashReconExcess : prisma.collectionExcess) as any

  const rows = await Promise.all(items.map(async (it) => {
    const row = await modelFor(it.source).findUnique({ where: { id: it.id } })
    if (!row) throw new Error(`Excess item ${it.id} not found`)
    return { ...it, row }
  })).catch((err: unknown) => { throw err })

  // Classification gate: refuse the whole batch if any row is still unclassified.
  const unclassified = rows.find((r) => r.row.reason === UNASSIGNED_EXCESS_REASON)
  if (unclassified) {
    return NextResponse.json({ error: `One or more selected records are unclassified ("Needs reason") — assign a Difference Reason before settling.` }, { status: 400 })
  }

  const totalBalance = roundMoney(rows.reduce((s, r) => s + roundMoney(r.row.amount - r.row.paidAmount), 0))
  if (amount > totalBalance) {
    return NextResponse.json({ error: `Payment ${amount} exceeds the combined balance of ${totalBalance}` }, { status: 400 })
  }

  const applied: { id: string; source: string; amount: number; newPaid: number; balance: number }[] = []
  const remaining = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txModelFor = (source: Target['source']) => (source === 'CASH_RECON' ? tx.cashReconExcess : tx.collectionExcess) as any
    let rem = amount
    for (const { id, source, row } of rows) {
      if (rem <= 0) break
      const balance = roundMoney(row.amount - row.paidAmount)
      if (balance <= 0) continue
      const pay = roundMoney(Math.min(balance, rem))
      const newPaid = roundMoney(row.paidAmount + pay)
      await txModelFor(source).update({ where: { id }, data: { paidAmount: newPaid, paidAt: new Date() } })

      // COLLECTION-source PAYABLE payout relieves the Excess-Payable liability
      // accrued at collection: Dr Excess-Payable / Cr Cash. Other rows keep
      // their prior non-GL behavior (see D10 for cash-recon excess).
      if (source === 'COLLECTION' && classForReason(row.reason, row.category) === 'PAYABLE') {
        const coll = await tx.collectionExcess.findUnique({ where: { id }, include: { collection: { include: { outlet: true } } } })
        const outletId = coll?.collection.outletId
        const companyId = coll?.collection.outlet?.companyId || (await resolveDefaultCompanyId(tx))
        if (companyId && outletId) {
          const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: row.channelCode || 'CASH', outletId })
          const excessPayableAccountId = await resolveAccountId(tx, { companyId, key: 'EXCESS_PAYABLE' })
          await postJournalEntry(tx, {
            companyId, entryDate: new Date(), sourceModule: 'COLLECTIONS', sourceType: 'ExcessSettlement', sourceId: id,
            description: `Excess payout (batch) — collection excess ${id}`, createdById: user.userId,
            lines: [
              { accountId: excessPayableAccountId, debit: pay, outletId },
              { accountId: cashAccountId, credit: pay, outletId },
            ],
          })
        }
      }
      applied.push({ id, source, amount: pay, newPaid, balance: roundMoney(row.amount - newPaid) })
      rem = roundMoney(rem - pay)
    }

    await tx.auditLog.create({
      data: {
        userId: user.userId, action: 'UPDATE', entity: 'ExcessReconBatch', entityId: null,
        details: `Batch excess payment ${amount} across ${applied.length} record(s): ${applied.map((a) => `${a.source}/${a.id}=${a.amount}`).join(', ')}`,
      },
    })
    return rem
  })

  return NextResponse.json({ ok: true, applied, leftover: remaining })
}
