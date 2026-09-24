import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  resolvePaymentMethods, getStoredPaymentMethods, setExpenseModuleConfig,
  EXPENSE_SCOPES, type ExpenseScope,
} from '@/lib/expense-config'

/**
 * GET — allowed payment methods.
 *   • ?scope=GLOBAL|COMPANY|OUTLET[&scopeId=…]  → ADMIN only. Returns the RAW
 *     list stored at exactly that scope (`stored`) plus the effective list once
 *     inheritance is applied (`resolved`). Powers the Expense Settings editor.
 *   • otherwise (optionally ?outletId=…)         → any authenticated user.
 *     Returns the resolved list the pay screen should offer for that outlet.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const scopeParam = searchParams.get('scope')

  if (scopeParam) {
    if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(EXPENSE_SCOPES as readonly string[]).includes(scopeParam)) {
      return NextResponse.json({ error: `scope must be one of ${EXPENSE_SCOPES.join(', ')}` }, { status: 400 })
    }
    const scope = scopeParam as ExpenseScope
    const scopeId = scope === 'GLOBAL' ? null : searchParams.get('scopeId')
    if (scope !== 'GLOBAL' && !scopeId) {
      return NextResponse.json({ error: 'scopeId is required for a COMPANY or OUTLET scope' }, { status: 400 })
    }
    const [stored, resolved] = await Promise.all([
      getStoredPaymentMethods(prisma, scope, scopeId),
      // resolved-for-preview: for an OUTLET scope show what that outlet ends up
      // with; company/global previews fall back to their own inheritance.
      scope === 'OUTLET' ? resolvePaymentMethods(prisma, scopeId) : resolvePaymentMethods(prisma, null),
    ])
    return NextResponse.json({ scope, scopeId, stored, resolved })
  }

  const outletId = searchParams.get('outletId')
  const paymentMethods = await resolvePaymentMethods(prisma, outletId)
  return NextResponse.json({ paymentMethods })
}

/** PUT — set the payment methods stored at one scope (ADMIN only). Body:
 *  { scope, scopeId?, paymentMethods: string[] }. An empty array clears the
 *  override so the scope inherits again. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const scopeParam = body.scope
  if (!(EXPENSE_SCOPES as readonly string[]).includes(scopeParam)) {
    return NextResponse.json({ error: `scope must be one of ${EXPENSE_SCOPES.join(', ')}` }, { status: 400 })
  }
  const scope = scopeParam as ExpenseScope
  const scopeId = scope === 'GLOBAL' ? null : (body.scopeId || null)
  if (scope !== 'GLOBAL' && !scopeId) {
    return NextResponse.json({ error: 'scopeId is required for a COMPANY or OUTLET scope' }, { status: 400 })
  }
  if (!Array.isArray(body.paymentMethods)) {
    return NextResponse.json({ error: 'paymentMethods must be an array' }, { status: 400 })
  }

  const row = await setExpenseModuleConfig(prisma, scope, scopeId, { paymentMethods: body.paymentMethods })
  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE', entity: 'ExpenseModuleConfig', entityId: row.id,
      details: `Updated payment methods for scope ${scope}${scopeId ? ` (${scopeId})` : ''}`,
    },
  })
  const [stored, resolved] = await Promise.all([
    getStoredPaymentMethods(prisma, scope, scopeId),
    scope === 'OUTLET' ? resolvePaymentMethods(prisma, scopeId) : resolvePaymentMethods(prisma, null),
  ])
  return NextResponse.json({ scope, scopeId, stored, resolved })
}
