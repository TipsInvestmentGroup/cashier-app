import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { seedBillTypesIfEmpty } from '@/lib/bill-reference'
import { BILL_TYPE_CATEGORIES } from '@/lib/bill-reference-defaults'

const CAN_MANAGE = ['ADMIN', 'DIRECTOR']

/** Short-code variant of app/api/payment-channels/route.ts's `toCode` helper —
 *  bill type codes are meant to stay short like SBA/PBC, so this caps at 4
 *  alnum chars and resolves collisions by appending a number instead of
 *  growing unboundedly. */
async function generateUniqueBillTypeCode(name: string): Promise<string> {
  const cleaned = String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
  const base = cleaned.slice(0, 4) || 'CUS'

  const existing = await prisma.billTypeConfig.findUnique({ where: { code: base } })
  if (!existing) return base

  for (let n = 2; n < 1000; n++) {
    const suffix = String(n)
    const candidate = (base.slice(0, Math.max(1, 4 - suffix.length)) + suffix).slice(0, 4)
    const clash = await prisma.billTypeConfig.findUnique({ where: { code: candidate } })
    if (!clash) return candidate
  }
  throw new Error(`Could not generate a unique bill type code from "${name}" — too many collisions`)
}

/** List all bill types (any authed user — needed by pickers across the Bill
 *  Reference System). Seeds the 15 defaults once, the first time they're needed. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await seedBillTypesIfEmpty(prisma)
  const items = await prisma.billTypeConfig.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] })
  return NextResponse.json(items)
}

/** Create a new custom bill type — ADMIN/DIRECTOR only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MANAGE)) return NextResponse.json({ error: 'You are not authorized to create bill types' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const prefix = String(body.prefix || '').trim()
  const category = String(body.category || '').trim()

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!prefix) return NextResponse.json({ error: 'Prefix is required' }, { status: 400 })
  if (!(BILL_TYPE_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: `Category must be one of: ${BILL_TYPE_CATEGORIES.join(', ')}` }, { status: 400 })
  }

  await seedBillTypesIfEmpty(prisma)

  try {
    const code = await generateUniqueBillTypeCode(name)
    const maxSort = await prisma.billTypeConfig.aggregate({ _max: { sortOrder: true } })
    const item = await prisma.billTypeConfig.create({
      data: {
        code,
        name,
        prefix,
        category,
        legacyBillTypeCode: null,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'BillTypeConfig', entityId: item.id, details: `Added bill type ${item.name} (${item.code})` },
    })
    return NextResponse.json(item, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'A bill type with that name/code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create bill type' }, { status: 400 })
  }
}
