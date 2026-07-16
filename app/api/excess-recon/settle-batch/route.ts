import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'

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

  const totalBalance = roundMoney(rows.reduce((s, r) => s + roundMoney(r.row.amount - r.row.paidAmount), 0))
  if (amount > totalBalance) {
    return NextResponse.json({ error: `Payment ${amount} exceeds the combined balance of ${totalBalance}` }, { status: 400 })
  }

  let remaining = amount
  const applied: { id: string; source: string; amount: number; newPaid: number; balance: number }[] = []
  for (const { id, source, row } of rows) {
    if (remaining <= 0) break
    const balance = roundMoney(row.amount - row.paidAmount)
    if (balance <= 0) continue
    const pay = roundMoney(Math.min(balance, remaining))
    const newPaid = roundMoney(row.paidAmount + pay)
    await modelFor(source).update({ where: { id }, data: { paidAmount: newPaid } })
    applied.push({ id, source, amount: pay, newPaid, balance: roundMoney(row.amount - newPaid) })
    remaining = roundMoney(remaining - pay)
  }

  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE', entity: 'ExcessReconBatch', entityId: null,
      details: `Batch excess payment ${amount} across ${applied.length} record(s): ${applied.map((a) => `${a.source}/${a.id}=${a.amount}`).join(', ')}`,
    },
  })

  return NextResponse.json({ ok: true, applied, leftover: remaining })
}
