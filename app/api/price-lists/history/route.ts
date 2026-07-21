import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** GET — price change history. Filter by ?productId= or ?priceListId=. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const productId = searchParams.get('productId'); if (productId) where.productId = productId
  const priceListId = searchParams.get('priceListId'); if (priceListId) where.priceListId = priceListId
  const rows = await db.priceChangeLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })
  return NextResponse.json({ rows })
}
