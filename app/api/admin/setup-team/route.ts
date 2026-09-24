import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { setupTeam } from '@/lib/team-seed'
import { getAuthUser, requireRole } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) production team setup. Ensures outlets exist and upserts
 * the TEAM roster (lib/team-seed.ts). New users get the temp password; existing
 * users keep their password.
 *
 * POST only. Authenticate either as an ADMIN / owner (once the app has users),
 * or — for the very first bootstrap when no admin exists yet — with CRON_SECRET
 * passed as an `x-cron-secret` header or `Authorization: Bearer <secret>`. The
 * secret is never read from the URL, and the temp password comes from the JSON
 * body, never the query string — a password in a URL leaks into proxy / server /
 * browser logs. Example bootstrap:
 *   curl -X POST https://<app>/api/admin/setup-team \
 *     -H "x-cron-secret: <CRON_SECRET>" -H "content-type: application/json" \
 *     -d '{ "password": "<TEMP_PASSWORD>" }'
 */
function headerSecretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const provided = req.headers.get('x-cron-secret') || bearer // not from the query string
  return !!provided && provided === secret
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  const isAdmin = !!user && (isOwner(user.email) || requireRole(user, ['ADMIN']))
  if (!isAdmin && !headerSecretOk(req)) {
    return NextResponse.json({ error: 'Unauthorized — sign in as an admin, or send the bootstrap secret in the x-cron-secret header' }, { status: 401 })
  }

  // Temp password comes from the POST body, never the URL (a query string leaks
  // into logs). Defaults if omitted; new users get it, existing users keep theirs.
  const body = await req.json().catch(() => ({}))
  const tempPassword = typeof body?.password === 'string' && body.password ? body.password : 'ChangeMe@2026'
  if (tempPassword.length < 6) return NextResponse.json({ error: 'Temp password must be at least 6 characters' }, { status: 400 })

  try {
    const result = await setupTeam(prisma, tempPassword)
    return NextResponse.json({ ok: true, ...result, note: 'Share the temp password privately; users should change it via 🔑 Change Password on first login.' })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Setup failed' }, { status: 500 })
  }
}
