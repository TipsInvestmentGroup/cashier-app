import { prisma } from '@/lib/prisma'

export interface OutletApprovalCount { outletId: string; outletName: string; count: number }
export interface PendingApprovalCounts { total: number; byOutlet: OutletApprovalCount[] }

/**
 * Pending WorkflowApproval count, overall and per outlet. WorkflowApproval has
 * no outletId column of its own (outlet is only reachable via the stage
 * record's Collection Session or the transaction's Transaction Session), so
 * this groups in JS rather than a Prisma groupBy on a nested relation field —
 * same convention as the hour-bucketing helpers elsewhere in lib/bi and
 * lib/staff-analytics.ts (JS-side aggregation for SQLite/Postgres parity).
 */
export async function getPendingApprovalCounts({ outletId }: { outletId?: string | null } = {}): Promise<PendingApprovalCounts> {
  const db = prisma as unknown as {
    workflowApproval: {
      findMany: (args: unknown) => Promise<Array<{
        stageRecord: { session: { outletId: string; outlet: { name: string } } } | null
        transaction: { session: { outletId: string; outlet: { name: string } } } | null
      }>>
    }
  }
  const rows = await db.workflowApproval.findMany({
    where: { status: 'PENDING' },
    select: {
      stageRecord: { select: { session: { select: { outletId: true, outlet: { select: { name: true } } } } } },
      transaction: { select: { session: { select: { outletId: true, outlet: { select: { name: true } } } } } },
    },
  })

  const byOutlet = new Map<string, OutletApprovalCount>()
  for (const r of rows) {
    const session = r.stageRecord?.session || r.transaction?.session
    if (!session) continue
    if (outletId && session.outletId !== outletId) continue
    const cur = byOutlet.get(session.outletId) || { outletId: session.outletId, outletName: session.outlet.name, count: 0 }
    cur.count += 1
    byOutlet.set(session.outletId, cur)
  }

  const list = Array.from(byOutlet.values()).sort((a, b) => b.count - a.count)
  return { total: list.reduce((s, r) => s + r.count, 0), byOutlet: list }
}
