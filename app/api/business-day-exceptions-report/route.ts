import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'

/** GET — Business Day Exceptions Report: every day that was ever reopened,
 *  with its unlock history and a count of records touched after the reopen. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAY_AUDIT_LOG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  const status = searchParams.get('status')
  const userId = searchParams.get('userId')
  const reason = searchParams.get('reason')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (outletId === NO_OUTLET) return NextResponse.json({ exceptions: [], reasons: [] })

  const where: Record<string, unknown> = { reopenedAt: { not: null } }
  if (outletId) where.outletId = outletId
  if (status) where.status = status
  if (userId) where.OR = [{ closedById: userId }, { reopenedById: userId }]
  if (reason) where.reopenReason = { contains: reason }
  if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }

  const days = await prisma.businessDay.findMany({
    where,
    include: {
      outlet: { select: { name: true } },
      unlockRequests: { include: { requestedBy: { select: { name: true } }, approver: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      auditLogs: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { date: 'desc' },
    take: 300,
  })

  const exceptions = await Promise.all(
    days.map(async (bd) => {
      const since = bd.reopenedAt as Date
      const range = { gte: bd.date, lte: new Date(bd.date.getTime() + 86400000 - 1) }
      const [collectionsCorrected, cashReconCorrected, bankReconCorrected] = await Promise.all([
        prisma.dailyCollection.count({ where: { outletId: bd.outletId, date: range, updatedAt: { gte: since } } }),
        prisma.cashRecon.count({ where: { outletId: bd.outletId, date: range, createdAt: { gte: since } } }),
        prisma.bankRecon.count({ where: { outletId: bd.outletId, date: range, createdAt: { gte: since } } }),
      ])
      return {
        id: bd.id,
        date: bd.date,
        outlet: bd.outlet.name,
        status: bd.status,
        reopenedByName: bd.reopenedByName,
        reopenReason: bd.reopenReason,
        reopenedAt: bd.reopenedAt,
        closedByName: bd.closedByName,
        unlockHistory: bd.unlockRequests,
        correctedRecords: {
          collections: collectionsCorrected,
          cashRecon: cashReconCorrected,
          bankRecon: bankReconCorrected,
        },
        auditLogs: bd.auditLogs,
      }
    })
  )

  const reasonRows = await prisma.businessDay.findMany({
    where: { reopenReason: { not: null } },
    distinct: ['reopenReason'],
    select: { reopenReason: true },
    take: 100,
  })

  return NextResponse.json({ exceptions, reasons: reasonRows.map((r) => r.reopenReason).filter(Boolean) })
}
