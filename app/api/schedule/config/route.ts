import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, DEFAULT_CONFIG } from '@/lib/scheduling'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** GET /api/schedule/config?outletId= — scheduler knobs for an outlet (defaults if unset). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const outletId = new URL(req.url).searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'outletId required' }, { status: 400 })
  const cfg = await db.outletScheduleConfig.findUnique({ where: { outletId } })
  return NextResponse.json(cfg || { outletId, ...DEFAULT_CONFIG })
}

/** PUT /api/schedule/config — upsert scheduler knobs. body: { outletId, morningWeight, eveningWeight, weekendMultiplier, daysOffPerWeek } */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!body.outletId) return NextResponse.json({ error: 'outletId required' }, { status: 400 })

  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d)
  const data = {
    morningWeight: num(body.morningWeight, DEFAULT_CONFIG.morningWeight),
    eveningWeight: num(body.eveningWeight, DEFAULT_CONFIG.eveningWeight),
    weekendMultiplier: num(body.weekendMultiplier, DEFAULT_CONFIG.weekendMultiplier),
    daysOffPerWeek: Math.min(6, Math.max(0, Math.round(num(body.daysOffPerWeek, DEFAULT_CONFIG.daysOffPerWeek)))),
  }

  const cfg = await db.outletScheduleConfig.upsert({
    where: { outletId: body.outletId },
    update: data,
    create: { outletId: body.outletId, ...data },
  })
  return NextResponse.json(cfg)
}
