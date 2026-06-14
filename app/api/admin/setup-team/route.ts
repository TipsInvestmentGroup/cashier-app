import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { setupTeam } from '@/lib/team-seed'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) production team setup. Open in a browser:
 *   https://<app>.vercel.app/api/admin/setup-team?secret=<CRON_SECRET>&password=<TEMP_PASSWORD>
 * Ensures outlets exist and upserts the TEAM roster (lib/team-seed.ts).
 * New users get the temp password; existing users keep their password.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  if (req.nextUrl.searchParams.get('secret') !== secret) return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })

  const tempPassword = req.nextUrl.searchParams.get('password') || 'ChangeMe@2026'
  if (tempPassword.length < 6) return NextResponse.json({ error: 'Temp password must be at least 6 characters' }, { status: 400 })

  try {
    const result = await setupTeam(prisma, tempPassword)
    return NextResponse.json({ ok: true, ...result, note: 'Share the temp password privately; users should change it via 🔑 Change Password on first login.' })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Setup failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
