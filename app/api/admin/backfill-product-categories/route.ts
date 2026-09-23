import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { backfillProductCategories } from '@/lib/backfill-product-categories'
import { getAuthUser, requireRole } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) migration of Product.category free text into real
 * ProductCategory rows.
 *
 * POST only. Authenticate either as an ADMIN / owner, or — for the first
 * bootstrap — with CRON_SECRET passed as an `x-cron-secret` header or
 * `Authorization: Bearer <secret>`. The secret is never read from the URL
 * (which leaks into proxy / server / browser logs). Example bootstrap:
 *   curl -X POST https://<app>/api/admin/backfill-product-categories -H "x-cron-secret: <CRON_SECRET>"
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
    const result = await backfillProductCategories(prisma)
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Backfill complete — ${result.categoriesCreated} categor${result.categoriesCreated === 1 ? 'y' : 'ies'}, ${result.productsUpdated}/${result.productsTotal} products updated.`,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Backfill failed' }, { status: 500 })
  }
}
