// Shared query + aggregation helpers for the MyPOS Reports module
// (app/pos/reports/page.tsx and app/api/pos/reports/*). Most of the 16
// report types are different group-by pivots over the same underlying
// PosOrder/PosOrderItem dataset — one flexible query + in-memory aggregation
// serves all of them rather than 9+ near-duplicate Prisma queries. Data
// volume for a single-venue POS is modest (thousands, not millions, of rows
// per month), so aggregating in JS after one filtered fetch is simpler and
// more portable across SQLite (dev) / Postgres (prod) than relying on
// provider-specific groupBy-across-relations SQL.
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { startOfWeek, startOfMonth, format } from 'date-fns'

export interface SalesFilters {
  startDate?: string // ISO date, inclusive
  endDate?: string   // ISO date, inclusive
  outletId?: string
  shiftId?: string
  staffId?: string   // PosOrder.waiterId
  counterCode?: string
  productId?: string
  category?: string
  paymentMethod?: string
  includeSigned?: boolean // default true; false excludes paymentMethod = SIGNED (Staff Sales excl. signed)
}

export type GroupBy = 'staff' | 'product' | 'category' | 'counter' | 'paymentMethod' | 'hour' | 'day' | 'week' | 'month'

/** Parses the common filter query params shared by every /api/pos/reports/* route. */
export function parseFilters(params: URLSearchParams): SalesFilters {
  const f: SalesFilters = {}
  const str = (k: string) => { const v = params.get(k); if (v) (f as Record<string, string>)[k] = v }
  str('startDate'); str('endDate'); str('outletId'); str('shiftId'); str('staffId')
  str('counterCode'); str('productId'); str('category'); str('paymentMethod')
  if (params.get('includeSigned') === 'false') f.includeSigned = false
  return f
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Where = Record<string, any>

/** Order-level where clause. `statusIn` lets callers opt into a different
 *  status scope (e.g. cancelled/void reports look at CANCELLED/VOID orders,
 *  not CLOSED ones) — omit it for "any status". Date filtering uses
 *  `closedAt` for CLOSED-only scopes (when the sale was actually finalized)
 *  but falls back to `createdAt` otherwise — a CANCELLED/VOID order never
 *  gets `closedAt` set, so filtering those by it would silently exclude
 *  every row once a date range is applied. */
export function buildOrderWhere(f: SalesFilters, statusIn?: string[]): Where {
  const where: Where = {}
  if (statusIn) where.status = { in: statusIn }
  if (f.outletId) where.outletId = f.outletId
  if (f.shiftId) where.shiftId = f.shiftId
  if (f.staffId) where.waiterId = f.staffId
  if (f.paymentMethod) where.paymentMethod = f.paymentMethod
  else if (f.includeSigned === false) where.paymentMethod = { not: 'SIGNED' }
  if (f.startDate || f.endDate) {
    const dateField = statusIn && statusIn.every((s) => s === 'CLOSED') ? 'closedAt' : 'createdAt'
    where[dateField] = {}
    if (f.startDate) where[dateField].gte = new Date(f.startDate)
    if (f.endDate) where[dateField].lte = new Date(f.endDate)
  }
  return where
}

/** Item-level where clause for actual completed sales (CLOSED orders,
 *  non-cancelled items) — the basis for every sales/product/category/
 *  counter/hourly/period/top-seller pivot. */
function buildSalesItemWhere(f: SalesFilters): Where {
  const where: Where = { status: { not: 'CANCELLED' }, order: buildOrderWhere(f, ['CLOSED']) }
  if (f.counterCode) where.counterCode = f.counterCode
  if (f.productId) where.productId = f.productId
  if (f.category) where.product = { category: f.category }
  return where
}

interface SalesItemRow {
  orderId: string
  quantity: number
  amount: number
  counterCode: string | null
  productId: string
  productName: string
  product: { category: string | null }
  order: { waiterId: string; waiter: { name: string }; paymentMethod: string | null; closedAt: Date | null }
}

async function fetchSalesItems(f: SalesFilters): Promise<SalesItemRow[]> {
  return prisma.posOrderItem.findMany({
    where: buildSalesItemWhere(f),
    select: {
      orderId: true, quantity: true, amount: true, counterCode: true, productId: true, productName: true,
      product: { select: { category: true } },
      order: { select: { waiterId: true, waiter: { select: { name: true } }, paymentMethod: true, closedAt: true } },
    },
  })
}

export interface SalesAggRow { key: string; label: string; quantity: number; revenue: number; billCount: number }

/** Groups completed-sale line items by the requested dimension. `billCount`
 *  is the number of distinct orders contributing to that bucket. */
export async function aggregateSales(f: SalesFilters, groupBy: GroupBy): Promise<SalesAggRow[]> {
  const items = await fetchSalesItems(f)

  const buckets = new Map<string, { label: string; quantity: number; revenue: number; orderKeys: Set<string> }>()
  for (const it of items) {
    let key: string
    let label: string
    switch (groupBy) {
      case 'staff': key = it.order.waiterId; label = it.order.waiter.name; break
      case 'product': key = it.productId; label = it.productName; break
      case 'category': key = it.product.category ?? 'Other'; label = key; break
      case 'counter': key = it.counterCode ?? 'UNKNOWN'; label = key; break
      case 'paymentMethod': key = it.order.paymentMethod ?? 'UNKNOWN'; label = key; break
      case 'hour': { const h = it.order.closedAt ? it.order.closedAt.getHours() : 0; key = String(h).padStart(2, '0'); label = `${key}:00`; break }
      case 'day': { const d = it.order.closedAt ?? new Date(0); key = format(d, 'yyyy-MM-dd'); label = format(d, 'dd MMM yyyy'); break }
      case 'week': { const d = it.order.closedAt ? startOfWeek(it.order.closedAt, { weekStartsOn: 1 }) : new Date(0); key = format(d, 'yyyy-MM-dd'); label = `Wiki ya ${format(d, 'dd MMM yyyy')}`; break }
      case 'month': { const d = it.order.closedAt ? startOfMonth(it.order.closedAt) : new Date(0); key = format(d, 'yyyy-MM'); label = format(d, 'MMMM yyyy'); break }
    }
    if (!buckets.has(key)) buckets.set(key, { label, quantity: 0, revenue: 0, orderKeys: new Set() })
    const b = buckets.get(key)!
    b.quantity += it.quantity
    b.revenue += it.amount
    b.orderKeys.add(it.orderId)
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, quantity: roundMoney(b.quantity), revenue: roundMoney(b.revenue), billCount: b.orderKeys.size }))
    .sort((a, b) => b.revenue - a.revenue)
}

export async function getGrossSalesSummary(f: SalesFilters) {
  const orders = await prisma.posOrder.findMany({
    where: buildOrderWhere(f, ['CLOSED']),
    select: { totalAmount: true, discount: true, paymentMethod: true },
  })
  const totalSales = orders.reduce((s, o) => s + o.totalAmount, 0)
  const totalDiscount = orders.reduce((s, o) => s + o.discount, 0)
  const signedTotal = orders.filter((o) => o.paymentMethod === 'SIGNED').reduce((s, o) => s + (o.totalAmount - o.discount), 0)
  return {
    billCount: orders.length,
    totalSales: roundMoney(totalSales),
    totalDiscount: roundMoney(totalDiscount),
    signedTotal: roundMoney(signedTotal),
    netSales: roundMoney(totalSales - totalDiscount),
  }
}

export interface StaffPerformanceRow {
  key: string; label: string
  totalSales: number; billCount: number; avgBillValue: number
  quantitySold: number; signedTotal: number; voidedCount: number; discountTotal: number
}

export async function getStaffPerformance(f: SalesFilters): Promise<StaffPerformanceRow[]> {
  const [closedOrders, cancelledOrders, cancelledItems] = await Promise.all([
    prisma.posOrder.findMany({
      where: buildOrderWhere(f, ['CLOSED']),
      select: { waiterId: true, waiter: { select: { name: true } }, totalAmount: true, discount: true, paymentMethod: true },
    }),
    prisma.posOrder.findMany({
      where: buildOrderWhere(f, ['CANCELLED', 'VOID']),
      select: { waiterId: true, waiter: { select: { name: true } } },
    }),
    prisma.posOrderItem.findMany({
      where: { status: 'CANCELLED', order: buildOrderWhere(f) },
      select: { order: { select: { waiterId: true, waiter: { select: { name: true } } } } },
    }),
  ])

  const byStaff = new Map<string, StaffPerformanceRow>()
  const get = (id: string, name: string) => {
    if (!byStaff.has(id)) byStaff.set(id, { key: id, label: name, totalSales: 0, billCount: 0, avgBillValue: 0, quantitySold: 0, signedTotal: 0, voidedCount: 0, discountTotal: 0 })
    return byStaff.get(id)!
  }
  for (const o of closedOrders) {
    const row = get(o.waiterId, o.waiter.name)
    row.totalSales += o.totalAmount
    row.billCount += 1
    row.discountTotal += o.discount
    if (o.paymentMethod === 'SIGNED') row.signedTotal += o.totalAmount - o.discount
  }
  for (const o of cancelledOrders) get(o.waiterId, o.waiter.name).voidedCount += 1
  for (const i of cancelledItems) get(i.order.waiterId, i.order.waiter.name).voidedCount += 1

  // Quantity sold per staff needs the item-level join (order totals alone
  // don't carry quantity) — reuse the same sales-item fetch, grouped here.
  const items = await fetchSalesItems(f)
  for (const it of items) get(it.order.waiterId, it.order.waiter.name).quantitySold += it.quantity

  return [...byStaff.values()]
    .map((r) => ({
      ...r,
      totalSales: roundMoney(r.totalSales),
      avgBillValue: roundMoney(r.billCount > 0 ? r.totalSales / r.billCount : 0),
      quantitySold: roundMoney(r.quantitySold),
      signedTotal: roundMoney(r.signedTotal),
      discountTotal: roundMoney(r.discountTotal),
    }))
    .sort((a, b) => b.totalSales - a.totalSales)
}

export interface CancelledRow {
  id: string; type: 'ORDER' | 'ITEM'; staffName: string; productName: string | null
  amount: number; reason: string | null; date: string
}

export async function getCancelledReport(f: SalesFilters): Promise<CancelledRow[]> {
  const [orders, items] = await Promise.all([
    prisma.posOrder.findMany({
      where: buildOrderWhere(f, ['CANCELLED', 'VOID']),
      select: { id: true, waiter: { select: { name: true } }, totalAmount: true, voidReason: true, createdAt: true },
    }),
    prisma.posOrderItem.findMany({
      where: { status: 'CANCELLED', order: buildOrderWhere(f) },
      select: { id: true, productName: true, amount: true, cancelReason: true, createdAt: true, order: { select: { waiter: { select: { name: true } } } } },
    }),
  ])
  const orderRows: CancelledRow[] = orders.map((o) => ({
    id: o.id, type: 'ORDER', staffName: o.waiter.name, productName: null,
    amount: roundMoney(o.totalAmount), reason: o.voidReason, date: o.createdAt.toISOString(),
  }))
  const itemRows: CancelledRow[] = items.map((i) => ({
    id: i.id, type: 'ITEM', staffName: i.order.waiter.name, productName: i.productName,
    amount: roundMoney(i.amount), reason: i.cancelReason, date: i.createdAt.toISOString(),
  }))
  return [...orderRows, ...itemRows].sort((a, b) => b.date.localeCompare(a.date))
}

export interface DiscountRow {
  orderId: string; orderNo: string; staffName: string; amount: number; percentage: number; reason: string | null; date: string
}

export async function getDiscountReport(f: SalesFilters): Promise<DiscountRow[]> {
  const orders = await prisma.posOrder.findMany({
    where: { ...buildOrderWhere(f, ['CLOSED']), discount: { gt: 0 } },
    select: { id: true, orderNo: true, waiter: { select: { name: true } }, discount: true, totalAmount: true, discountReason: true, closedAt: true },
  })
  return orders.map((o) => ({
    orderId: o.id, orderNo: o.orderNo, staffName: o.waiter.name, amount: roundMoney(o.discount),
    percentage: roundMoney(o.totalAmount > 0 ? (o.discount / o.totalAmount) * 100 : 0),
    reason: o.discountReason, date: (o.closedAt ?? new Date()).toISOString(),
  }))
}

export interface SignedBillRow {
  orderId: string; orderNo: string; staffName: string; total: number; paid: number; balance: number
  status: 'PAID' | 'PARTIAL' | 'UNPAID'; date: string; agingDays: number
}

export async function getSignedBillsReport(f: SalesFilters, outstandingOnly: boolean): Promise<SignedBillRow[]> {
  const orders = await prisma.posOrder.findMany({
    where: { ...buildOrderWhere(f, ['CLOSED']), paymentMethod: 'SIGNED' },
    select: { id: true, orderNo: true, waiter: { select: { name: true } }, totalAmount: true, discount: true, paidAmount: true, closedAt: true },
  })
  const now = Date.now()
  const rows = orders.map((o) => {
    const total = roundMoney(o.totalAmount - o.discount)
    const balance = roundMoney(total - o.paidAmount)
    const status: SignedBillRow['status'] = balance <= 0.5 ? 'PAID' : o.paidAmount > 0 ? 'PARTIAL' : 'UNPAID'
    const closedAt = o.closedAt ?? new Date()
    return {
      orderId: o.id, orderNo: o.orderNo, staffName: o.waiter.name, total, paid: roundMoney(o.paidAmount), balance,
      status, date: closedAt.toISOString(), agingDays: Math.floor((now - closedAt.getTime()) / 86_400_000),
    }
  })
  return outstandingOnly ? rows.filter((r) => r.status !== 'PAID') : rows
}
