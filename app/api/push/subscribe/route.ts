import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * POST /api/push/subscribe — body: the raw PushSubscription.toJSON() from
 * the browser: { endpoint, keys: { p256dh, auth } }. Upserted by endpoint so
 * re-subscribing (e.g. after clearing site data) doesn't create duplicates.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const endpoint: string | undefined = body?.endpoint
  const p256dh: string | undefined = body?.keys?.p256dh
  const auth: string | undefined = body?.keys?.auth
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })

  await db.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.userId, p256dh, auth },
    create: { userId: user.userId, endpoint, p256dh, auth },
  })

  return NextResponse.json({ ok: true })
}
