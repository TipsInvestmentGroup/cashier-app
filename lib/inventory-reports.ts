// Shared query helpers for the Inventory section of the MyPOS Reports
// module (app/pos/reports/page.tsx and app/api/inventory/reports/*).
// Mirrors lib/pos-reports.ts's conventions: parsed filters, roundMoney on
// every numeric, rows pre-sorted by relevance. Each report queries its
// table directly rather than a shared aggregation query — unlike sales
// (one PosOrderItem dataset pivoted many ways), the inventory tables
// (PurchaseOrder, Grn, StockTransfer, StockCountItem, Breakage) are
// structurally distinct, so there's no single flexible query to share.
import { prisma } from './prisma'
import { roundMoney } from './utils'

export interface InventoryFilters {
  startDate?: string
  endDate?: string
  outletId?: string
  counterCode?: string
  warehouseId?: string
}

/** Parses the common filter query params shared by every /api/inventory/reports/* route. */
export function parseInventoryFilters(params: URLSearchParams): InventoryFilters {
  const f: InventoryFilters = {}
  const str = (k: string) => { const v = params.get(k); if (v) (f as Record<string, string>)[k] = v }
  str('startDate'); str('endDate'); str('outletId'); str('counterCode'); str('warehouseId')
  return f
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Where = Record<string, any>

function dateWhere(f: InventoryFilters, field = 'createdAt'): Where {
  if (!f.startDate && !f.endDate) return {}
  const where: Where = {}
  if (f.startDate) where.gte = new Date(f.startDate)
  if (f.endDate) where.lte = new Date(f.endDate)
  return { [field]: where }
}

function locationLabel(row: { outletId?: string | null; counterCode?: string | null; warehouseId?: string | null; outlet?: { name: string } | null; warehouse?: { name: string } | null }): string {
  if (row.warehouseId) return row.warehouse?.name ?? 'Main Store'
  if (row.outletId) return `${row.outlet?.name ?? row.outletId} / ${row.counterCode}`
  return '—'
}

export interface StockValuationRow { id: string; productName: string; location: string; quantity: number; unitCost: number; value: number }

/** One row per StockLevel — current stock value at every location. */
export async function getStockValuation(f: InventoryFilters): Promise<StockValuationRow[]> {
  const levels = await prisma.stockLevel.findMany({
    where: {
      ...(f.outletId ? { outletId: f.outletId } : {}),
      ...(f.counterCode ? { counterCode: f.counterCode } : {}),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    },
    include: { product: { select: { name: true, buyingPrice: true } }, outlet: { select: { name: true } }, warehouse: { select: { name: true } } },
  })

  return levels
    .map((l) => ({
      id: l.id, productName: l.product.name, location: locationLabel(l),
      quantity: l.quantity, unitCost: l.product.buyingPrice, value: roundMoney(l.quantity * l.product.buyingPrice),
    }))
    .sort((a, b) => b.value - a.value)
}

export interface PurchaseOrderRow { id: string; poNumber: string; supplierName: string; status: string; total: number; createdAt: Date }

export async function getPurchaseOrderReport(f: InventoryFilters): Promise<PurchaseOrderRow[]> {
  const orders = await prisma.purchaseOrder.findMany({
    where: dateWhere(f),
    include: { supplier: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return orders.map((o) => ({ id: o.id, poNumber: o.poNumber, supplierName: o.supplier.name, status: o.status, total: roundMoney(o.total), createdAt: o.createdAt }))
}

export interface GrnRow { id: string; grnNumber: string; supplierName: string; itemCount: number; totalPieces: number; receivedDate: Date }

export async function getGrnReport(f: InventoryFilters): Promise<GrnRow[]> {
  const grns = await prisma.grn.findMany({
    where: dateWhere(f, 'receivedDate'),
    include: { items: { select: { piecesReceived: true } } },
    orderBy: { receivedDate: 'desc' },
    take: 500,
  })
  return grns.map((g) => ({
    id: g.id, grnNumber: g.grnNumber, supplierName: g.supplierName, itemCount: g.items.length,
    totalPieces: roundMoney(g.items.reduce((s, i) => s + i.piecesReceived, 0)), receivedDate: g.receivedDate,
  }))
}

export interface TransferRow { id: string; transferNumber: string; destination: string; itemCount: number; totalQuantity: number; createdAt: Date }

export async function getTransferReport(f: InventoryFilters): Promise<TransferRow[]> {
  const transfers = await prisma.stockTransfer.findMany({
    where: {
      ...dateWhere(f),
      ...(f.outletId ? { outletId: f.outletId } : {}),
      ...(f.counterCode ? { counterCode: f.counterCode } : {}),
    },
    include: { items: { select: { quantity: true } }, outlet: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return transfers.map((t) => ({
    id: t.id, transferNumber: t.transferNumber, destination: `${t.outlet.name} / ${t.counterCode}`,
    itemCount: t.items.length, totalQuantity: roundMoney(t.items.reduce((s, i) => s + i.quantity, 0)), createdAt: t.createdAt,
  }))
}

export interface StockLossRow { id: string; source: 'STOCK_COUNT' | 'BREAKAGE'; productName: string; location: string; quantity: number; valueLost: number; date: Date; reason: string }

/** Merges the loss portion of StockCountItem (varianceValue < 0, both
 *  scopes) with Breakage rows into one unified, value-sorted list. */
export async function getStockLossReport(f: InventoryFilters): Promise<StockLossRow[]> {
  const countItems = await prisma.stockCountItem.findMany({
    where: {
      varianceValue: { lt: 0 },
      session: {
        status: 'SUBMITTED',
        ...dateWhere(f, 'countDate'),
        ...(f.outletId ? { outletId: f.outletId } : {}),
        ...(f.counterCode ? { counterCode: f.counterCode } : {}),
        ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      },
    },
  })
  // Fetch the sessions separately (need outlet/warehouse names for the location label).
  const sessionIds = [...new Set(countItems.map((i) => i.sessionId))]
  const sessions = await prisma.stockCountSession.findMany({
    where: { id: { in: sessionIds } },
  })
  const sessionMap = new Map(sessions.map((s) => [s.id, s]))

  const outletIds = [...new Set(sessions.map((s) => s.outletId).filter((v): v is string => !!v))]
  const warehouseIds = [...new Set(sessions.map((s) => s.warehouseId).filter((v): v is string => !!v))]
  const [outlets, warehouses] = await Promise.all([
    prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } }),
    prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
  ])
  const outletNameMap = new Map(outlets.map((o) => [o.id, o.name]))
  const warehouseNameMap = new Map(warehouses.map((w) => [w.id, w.name]))

  const countRows: StockLossRow[] = countItems.map((i) => {
    const session = sessionMap.get(i.sessionId)!
    // Net out discount/breakage the same way valueLost already does
    // (varianceValue = (varianceQty − discountQty − breakageQty) * unitCost)
    // — showing the raw varianceQty here would make quantity and valueLost
    // silently disagree on any line where either adjustment is non-zero.
    const netQty = i.varianceQty - i.discountQty - i.breakageQty
    return {
      id: i.id, source: 'STOCK_COUNT', productName: i.productName,
      location: session.warehouseId ? (warehouseNameMap.get(session.warehouseId) ?? 'Main Store') : `${outletNameMap.get(session.outletId!) ?? session.outletId} / ${session.counterCode}`,
      quantity: roundMoney(Math.abs(netQty)), valueLost: roundMoney(-i.varianceValue), date: session.countDate, reason: 'Stock count variance',
    }
  })

  // No `take` cap here — this list feeds the same totals the Inventory
  // Dashboard sums with no cap of its own; capping one but not the other
  // would make the two screens silently disagree once a date range holds
  // more than the cap's worth of rows.
  const breakages = await prisma.breakage.findMany({
    where: {
      ...dateWhere(f),
      ...(f.outletId ? { outletId: f.outletId } : {}),
      ...(f.counterCode ? { counterCode: f.counterCode } : {}),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
  const breakageOutletIds = [...new Set(breakages.map((b) => b.outletId).filter((v): v is string => !!v))]
  const breakageWarehouseIds = [...new Set(breakages.map((b) => b.warehouseId).filter((v): v is string => !!v))]
  const [bOutlets, bWarehouses] = await Promise.all([
    prisma.outlet.findMany({ where: { id: { in: breakageOutletIds } }, select: { id: true, name: true } }),
    prisma.warehouse.findMany({ where: { id: { in: breakageWarehouseIds } }, select: { id: true, name: true } }),
  ])
  const bOutletNameMap = new Map(bOutlets.map((o) => [o.id, o.name]))
  const bWarehouseNameMap = new Map(bWarehouses.map((w) => [w.id, w.name]))

  const breakageRows: StockLossRow[] = breakages.map((b) => ({
    id: b.id, source: 'BREAKAGE', productName: b.productName,
    location: b.warehouseId ? (bWarehouseNameMap.get(b.warehouseId) ?? 'Main Store') : `${bOutletNameMap.get(b.outletId!) ?? b.outletId} / ${b.counterCode}`,
    quantity: b.quantity, valueLost: roundMoney(b.valueLost), date: b.createdAt, reason: b.reason,
  }))

  return [...countRows, ...breakageRows].sort((a, b) => b.valueLost - a.valueLost)
}

export interface StaffLossRow { staffId: string; staffName: string; totalAmount: number; count: number }

export async function getStaffLossReport(f: InventoryFilters): Promise<StaffLossRow[]> {
  const attributions = await prisma.stockLossAttribution.findMany({ where: dateWhere(f) })
  const byStaff = new Map<string, StaffLossRow>()
  for (const a of attributions) {
    const existing = byStaff.get(a.staffId)
    if (existing) { existing.totalAmount = roundMoney(existing.totalAmount + a.amount); existing.count += 1 }
    else byStaff.set(a.staffId, { staffId: a.staffId, staffName: a.staffName, totalAmount: roundMoney(a.amount), count: 1 })
  }
  return [...byStaff.values()].sort((a, b) => b.totalAmount - a.totalAmount)
}

export interface MovementLedgerRow { id: string; date: Date; type: string; productName: string; location: string; quantity: number; balanceAfter: number; note: string | null }

export async function getMovementLedger(f: InventoryFilters): Promise<MovementLedgerRow[]> {
  const entries = await prisma.stockLedgerEntry.findMany({
    where: {
      ...dateWhere(f),
      ...(f.outletId ? { outletId: f.outletId } : {}),
      ...(f.counterCode ? { counterCode: f.counterCode } : {}),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    },
    include: { warehouse: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  const outletIds = [...new Set(entries.map((e) => e.outletId).filter((v): v is string => !!v))]
  const outlets = await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
  const outletNameMap = new Map(outlets.map((o) => [o.id, o.name]))

  return entries.map((e) => ({
    id: e.id, date: e.createdAt, type: e.type, productName: e.productName,
    location: locationLabel({ ...e, outlet: e.outletId ? { name: outletNameMap.get(e.outletId) ?? e.outletId } : null }),
    quantity: e.quantity, balanceAfter: roundMoney(e.balanceAfter), note: e.note,
  }))
}

export interface InventoryDashboard {
  totalStockValue: number
  totalLossThisPeriod: number
  pendingApprovals: number
  openStockCounts: number
  grnCount: number
  transferCount: number
}

export async function getInventoryDashboard(f: InventoryFilters): Promise<InventoryDashboard> {
  const [levels, lossItems, breakages, pendingApprovals, openStockCounts, grnCount, transferCount] = await Promise.all([
    // Honor the same location filters getStockValuation does — otherwise
    // selecting an outlet in the filter bar silently has no effect on this
    // card while the Stock Valuation tab right next to it does respect it,
    // and the two numbers stop reconciling.
    prisma.stockLevel.findMany({
      where: {
        ...(f.outletId ? { outletId: f.outletId } : {}),
        ...(f.counterCode ? { counterCode: f.counterCode } : {}),
        ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      },
      include: { product: { select: { buyingPrice: true } } },
    }),
    prisma.stockCountItem.findMany({
      where: {
        varianceValue: { lt: 0 },
        session: {
          status: 'SUBMITTED', ...dateWhere(f, 'countDate'),
          ...(f.outletId ? { outletId: f.outletId } : {}),
          ...(f.counterCode ? { counterCode: f.counterCode } : {}),
          ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
        },
      },
      select: { varianceValue: true },
    }),
    prisma.breakage.findMany({
      where: {
        ...dateWhere(f),
        ...(f.outletId ? { outletId: f.outletId } : {}),
        ...(f.counterCode ? { counterCode: f.counterCode } : {}),
        ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      },
      select: { valueLost: true },
    }),
    prisma.purchaseOrder.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.stockCountSession.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.grn.count({ where: dateWhere(f, 'receivedDate') }),
    prisma.stockTransfer.count({ where: dateWhere(f) }),
  ])

  const totalStockValue = roundMoney(levels.reduce((s, l) => s + l.quantity * l.product.buyingPrice, 0))
  const totalLossThisPeriod = roundMoney(
    lossItems.reduce((s, i) => s + -i.varianceValue, 0) + breakages.reduce((s, b) => s + b.valueLost, 0)
  )

  return { totalStockValue, totalLossThisPeriod, pendingApprovals, openStockCounts, grnCount, transferCount }
}
