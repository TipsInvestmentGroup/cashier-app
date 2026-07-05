import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/push/unsubscribe — body: { endpoint }. Removes this device's subscription. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json().catch(() => ({}))
  if (!endpoint) return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })

  await db.pushSubscription.deleteMany({ where: { endpoint, userId: user.userId } })
  return NextResponse.json({ ok: true })
}
