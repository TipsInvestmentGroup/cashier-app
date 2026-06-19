import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, category: true, sellingPrice: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  const grouped: Record<string, typeof products> = {}
  for (const p of products) {
    const cat = p.category ?? 'Other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }

  return NextResponse.json({ grouped, flat: products })
}
