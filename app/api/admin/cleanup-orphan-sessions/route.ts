import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
 * Guarded by CRON_SECRET so it can't fire by accident:
 *   /api/admin/cleanup-orphan-sessions?secret=<CRON_SECRET>
 * Add &dryRun=1 to preview which rows would be deleted without deleting them.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.nextUrl.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'

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

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
