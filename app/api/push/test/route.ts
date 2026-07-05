import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * POST /api/push/test — sends a test push to the CALLER's own subscribed
 * devices and returns exactly what happened (attempted/sent/failed with
 * error details), so staff/admins can self-diagnose delivery problems from
 * their own phone instead of needing someone to check server logs.
 */
export async function POST(req: NextRequest) {
  try {
    const user = getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const subCount = await db.pushSubscription.count({ where: { userId: user.userId } })
    if (subCount === 0) {
      return NextResponse.json({ error: 'No push subscription found for your account — enable notifications first.' }, { status: 400 })
    }

    const result = await sendPushToUser(user.userId, {
      title: '🔔 Jaribio la arifa',
      body: 'Kama umepokea hii, arifa zinafanya kazi!',
      url: '/mypos',
    })

    return NextResponse.json({ ...result, subscriptions: subCount })
  } catch (err) {
    // Always return valid JSON, even on an unexpected crash — an HTML error
    // page here would show up client-side as a confusing "not JSON" error.
    console.error('[push/test] Unexpected error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unexpected server error' }, { status: 500 })
  }
}
