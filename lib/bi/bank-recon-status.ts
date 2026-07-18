import { prisma } from '@/lib/prisma'

export interface DateRange { gte: Date; lte: Date }
export interface OutletReconCount { outletId: string; outletName: string; count: number }
export interface UnreconciledBankCounts { total: number; byOutlet: OutletReconCount[] }

/**
 * Count of BankRecon rows not yet verified by an officer (verifiedAmount ===
 * null — the same "unreconciled" signal app/api/reports/bank-recon/route.ts
 * already uses), grouped by outlet, for a date range.
 */
export async function getUnreconciledBankCounts({ outletId, dateRange }: { outletId?: string | null; dateRange: DateRange }): Promise<UnreconciledBankCounts> {
  const db = prisma as unknown as {
    bankRecon: {
      groupBy: (args: unknown) => Promise<Array<{ outletId: string | null; _count: number }>>
    }
  }
  const rows = await db.bankRecon.groupBy({
    by: ['outletId'],
    where: {
      verifiedAmount: null,
      date: dateRange,
      ...(outletId ? { outletId } : {}),
    },
    _count: true,
  })

  const outletIds = rows.map((r) => r.outletId).filter((id): id is string => !!id)
  const outlets = outletIds.length ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } }) : []
  const nameById = new Map(outlets.map((o) => [o.id, o.name]))

  const byOutlet = rows
    .filter((r): r is { outletId: string; _count: number } => !!r.outletId)
    .map((r) => ({ outletId: r.outletId, outletName: nameById.get(r.outletId) || 'Unknown', count: r._count }))
    .sort((a, b) => b.count - a.count)

  return { total: byOutlet.reduce((s, r) => s + r.count, 0), byOutlet }
}
