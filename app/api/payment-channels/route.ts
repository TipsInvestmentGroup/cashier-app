import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

const DEFAULTS = [
  { code: 'CASH', label: 'Cash' },
  { code: 'CRDB', label: 'CRDB' },
  { code: 'STANBIC', label: 'Stanbic' },
  { code: 'MPESA', label: 'M-PESA' },
]

const toCode = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** List payment channels (any authed user — needed by the pickers). Seeds defaults once. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await prisma.paymentChannel.count()) === 0) {
    for (const d of DEFAULTS) await prisma.paymentChannel.upsert({ where: { code: d.code }, update: {}, create: d })
  }
  const items = await prisma.paymentChannel.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(items)
}

/** Add a channel — owner / fixed manager / owner-chosen manager only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'You are not authorized to add channels' }, { status: 403 })

  const { label } = await req.json().catch(() => ({}))
  if (!label || !String(label).trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const code = toCode(label)
  if (!code) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  try {
    const item = await prisma.paymentChannel.create({ data: { code, label: String(label).trim() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'PaymentChannel', entityId: item.id, details: `Added channel ${item.label} (${item.code})` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A channel with that name already exists' }, { status: 409 })
  }
}
