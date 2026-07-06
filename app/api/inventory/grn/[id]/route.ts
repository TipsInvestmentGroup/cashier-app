import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/inventory/grn/[id]
 * Full GRN detail with line items, for a "view GRN" drill-down.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const grn = await prisma.grn.findUnique({ where: { id }, include: { items: true } })
  if (!grn) return NextResponse.json({ error: 'GRN not found' }, { status: 404 })

  return NextResponse.json({ grn })
}
