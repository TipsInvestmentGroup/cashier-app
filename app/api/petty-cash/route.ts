import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']
const METHODS = ['CASH', 'CRDB', 'STANBIC', 'MPESA']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId

  const items = await prisma.pettyCash.findMany({ where, orderBy: { date: 'desc' }, take: 200 })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { date, requestedBy, department, purpose, amount, paymentMethod, payeeName, payeeAccount, approvedBy, outletId } = body

  if (!requestedBy) return NextResponse.json({ error: 'Requested by is required' }, { status: 400 })
  if (!purpose) return NextResponse.json({ error: 'Purpose is required' }, { status: 400 })
  if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 })
  const method = String(paymentMethod || 'CASH').toUpperCase()
  if (!METHODS.includes(method)) return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 })

  const item = await prisma.pettyCash.create({
    data: {
      date: date ? new Date(date) : new Date(),
      requestedBy,
      department: department || null,
      purpose,
      amount: Number(amount),
      paymentMethod: method,
      payeeName: payeeName || null,
      payeeAccount: payeeAccount || null,
      approvedBy: approvedBy || null,
      status: approvedBy ? 'APPROVED' : 'PENDING',
      outletId: outletId || user.outletId || null,
      cashierId: user.userId,
    },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'PettyCash', entityId: item.id, details: `Petty cash ${amount} for ${purpose}` },
  })

  return NextResponse.json(item, { status: 201 })
}
