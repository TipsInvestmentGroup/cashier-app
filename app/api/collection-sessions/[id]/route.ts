import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSingleOutletRole } from '@/lib/auth'

/** Full session detail — template tree (for rendering) + every stage record and its field values so far. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const session = await prisma.collectionSession.findUnique({
    where: { id },
    include: {
      outlet: { select: { id: true, name: true } },
      template: {
        include: { stages: { orderBy: { order: 'asc' }, include: { sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } } } } },
      },
      stageRecords: { include: { fieldValues: true } },
    },
  })
  // Single-outlet roles (CASHIER/WAITER) may only open their own outlet's session; same
  // response as "missing" so ids can't be probed.
  if (!session || (isSingleOutletRole(user.role) && (!user.outletId || user.outletId !== session.outletId))) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json(session)
}
