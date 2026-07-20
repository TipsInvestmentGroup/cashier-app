import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rec = await prisma.accountReconciliation.findUnique({
    where: { id }, include: { companyPaymentAccount: true, items: { orderBy: { transactionDate: 'asc' } } },
  })
  if (!rec) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 })
  return NextResponse.json(rec)
}
