import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { seedCore } from '@/lib/seed-core'
import { getAuthUser, requireRole } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time database seeding for production. Creates outlets + login users +
 * Directors/Admins/Staff. Idempotent.
 *
 * POST only. Authenticate either as an ADMIN / owner (once the app has users),
 * or — for the very first bootstrap when no admin exists yet — with CRON_SECRET
 * passed as an `x-cron-secret` header or `Authorization: Bearer <secret>`. The
 * secret is never read from the URL (which leaks into logs). Example bootstrap:
 *   curl -X POST https://<app>/api/admin/seed -H "x-cron-secret: <CRON_SECRET>"
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

  try {
    const result = await seedCore(prisma)
    return NextResponse.json({ ok: true, ...result, message: 'Seeding complete. You can now log in.' })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Seed failed' }, { status: 500 })
  }
}
