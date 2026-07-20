import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** POST — mark one of the caller's own notifications read. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const notification = await prisma.notification.findUnique({ where: { id } })
  if (!notification || notification.userId !== user.userId) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })

  const updated = await prisma.notification.update({ where: { id }, data: { read: true } })
  return NextResponse.json({ ok: true, notification: updated })
}
