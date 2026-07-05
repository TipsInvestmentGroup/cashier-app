import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * /api/pos/setup?secret=xxx — idempotent seed of tables, counters, and
 * extras. Supports GET as well as POST (like /api/admin/seed) so it can be
 * run by just visiting the URL in a browser — a plain address-bar visit is
 * always a GET, and a POST-only route 405s on that.
 */
async function handle(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!CRON_SECRET || secret !== CRON_SECRET)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outlets = await prisma.outlet.findMany({ where: { isActive: true } })

  // serviceModel: DIRECT = seller serves immediately (Main Bar model);
  // PREP = queue → prepare → notify waiter to collect (VIP/Shisha/Kitchen model).
  const DEFAULT_COUNTERS = [
    { code: 'MAIN', label: 'Main Counter', serviceModel: 'DIRECT' },
    { code: 'BAR', label: 'Bar Counter', serviceModel: 'DIRECT' },
    { code: 'SHISHA', label: 'Shisha Counter', serviceModel: 'PREP' },
    { code: 'KITCHEN', label: 'Kitchen Counter', serviceModel: 'PREP' },
  ]
  // Mikocheni's real physical layout: one circular Main Bar (bar lady serves
  // seated customers directly, no separate "Main" counter) + three prep
  // stations. Reuses the MAIN code for the merged bar counter so existing
  // order history tagged 'MAIN' stays meaningful; BAR is deactivated below
  // rather than deleted, so its own history is untouched too.
  const MIKOCHENI_COUNTERS = [
    { code: 'MAIN', label: 'Main Bar', serviceModel: 'DIRECT' },
    { code: 'VIP', label: 'VIP Counter', serviceModel: 'PREP' },
    { code: 'SHISHA', label: 'Shisha Counter', serviceModel: 'PREP' },
    { code: 'KITCHEN', label: 'Kitchen Counter', serviceModel: 'PREP' },
  ]
  // Coco Beach's real layout: one Drinks Counter (three bar ladies, no
  // separate VIP station) + Kitchen + Shisha, both fed by bar ladies AND
  // outside staff. Also merges MAIN+BAR like Mikocheni — see below.
  const COCO_BEACH_COUNTERS = [
    { code: 'MAIN', label: 'Drinks Counter', serviceModel: 'DIRECT' },
    { code: 'SHISHA', label: 'Shisha Counter', serviceModel: 'PREP' },
    { code: 'KITCHEN', label: 'Kitchen Counter', serviceModel: 'PREP' },
  ]
  const OUTLET_COUNTERS: Record<string, typeof DEFAULT_COUNTERS> = {
    'Mikocheni Outlet': MIKOCHENI_COUNTERS,
    'Coco Beach Outlet': COCO_BEACH_COUNTERS,
  }
  // Outlets with a merged MAIN+BAR layout — BAR is deactivated (not
  // deleted) so its order history stays intact and queryable.
  const MERGES_BAR_INTO_MAIN = new Set(['Mikocheni Outlet', 'Coco Beach Outlet'])

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
    const COUNTERS = OUTLET_COUNTERS[outlet.name] ?? DEFAULT_COUNTERS
    for (const c of COUNTERS) {
      const existing = await prisma.posCounter.findFirst({ where: { outletId: outlet.id, code: c.code } })
      if (!existing) {
        await prisma.posCounter.create({ data: { outletId: outlet.id, code: c.code, label: c.label, serviceModel: c.serviceModel } })
        countersCreated++
      } else {
        await prisma.posCounter.update({ where: { id: existing.id }, data: { label: c.label, serviceModel: c.serviceModel, isActive: true } })
      }
    }
    if (MERGES_BAR_INTO_MAIN.has(outlet.name)) {
      await prisma.posCounter.updateMany({ where: { outletId: outlet.id, code: 'BAR' }, data: { isActive: false } })
    }
  }

  const EXTRAS = ['Barafu', 'Straw', 'Lemon', 'Sugar', 'Soda', 'Water (Mixer)', 'No Ice']
  for (const name of EXTRAS) {
    await prisma.posProductExtra.upsert({ where: { name }, update: {}, create: { name } })
  }

  return NextResponse.json({ ok: true, outlets: outlets.length, tablesCreated, countersCreated })
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
