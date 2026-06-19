import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

type Params = { params: Promise<{ id: string }> }

// GET /api/pos/shifts/[id]/report — full shift summary for PDF/WhatsApp share
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: shiftId } = await params

  const shift = await prisma.posShift.findUnique({
    where: { id: shiftId },
    include: { outlet: { select: { name: true } } },
  })
  if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

  const orders = await prisma.posOrder.findMany({
    where: { shiftId, status: 'CLOSED' },
    include: {
      waiter: { select: { id: true, name: true } },
      items: {
        where: { status: { not: 'CANCELLED' } },
        include: { product: { select: { name: true, category: true } } },
      },
    },
  })

  // Sales per waiter
  const waiterMap: Record<string, { name: string; orders: number; total: number }> = {}
  for (const order of orders) {
    const wid = order.waiterId
    if (!waiterMap[wid]) waiterMap[wid] = { name: order.waiter.name, orders: 0, total: 0 }
    waiterMap[wid].orders++
    waiterMap[wid].total = roundMoney(waiterMap[wid].total + order.totalAmount - order.discount)
  }

  // Top selling items
  const itemMap: Record<string, { name: string; category: string; qty: number; total: number }> = {}
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.productName
      if (!itemMap[key]) itemMap[key] = { name: item.productName, category: item.product?.category ?? 'Other', qty: 0, total: 0 }
      itemMap[key].qty += item.quantity
      itemMap[key].total = roundMoney(itemMap[key].total + item.amount)
    }
  }
  const topItems = Object.values(itemMap).sort((a, b) => b.total - a.total).slice(0, 10)

  // Payment method breakdown
  const paymentBreakdown: Record<string, number> = {}
  for (const order of orders) {
    const method = order.paymentMethod ?? 'UNKNOWN'
    paymentBreakdown[method] = roundMoney((paymentBreakdown[method] ?? 0) + (order.totalAmount - order.discount))
  }

  const grandTotal = roundMoney(orders.reduce((s, o) => s + o.totalAmount - o.discount, 0))

  return NextResponse.json({
    shift: { id: shift.id, name: shift.name, date: shift.date, openedAt: shift.openedAt, closedAt: shift.closedAt },
    outlet: shift.outlet.name,
    summary: { totalOrders: orders.length, grandTotal },
    byWaiter: Object.values(waiterMap).sort((a, b) => b.total - a.total),
    topItems,
    paymentBreakdown,
    generatedAt: new Date().toISOString(),
  })
}
