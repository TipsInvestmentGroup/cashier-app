import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { updateRequestTypeField, deactivateRequestTypeField } from '@/lib/expense-config'

/** PATCH — edit a custom field. System fields only allow label/required/order. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; fieldId: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { fieldId } = await params
  const body = await req.json().catch(() => ({}))
  try {
    const field = await updateRequestTypeField(prisma, fieldId, {
      label: body.label !== undefined ? String(body.label) : undefined,
      required: body.required !== undefined ? body.required === true : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      fieldType: body.fieldType, options: body.options !== undefined ? (Array.isArray(body.options) ? body.options.map(String) : null) : undefined,
    })
    return NextResponse.json(field)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not update field' }, { status: 400 })
  }
}

/** DELETE — soft-delete a custom field. System (seeded) fields cannot be removed. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; fieldId: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { fieldId } = await params
  try {
    await deactivateRequestTypeField(prisma, fieldId)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not remove field' }, { status: 400 })
  }
}
