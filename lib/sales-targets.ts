import { prisma } from '@/lib/prisma'
import type { TargetDef, TargetUnit } from '@/lib/targets'

// Prisma client types for SalesTarget are generated on deploy; assert to
// avoid local type drift (same pattern as other new models in this codebase).
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * One-time seed: the previous hard-coded TARGETS array from lib/targets.ts,
 * mapped onto real Outlet rows by name fragment. Runs only when the table is
 * empty — after that, targets are managed entirely from the /targets screen.
 * Same seed-on-first-read pattern as /api/payment-channels' DEFAULTS.
 */
const SEED_DEFAULTS: { outletMatch: string; scope: string; department: string; unit: TargetUnit; unitLabel?: string; weeklyTarget: number }[] = [
  { outletMatch: 'mikocheni', scope: 'Per Staff', department: 'Total Collection', unit: 'TZS', weeklyTarget: 12_000_000 },
  { outletMatch: 'mikocheni', scope: 'Per Staff', department: 'Shisha Sales', unit: 'COUNT', unitLabel: 'shisha', weeklyTarget: 15 },
  { outletMatch: 'mikocheni', scope: 'Per Outlet', department: 'Total Collection', unit: 'TZS', weeklyTarget: 125_000_000 },
  { outletMatch: 'mikocheni', scope: 'Per Outlet', department: 'Shisha Sales', unit: 'COUNT', unitLabel: 'shisha', weeklyTarget: 150 },
  { outletMatch: 'coco', scope: 'Per Staff', department: 'Total Collection', unit: 'TZS', weeklyTarget: 10_000_000 },
  { outletMatch: 'coco', scope: 'Per Staff', department: 'Food Sales', unit: 'TZS', weeklyTarget: 500_000 },
  { outletMatch: 'coco', scope: 'Per Manager', department: 'Total Collection', unit: 'TZS', weeklyTarget: 100_000_000 },
  { outletMatch: 'coco', scope: 'Per Outlet', department: 'Food Sales', unit: 'TZS', weeklyTarget: 5_000_000 },
]

async function seedIfEmpty(): Promise<void> {
  const count = await db.salesTarget.count()
  if (count > 0) return
  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } })
  let sortOrder = 0
  for (const s of SEED_DEFAULTS) {
    const outlet = outlets.find((o) => o.name.toLowerCase().includes(s.outletMatch))
    if (!outlet) continue
    await db.salesTarget.create({
      data: {
        outletId: outlet.id, scope: s.scope, department: s.department,
        unit: s.unit, unitLabel: s.unitLabel || null, weeklyTarget: s.weeklyTarget, sortOrder: sortOrder++,
      },
    })
  }
}

/** All active targets with their outlet names, seeding defaults on first use. */
export async function loadActiveTargets(): Promise<TargetDef[]> {
  await seedIfEmpty()
  const rows = await db.salesTarget.findMany({
    where: { isActive: true },
    include: { outlet: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map((r: { id: string; outletId: string; outlet: { name: string }; scope: string; department: string; unit: string; unitLabel: string | null; weeklyTarget: number }) => ({
    id: r.id, outletId: r.outletId, outletName: r.outlet.name,
    scope: r.scope, department: r.department, unit: r.unit as TargetUnit,
    unitLabel: r.unitLabel, weeklyTarget: r.weeklyTarget,
  }))
}
