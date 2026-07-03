import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const order = await prisma.posOrder.findUnique({
    where: { id },
    include: {
      table: { select: { number: true, label: true } },
      waiter: { select: { name: true } },
      shift: { select: { name: true } },
      outlet: { select: { name: true, legalName: true, tin: true, vrn: true } },
      payments: { orderBy: { createdAt: 'asc' } },
      items: {
        where: { status: { not: 'CANCELLED' } },
        include: { product: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(order)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const BILL_TYPES = ['CUSTOMER', 'ADMIN', 'DIRECTOR', 'DJ', 'TIPS', 'STAFF']
  const allowedFields: Record<string, unknown> = {}
  if (body.discount !== undefined) allowedFields.discount = Number(body.discount)
  if (body.notes !== undefined) allowedFields.notes = body.notes
  if (body.paymentMethod !== undefined) allowedFields.paymentMethod = body.paymentMethod
  if (body.billType !== undefined && BILL_TYPES.includes(body.billType)) allowedFields.billType = body.billType

  const order = await prisma.posOrder.update({ where: { id }, data: allowedFields })
  return NextResponse.json(order)
}
