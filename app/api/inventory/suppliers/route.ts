import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * GET /api/inventory/suppliers
 * POST /api/inventory/suppliers
 * body: { name, contactPerson?, phone?, email?, paymentTerms? }
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const suppliers = await prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })
  return NextResponse.json({ suppliers })
}

export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, contactPerson, phone, email, paymentTerms } = await req.json().catch(() => ({}))
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    const supplier = await prisma.supplier.create({
      data: {
        name: name.trim().slice(0, 200),
        contactPerson: typeof contactPerson === 'string' ? contactPerson.trim().slice(0, 100) || null : null,
        phone: typeof phone === 'string' ? phone.trim().slice(0, 30) || null : null,
        email: typeof email === 'string' ? email.trim().slice(0, 100) || null : null,
        paymentTerms: typeof paymentTerms === 'string' ? paymentTerms.trim().slice(0, 100) || null : null,
      },
    })
    return NextResponse.json({ supplier }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'A supplier with this name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 400 })
  }
}
