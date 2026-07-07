import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  const eventId = req.nextUrl.searchParams.get('eventId')

  // Event orders sell from that event's authorized-products menu only — a
  // curated allow-list, not the outlet's full catalogue minus blocked items,
  // so this branches out before any PosBlockedItem logic runs.
  if (eventId) {
    const authorized = await db.eventProduct.findMany({
      where: { eventId },
      select: { eventPrice: true, product: { select: { id: true, code: true, name: true, category: true, sellingPrice: true } } },
    })
    const flat = authorized.map((ep: { eventPrice: number | null; product: { id: string; code: string; name: string; category: string | null; sellingPrice: number } }) => ({
      ...ep.product, sellingPrice: ep.eventPrice ?? ep.product.sellingPrice, blocked: false,
    }))
    const grouped: Record<string, typeof flat> = {}
    for (const p of flat) {
      const cat = p.category ?? 'Other'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(p)
    }
    return NextResponse.json({ grouped, flat })
  }

  // Get blocked product IDs for this outlet
  const blockedIds = new Set<string>()
  if (outletId) {
    const blocked = await db.posBlockedItem.findMany({
      where: { outletId },
      select: { productId: true },
    })
    blocked.forEach((b: { productId: string }) => blockedIds.add(b.productId))
  }

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, category: true, sellingPrice: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  // Mark blocked items (managers see them marked; waiters get them filtered out)
  const isManager = ['MANAGER', 'ADMIN', 'DIRECTOR'].includes(payload.role)
  const filtered = isManager
    ? products.map(p => ({ ...p, blocked: blockedIds.has(p.id) }))
    : products.filter(p => !blockedIds.has(p.id)).map(p => ({ ...p, blocked: false }))

  // Group by category
  const grouped: Record<string, typeof filtered> = {}
  for (const p of filtered) {
    const cat = p.category ?? 'Other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }

  return NextResponse.json({ grouped, flat: filtered })
}
