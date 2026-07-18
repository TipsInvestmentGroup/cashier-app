import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** GET — one Transaction Session with its System Sales roster + all StaffTransactions (for the cashier summary + drill-down screen). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const session = await prisma.transactionSession.findUnique({
    where: { id },
    include: {
      outlet: { select: { id: true, name: true } },
      systemSales: { orderBy: { staffName: 'asc' } },
      transactions: {
        include: {
          staff: { select: { id: true, name: true } },
          approvals: { select: { id: true, status: true, approverRole: true, comment: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (user.role === 'CASHIER' && session.outletId !== user.outletId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const validatedCollections = await prisma.dailyCollection.findMany({
    where: { outletId: session.outletId, date: session.date },
    select: { id: true, staffName: true },
  })

  return NextResponse.json({ ...session, validatedCollections })
}
