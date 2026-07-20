import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { seedExcessReasonsIfEmpty, invalidateExcessReasonCache } from '@/lib/excess-reasons-db'
import { RESERVED_REASON_CODES } from '@/lib/excess-reasons'
import { classForReason } from '@/lib/reconciliation-classification'

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
  // STAFF_LOSS is the single reserved receivable code that drives the
  // auto-SignedBill debt path — a custom reason must never carry it, or a
  // direct API call could mint rogue staff-debt reasons. Custom reasons may
  // only be PAYABLE_EXCESS or NON_PAYABLE.
  if (category === 'STAFF_LOSS' && !RESERVED_REASON_CODES.includes(code)) {
    return NextResponse.json({ error: 'The Staff Loss category is reserved and cannot be assigned to a custom reason.' }, { status: 400 })
  }
  const validCategory = ['PAYABLE_EXCESS', 'NON_PAYABLE'].includes(category) ? category : 'NON_PAYABLE'
  try {
    const accountingClass = classForReason(code, validCategory)
    const item = await prisma.excessReason.create({ data: { code, label: String(label).trim(), category: validCategory, accountingClass } })
    invalidateExcessReasonCache()
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'ExcessReason', entityId: item.id, details: `Added reason ${item.label} (${item.code})` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A reason with that name already exists' }, { status: 409 })
  }
}
