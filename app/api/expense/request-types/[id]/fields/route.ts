import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { listRequestTypeFields, createRequestTypeField } from '@/lib/expense-config'

/** GET — every active custom field for a request type, in display order.
 *  Any authenticated user (the expense request forms need this to render). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  return NextResponse.json(await listRequestTypeFields(prisma, id))
}

/** POST — add a custom field to a request type. Admin-only, per "the
 *  administrator should be able to add additional custom fields as needed". */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.fieldKey) return NextResponse.json({ error: 'fieldKey is required' }, { status: 400 })
  if (!body.label) return NextResponse.json({ error: 'label is required' }, { status: 400 })

  const requestType = await prisma.requestType.findUnique({ where: { id } })
  if (!requestType) return NextResponse.json({ error: 'Request type not found' }, { status: 404 })

  try {
    const field = await createRequestTypeField(prisma, id, {
      fieldKey: String(body.fieldKey), label: String(body.label),
      fieldType: body.fieldType, required: body.required === true,
      options: Array.isArray(body.options) ? body.options.map(String) : null,
      sortOrder: Number(body.sortOrder) || 0,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'RequestTypeField', entityId: field.id, details: `Added custom field ${field.label} to ${requestType.name}` },
    })
    return NextResponse.json(field, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create field' }, { status: 400 })
  }
}
