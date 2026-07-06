import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * GET /api/inventory/stock-levels/ledger?outletId=&counterCode=&productId=
 * Recent stock movements for the history view — RESTOCK and SALE entries,
 * most recent first.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')
  const productId = req.nextUrl.searchParams.get('productId')
  if (!outletId) return NextResponse.json({ error: 'outletId required' }, { status: 400 })

  const entries = await prisma.stockLedgerEntry.findMany({
    where: { outletId, ...(counterCode ? { counterCode } : {}), ...(productId ? { productId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ rows: entries })
}
