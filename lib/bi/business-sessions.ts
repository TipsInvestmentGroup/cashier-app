import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

export interface DateRange { gte: Date; lte: Date }

export interface BusinessSessionFilter {
  outletId?: string | null
  companyId?: string | null
  staffName?: string | null
  staffId?: string | null
  dateRange?: DateRange
}

export interface SessionTotals {
  count: number
  systemSales: number
  officialCollection: number
  cash: number
  bank: number
  mobileMoney: number
  signedBillsTotal: number
  paidBillsTotal: number
  discounts: number
  cancellations: number
  dailyLoss: number
  transactionCount: number
}

function whereFrom(f: BusinessSessionFilter) {
  return {
    ...(f.outletId ? { outletId: f.outletId } : {}),
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.staffName ? { staffName: f.staffName } : {}),
    ...(f.staffId ? { staffId: f.staffId } : {}),
    ...(f.dateRange ? { date: f.dateRange } : {}),
  }
}

/**
 * The BI layer's read path — dashboards/reports fetch already-standardized
 * BusinessSession rows here instead of re-aggregating DailyCollection (and
 * its Cancellation/SignedBill/PaidBill relations) per-route. Written by
 * lib/business-session.ts's syncBusinessSession(), one row per staff/outlet/
 * day regardless of Collection Mode.
 */
export async function getSessionsForRange(filter: BusinessSessionFilter) {
  const db = prisma as unknown as { businessSession: { findMany: (args: unknown) => Promise<unknown[]> } }
  return db.businessSession.findMany({
    where: whereFrom(filter),
    orderBy: { date: 'asc' },
  })
}

/** Aggregate totals across a date range/outlet — the shape most dashboard stat cards need. */
export async function getSessionTotals(filter: BusinessSessionFilter): Promise<SessionTotals> {
  const db = prisma as unknown as {
    businessSession: {
      aggregate: (args: unknown) => Promise<{
        _count: number
        _sum: Record<string, number | null>
      }>
    }
  }
  const agg = await db.businessSession.aggregate({
    where: whereFrom(filter),
    _count: true,
    _sum: {
      systemSales: true, officialCollection: true, cash: true, bank: true, mobileMoney: true,
      signedBillsTotal: true, paidBillsTotal: true, discounts: true, cancellations: true,
      dailyLoss: true, transactionCount: true,
    },
  })
  const s = agg._sum
  return {
    count: agg._count,
    systemSales: roundMoney(s.systemSales || 0),
    officialCollection: roundMoney(s.officialCollection || 0),
    cash: roundMoney(s.cash || 0),
    bank: roundMoney(s.bank || 0),
    mobileMoney: roundMoney(s.mobileMoney || 0),
    signedBillsTotal: roundMoney(s.signedBillsTotal || 0),
    paidBillsTotal: roundMoney(s.paidBillsTotal || 0),
    discounts: roundMoney(s.discounts || 0),
    cancellations: roundMoney(s.cancellations || 0),
    dailyLoss: roundMoney(s.dailyLoss || 0),
    transactionCount: s.transactionCount || 0,
  }
}

export interface StaffTotals {
  staffName: string
  days: number
  officialCollection: number
  systemSales: number
  signedBillsTotal: number
  paidBillsTotal: number
  discounts: number
  cancellations: number
  dailyLoss: number
  transactionCount: number
}

/** Per-staff totals within a range — powers staff-comparison / scorecard-style views. */
export async function getSessionsByStaff(filter: BusinessSessionFilter): Promise<StaffTotals[]> {
  const db = prisma as unknown as {
    businessSession: {
      groupBy: (args: unknown) => Promise<Array<{
        staffName: string
        _count: number
        _sum: Record<string, number | null>
      }>>
    }
  }
  const rows = await db.businessSession.groupBy({
    by: ['staffName'],
    where: whereFrom(filter),
    _count: true,
    _sum: {
      officialCollection: true, systemSales: true, signedBillsTotal: true, paidBillsTotal: true,
      discounts: true, cancellations: true, dailyLoss: true, transactionCount: true,
    },
  })
  return rows.map((r) => ({
    staffName: r.staffName,
    days: r._count,
    officialCollection: roundMoney(r._sum.officialCollection || 0),
    systemSales: roundMoney(r._sum.systemSales || 0),
    signedBillsTotal: roundMoney(r._sum.signedBillsTotal || 0),
    paidBillsTotal: roundMoney(r._sum.paidBillsTotal || 0),
    discounts: roundMoney(r._sum.discounts || 0),
    cancellations: roundMoney(r._sum.cancellations || 0),
    dailyLoss: roundMoney(r._sum.dailyLoss || 0),
    transactionCount: r._sum.transactionCount || 0,
  }))
}

export interface OutletTotals {
  outletId: string
  count: number
  officialCollection: number
  systemSales: number
  cancellations: number
  dailyLoss: number
}

/** Per-outlet totals within a range — powers outlet-comparison-style views. */
export async function getSessionTotalsByOutlet(filter: BusinessSessionFilter): Promise<OutletTotals[]> {
  const db = prisma as unknown as {
    businessSession: {
      groupBy: (args: unknown) => Promise<Array<{
        outletId: string
        _count: number
        _sum: Record<string, number | null>
      }>>
    }
  }
  const rows = await db.businessSession.groupBy({
    by: ['outletId'],
    where: whereFrom(filter),
    _count: true,
    _sum: { officialCollection: true, systemSales: true, cancellations: true, dailyLoss: true },
  })
  return rows.map((r) => ({
    outletId: r.outletId,
    count: r._count,
    officialCollection: roundMoney(r._sum.officialCollection || 0),
    systemSales: roundMoney(r._sum.systemSales || 0),
    cancellations: roundMoney(r._sum.cancellations || 0),
    dailyLoss: roundMoney(r._sum.dailyLoss || 0),
  }))
}
