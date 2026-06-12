import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/**
 * Full "payment story" for a signed bill: the bill itself, every payment made
 * against it (oldest-first), the running total paid, and the remaining balance.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const bill = await prisma.signedBill.findUnique({
    where: { id },
    include: { outlet: { select: { name: true } }, cashier: { select: { name: true } } },
  })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const payments = await prisma.paidBill.findMany({
    where: { signedBillId: id },
    include: { cashier: { select: { name: true } }, outlet: { select: { name: true } } },
    orderBy: { date: 'asc' },
  })

  const totalPaid = payments.reduce((s, p) => s + p.amountPaid, 0)
  const balance = bill.amount - totalPaid

  return NextResponse.json({ bill, payments, totalPaid, balance })
}
