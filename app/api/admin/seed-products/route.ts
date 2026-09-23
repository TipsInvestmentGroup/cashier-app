import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { seedProducts } from '@/lib/seed-products'
import { getAuthUser, requireRole } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) import of the tips product catalogue (146 products).
 * Matches on the unique product code (SKU) — safe to re-run; updates prices on
 * products that already exist rather than creating duplicates.
 *
 * POST only. Authenticate either as an ADMIN / owner, or — for the first
 * bootstrap — with CRON_SECRET passed as an `x-cron-secret` header or
 * `Authorization: Bearer <secret>`. The secret is never read from the URL
 * (which leaks into proxy / server / browser logs). Example bootstrap:
 *   curl -X POST https://<app>/api/admin/seed-products -H "x-cron-secret: <CRON_SECRET>"
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
    const result = await seedProducts(prisma)
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Product import complete — ${result.created} added, ${result.updated} updated (${result.total} total).`,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Product import failed' }, { status: 500 })
  }
}
