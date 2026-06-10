import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { seedCore } from '@/lib/seed-core'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time database seeding for production. Open in a browser:
 *   https://<your-app>.vercel.app/api/admin/seed?secret=<CRON_SECRET>
 * Creates outlets + login users + Directors/Admins/Staff. Idempotent.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  const provided = req.nextUrl.searchParams.get('secret')
  if (provided !== secret) return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })

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
