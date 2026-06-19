import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')

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
