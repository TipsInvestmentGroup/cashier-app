import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { isOwner } from '@/lib/rbac'
import { recomputeStaffLoss } from '@/lib/staff-loss'

/**
 * One-time/on-demand backfill: runs the same self-healing recompute used after
 * editing a collection or approving a cancellation across EVERY collection.
 * Needed because the CollectionExcess ledger (and its required-reason rule)
 * only started existing partway through this app's life — any collection
 * created before that shipped can have a real computed overage with no
 * backing ledger row, since nothing ever triggered the recompute for it.
 * Owner-only: this can create backdated excess/loss records at scale.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can run a full reconcile' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const startDate = body.startDate ? new Date(body.startDate) : null
  const endDate = body.endDate ? new Date(body.endDate) : null
  const where = startDate && endDate ? { date: { gte: startDate, lte: endDate } } : {}

  const collections = await prisma.dailyCollection.findMany({ where, select: { id: true } })

  const before = await prisma.collectionExcess.count()
  let scanned = 0
  let failed = 0
  for (const c of collections) {
    try {
      await recomputeStaffLoss(prisma, c.id)
      scanned++
    } catch {
      failed++
    }
  }
  const after = await prisma.collectionExcess.count()

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'CollectionExcess', entityId: null, details: `Reconciled ${scanned} collection(s), ${failed} failed, excess records ${before} → ${after}` },
  })

  return NextResponse.json({ scanned, failed, excessRecordsBefore: before, excessRecordsAfter: after, created: after - before })
}
