import { NextRequest, NextResponse } from 'next/server'
import { cronSecretOk } from '@/lib/cron-auth'

/**
 * One-time Sentry smoke test. Call GET /api/sentry-test once in production with the
 * header `x-cron-secret: <CRON_SECRET>` — it throws on purpose so the error shows up in Sentry.
 */
export async function GET(req: NextRequest) {
  if (!cronSecretOk(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  throw new Error('Sentry test error — intentional, from /api/sentry-test')
}
