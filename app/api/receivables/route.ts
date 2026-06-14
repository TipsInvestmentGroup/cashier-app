import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { differenceInDays } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const outletId = searchParams.get('outletId')

  // Rejected bill requests are void → never a receivable
  const where: Record<string, unknown> = { status: { not: 'PAID' }, approvalStatus: { not: 'REJECTED' } }
  if (type) where.billType = type
  if (outletId) where.outletId = outletId

  const bills = await prisma.signedBill.findMany({
    where,
    include: {
      outlet: true,
      person: true,
      payments: { select: { amountPaid: true } },
    },
    orderBy: { date: 'asc' },
  })

  const now = new Date()

  // Per-person sequence number (1..N by signing order) — friendly ref instead of voucher
  const all = await prisma.signedBill.findMany({ select: { id: true, personId: true, personName: true }, orderBy: { createdAt: 'asc' } })
  const seqMap = new Map<string, number>()
  const counter = new Map<string, number>()
  for (const a of all) {
    const k = a.personId || `name:${a.personName}`
    const n = (counter.get(k) || 0) + 1
    counter.set(k, n)
    seqMap.set(a.id, n)
  }

  const receivables = bills.map((b) => {
    const totalPaid = b.payments.reduce((s, p) => s + p.amountPaid, 0)
    const balance = b.amount - totalPaid
    const daysOutstanding = differenceInDays(now, b.date)
    const isOverdue = b.dueDate ? now > b.dueDate : daysOutstanding > 30
    const aging = daysOutstanding <= 30 ? '0-30' : daysOutstanding <= 60 ? '31-60' : daysOutstanding <= 90 ? '61-90' : '90+'

    return { ...b, totalPaid, balance, daysOutstanding, isOverdue, aging, seq: seqMap.get(b.id) || null }
  })

  const summary = {
    total: receivables.reduce((s, r) => s + r.balance, 0),
    count: receivables.length,
    overdue: receivables.filter((r) => r.isOverdue).reduce((s, r) => s + r.balance, 0),
    byType: receivables.reduce((acc: Record<string, number>, r) => {
      acc[r.billType] = (acc[r.billType] || 0) + r.balance
      return acc
    }, {}),
  }

  return NextResponse.json({ receivables, summary })
}
