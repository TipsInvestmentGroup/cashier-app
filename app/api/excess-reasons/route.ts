import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { seedExcessReasonsIfEmpty, invalidateExcessReasonCache } from '@/lib/excess-reasons-db'

const toCode = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** List excess reasons (any authed user — needed by the picker). Seeds defaults once. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await seedExcessReasonsIfEmpty()
  const items = await prisma.excessReason.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(items)
}

/** Add a reason — owner / fixed manager / owner-chosen manager only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'You are not authorized to add excess reasons' }, { status: 403 })

  const { label, category } = await req.json().catch(() => ({}))
  if (!label || !String(label).trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const code = toCode(label)
  if (!code) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  const validCategory = ['PAYABLE_EXCESS', 'NON_PAYABLE', 'STAFF_LOSS'].includes(category) ? category : 'NON_PAYABLE'
  try {
    const item = await prisma.excessReason.create({ data: { code, label: String(label).trim(), category: validCategory } })
    invalidateExcessReasonCache()
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'ExcessReason', entityId: item.id, details: `Added reason ${item.label} (${item.code})` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A reason with that name already exists' }, { status: 409 })
  }
}
