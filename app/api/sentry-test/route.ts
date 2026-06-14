import { NextRequest, NextResponse } from 'next/server'

/**
 * One-time Sentry smoke test. Visit /api/sentry-test?secret=<CRON_SECRET> once
 * in production — it throws on purpose so the error shows up in Sentry.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  throw new Error('Sentry test error — intentional, from /api/sentry-test')
}
