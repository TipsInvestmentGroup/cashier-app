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
  //
  // The PosCounter rows in the database ARE each outlet's layout — this
  // endpoint only bootstraps a generic starter set for an outlet that has no
  // counters yet, and never modifies existing counters. (It previously keyed
  // per-outlet layouts on literal outlet names, which silently broke for any
  // renamed or new outlet.) Adjust a layout afterwards via PUT/POST on
  // /api/pos/counters — e.g. relabel MAIN, deactivate BAR to merge it into
  // MAIN, or add a VIP prep station.
  const DEFAULT_COUNTERS = [
    { code: 'MAIN', label: 'Main Counter', serviceModel: 'DIRECT' },
    { code: 'BAR', label: 'Bar Counter', serviceModel: 'DIRECT' },
    { code: 'SHISHA', label: 'Shisha Counter', serviceModel: 'PREP' },
    { code: 'KITCHEN', label: 'Kitchen Counter', serviceModel: 'PREP' },
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
    const existingCount = await prisma.posCounter.count({ where: { outletId: outlet.id } })
    if (existingCount === 0) {
      for (const c of DEFAULT_COUNTERS) {
        await prisma.posCounter.create({ data: { outletId: outlet.id, code: c.code, label: c.label, serviceModel: c.serviceModel } })
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

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
