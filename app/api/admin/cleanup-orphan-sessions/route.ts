import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Remove orphaned BusinessSession rows — the denormalized BI mirror of
 * DailyCollection (see lib/business-session.ts). Before the delete path was
 * fixed, deleting a DailyCollection left its BusinessSession row behind, so
 * the dashboard's Staff Performance widget kept showing deleted staff with
 * stale days/loss/excess. A row is orphaned when NO DailyCollection exists for
 * its (outletId, date, staffName) — the same key syncBusinessSession upserts on.
 *
 * POST only. Authenticate either as an ADMIN / owner, or — for the first
 * bootstrap — with CRON_SECRET passed as an `x-cron-secret` header or
 * `Authorization: Bearer <secret>`. The secret is never read from the URL
 * (which leaks into proxy / server / browser logs). Send { "dryRun": true } in
 * the body (or ?dryRun=1) to preview which rows would be deleted. Example:
 *   curl -X POST https://<app>/api/admin/cleanup-orphan-sessions \
 *     -H "x-cron-secret: <CRON_SECRET>" -H "content-type: application/json" \
 *     -d '{ "dryRun": true }'
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

  // dryRun is a non-sensitive flag — accepted from the JSON body or a query param.
  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun === true || req.nextUrl.searchParams.get('dryRun') === '1'

  const sessions: Array<{ id: string; outletId: string; date: Date; staffName: string }> =
    await db.businessSession.findMany({ select: { id: true, outletId: true, date: true, staffName: true } })

  const orphans: Array<{ id: string; staffName: string; outletId: string; date: string }> = []
  for (const s of sessions) {
    const match = await prisma.dailyCollection.findFirst({
      where: {
        outletId: s.outletId,
        date: s.date,
        // syncBusinessSession maps a null staffName to 'Unassigned'
        ...(s.staffName === 'Unassigned' ? {} : { staffName: s.staffName }),
      },
      select: { id: true },
    })
    if (!match) orphans.push({ id: s.id, staffName: s.staffName, outletId: s.outletId, date: s.date.toISOString().slice(0, 10) })
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, scanned: sessions.length, orphanCount: orphans.length, orphans })
  }

  const res = orphans.length
    ? await db.businessSession.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } })
    : { count: 0 }

  return NextResponse.json({ ok: true, scanned: sessions.length, deleted: res.count, orphans })
}
