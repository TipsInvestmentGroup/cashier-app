import { roundMoney } from './utils'
import { computeLossComponents } from './staff-loss'
import { loadActiveTargets } from './sales-targets'
import { targetDeptKey } from './targets'

// Loose type — works with both the prisma singleton and a transaction client,
// and avoids depending on generated Prisma types (regenerated on deploy).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

// The validate route (app/api/transaction-sessions/[id]/validate/route.ts)
// stamps this exact note on every DailyCollection it flattens a Transaction
// Session into — the only signal in the data (short of adding a column) that
// distinguishes which Collection Mode produced a given collection. Reusing it
// keeps this sync function reading only DailyCollection + its relations,
// never special-casing collection mode at the call site (see schema.prisma's
// BusinessSession comment).
const TX_SESSION_NOTE = /^Validated from Transaction Session (\S+)/

/**
 * Upsert the standardized BusinessSession row for one finalized
 * DailyCollection — the single source dashboards/reports should read
 * aggregate figures from instead of re-deriving them per-route. Safe to call
 * repeatedly (idempotent upsert); call after any DailyCollection
 * create/update that can change its money fields or cancellations.
 */
export async function syncBusinessSession(db: DB, collectionId: string): Promise<void> {
  const c = await db.dailyCollection.findUnique({
    where: { id: collectionId },
    include: { cancellations: true, outlet: { select: { id: true, companyId: true } } },
  })
  if (!c) return
  // A DailyCollection with no staffName is rare (schema allows it) but still
  // a completed session — fall back to the same "Unassigned" bucket the
  // Staff Scorecard already uses, rather than silently dropping it from the
  // BI layer (see app/api/reports/staff-scorecard/route.ts).
  const staffName = c.staffName || 'Unassigned'

  const txMatch = TX_SESSION_NOTE.exec(c.notes || '')
  const collectionMode = txMatch ? 'TRANSACTION_VERIFICATION' : 'DEFAULT'
  const sourceSessionId = txMatch ? txMatch[1] : null

  const { approvedCancel, shortfall } = computeLossComponents(c)

  const staff = await db.user.findFirst({ where: { name: staffName }, select: { id: true } })

  let transactionCount = 0
  let avgTransactionValue = 0
  if (sourceSessionId && staff) {
    transactionCount = await db.staffTransaction.count({
      where: { sessionId: sourceSessionId, staffId: staff.id, category: 'PAYMENT', status: 'APPROVED' },
    })
    if (transactionCount > 0) avgTransactionValue = roundMoney(c.total / transactionCount)
  }

  const salesTarget = await resolveDailySalesTarget(c.outletId)

  await db.businessSession.upsert({
    where: { outletId_date_staffName: { outletId: c.outletId, date: c.date, staffName } },
    create: {
      date: c.date,
      companyId: c.outlet?.companyId ?? null,
      outletId: c.outletId,
      staffId: staff?.id ?? null,
      staffName,
      collectionMode,
      sourceCollectionId: c.id,
      sourceSessionId,
      systemSales: c.systemSales || 0,
      officialCollection: c.total,
      cash: c.cash || 0,
      bank: roundMoney((c.crdb || 0) + (c.stanbic || 0)),
      mobileMoney: c.mpesa || 0,
      signedBillsTotal: c.creditSales || 0,
      paidBillsTotal: c.paymentsReceived || 0,
      discounts: c.discount || 0,
      cancellations: approvedCancel,
      collectionDifference: roundMoney(c.total - (c.systemSales || 0)),
      dailyLoss: shortfall,
      transactionCount,
      avgTransactionValue,
      salesTarget,
    },
    update: {
      companyId: c.outlet?.companyId ?? null,
      staffId: staff?.id ?? null,
      collectionMode,
      sourceCollectionId: c.id,
      sourceSessionId,
      systemSales: c.systemSales || 0,
      officialCollection: c.total,
      cash: c.cash || 0,
      bank: roundMoney((c.crdb || 0) + (c.stanbic || 0)),
      mobileMoney: c.mpesa || 0,
      signedBillsTotal: c.creditSales || 0,
      paidBillsTotal: c.paymentsReceived || 0,
      discounts: c.discount || 0,
      cancellations: approvedCancel,
      collectionDifference: roundMoney(c.total - (c.systemSales || 0)),
      dailyLoss: shortfall,
      transactionCount,
      avgTransactionValue,
      salesTarget,
    },
  })
}

/** Best-effort daily "Total Collection" target for the outlet (Per Staff scope). */
async function resolveDailySalesTarget(outletId: string): Promise<number | null> {
  const targets = await loadActiveTargets()
  const match = targets.find((t) => t.outletId === outletId && t.scope === 'Per Staff' && targetDeptKey(t.department) === 'collection')
  if (!match) return null
  return roundMoney(match.weeklyTarget / 7)
}
