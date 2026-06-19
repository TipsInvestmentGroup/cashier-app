import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const CRON_SECRET = process.env.CRON_SECRET

// POST /api/pos/setup?secret=xxx — idempotent seed of tables, counters, and extras.
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!CRON_SECRET || secret !== CRON_SECRET)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outlets = await prisma.outlet.findMany({ where: { isActive: true } })

  const COUNTERS = [
    { code: 'MAIN', label: 'Main Counter' },
    { code: 'BAR', label: 'Bar Counter' },
    { code: 'SHISHA', label: 'Shisha Counter' },
    { code: 'KITCHEN', label: 'Kitchen Counter' },
  ]

  let tablesCreated = 0
  let countersCreated = 0

  for (const outlet of outlets) {
    for (let n = 1; n <= 20; n++) {
      const existing = await prisma.posTable.findFirst({ where: { outletId: outlet.id, number: n } })
      if (!existing) {
        await prisma.posTable.create({ data: { outletId: outlet.id, number: n, capacity: 4 } })
        tablesCreated++
      }
    }
    for (const c of COUNTERS) {
      const existing = await prisma.posCounter.findFirst({ where: { outletId: outlet.id, code: c.code } })
      if (!existing) {
        await prisma.posCounter.create({ data: { outletId: outlet.id, code: c.code, label: c.label } })
        countersCreated++
      }
    }
  }

  const EXTRAS = ['Barafu', 'Straw', 'Lemon', 'Sugar', 'Soda', 'Water (Mixer)', 'No Ice']
  for (const name of EXTRAS) {
    await prisma.posProductExtra.upsert({ where: { name }, update: {}, create: { name } })
  }

  return NextResponse.json({ ok: true, outlets: outlets.length, tablesCreated, countersCreated })
}
