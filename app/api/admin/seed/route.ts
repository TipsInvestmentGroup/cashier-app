import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { seedCore } from '@/lib/seed-core'
import { requireCronSecret } from '@/lib/cron-auth'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Database seeding (also run by the deploy pipeline). The secret goes in a header,
 * never the URL:
 *   curl -X POST https://<your-app>/api/admin/seed -H "x-cron-secret: <CRON_SECRET>"
 * Creates outlets + login users + Directors/Admins/Staff. Idempotent.
 */
async function handle(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  try {
    const result = await seedCore(prisma)
    return NextResponse.json({ ok: true, ...result, message: 'Seeding complete. You can now log in.' })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Seed failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
