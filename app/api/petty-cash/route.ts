import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canRequestPetty } from '@/lib/petty-access'
import { roundMoney } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId

  const items = await prisma.pettyCash.findMany({ where, orderBy: { date: 'desc' }, take: 200, include: { items: true } })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canRequestPetty(user.email))) return NextResponse.json({ error: 'You are not authorized to submit petty cash requests' }, { status: 403 })

  const body = await req.json()
  const { date, requestedBy, department, functionName, purpose, amount, paymentMethod, payeeName, payeeAccount, paymentStatus, approvedBy, outletId } = body

  // Optional itemized breakdown — one request can hold many needs.
  const rawItems: { detail?: string; unit?: number; unitCost?: number; amount?: number }[] = Array.isArray(body.items) ? body.items : []
  const lineItems = rawItems
    .map((it) => {
      const unit = Number(it.unit) || 1
      const unitCost = roundMoney(Number(it.unitCost) || 0)
      return { detail: String(it.detail || '').trim() || 'Item', unit, unitCost, amount: roundMoney(unit * unitCost) }
    })
    .filter((it) => it.amount > 0 || it.detail !== 'Item')
  // When items are supplied, the grand total is their sum; otherwise use the entered amount.
  const grandTotal = lineItems.length ? roundMoney(lineItems.reduce((s, it) => s + it.amount, 0)) : roundMoney(amount)

  if (!requestedBy) return NextResponse.json({ error: 'Requested by is required' }, { status: 400 })
  if (!purpose) return NextResponse.json({ error: 'Purpose is required' }, { status: 400 })
  if (!grandTotal || grandTotal <= 0) return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 })
  const method = String(paymentMethod || 'CASH').toUpperCase()

  const item = await prisma.pettyCash.create({
    data: {
      date: date ? new Date(date) : new Date(),
      requestedBy,
      department: department || null,
      functionName: functionName || null,
      purpose,
      amount: grandTotal,
      paymentMethod: method,
      payeeName: payeeName || null,
      payeeAccount: payeeAccount || null,
      paymentStatus: String(paymentStatus || 'PAID').toUpperCase() === 'PENDING' ? 'PENDING' : 'PAID',
      approvedBy: approvedBy || null,
      status: approvedBy ? 'APPROVED' : 'PENDING',
      outletId: outletId || user.outletId || null,
      cashierId: user.userId,
      ...(lineItems.length ? { items: { create: lineItems } } : {}),
    },
    include: { items: true },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'PettyCash', entityId: item.id, details: `Petty cash ${grandTotal} for ${purpose}${lineItems.length ? ` (${lineItems.length} items)` : ''}` },
  })

  return NextResponse.json(item, { status: 201 })
}
