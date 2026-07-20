import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canRequestPetty } from '@/lib/petty-access'
import { roundMoney } from '@/lib/utils'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'

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
  const { date, requestedBy, department, functionName, purpose, amount, paymentMethod, payeeName, payeeAccount, paymentStatus, approvedBy, outletId, pettyType } = body

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
  const type = String(pettyType || 'CASHIER').toUpperCase() === 'ACCOUNTANT' ? 'ACCOUNTANT' : 'CASHIER'
  // New requests default to UNPAID and go through the payment screen; a direct
  // record (paymentStatus=PAID) stamps the payer immediately.
  const isPaid = String(paymentStatus || 'UNPAID').toUpperCase() === 'PAID'

  const outletIdVal = outletId || user.outletId || null

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.pettyCash.create({
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
        paymentStatus: isPaid ? 'PAID' : 'UNPAID',
        pettyType: type,
        approvedBy: approvedBy || null,
        status: approvedBy ? 'APPROVED' : 'PENDING',
        outletId: outletIdVal,
        cashierId: user.userId,
        ...(isPaid ? { paidAt: new Date(), paidById: user.userId, paidByName: user.name } : {}),
        ...(lineItems.length ? { items: { create: lineItems } } : {}),
      },
      include: { items: true },
    })

    await tx.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'PettyCash', entityId: created.id, details: `Petty cash ${grandTotal} for ${purpose}${lineItems.length ? ` (${lineItems.length} items)` : ''}` },
    })

    // A record created already-paid disburses immediately — post the same
    // Dr Petty Cash Expense / Cr <method account> entry as the pay route (D17).
    if (isPaid) {
      const outlet = outletIdVal ? await tx.outlet.findUnique({ where: { id: outletIdVal }, select: { companyId: true } }) : null
      const companyId = outlet?.companyId || (await resolveDefaultCompanyId(tx))
      if (companyId) {
        const expenseAccountId = await resolveAccountId(tx, { companyId, key: 'PETTY_CASH_EXPENSE' })
        const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: method, outletId: outletIdVal || undefined })
        await postJournalEntry(tx, {
          companyId, entryDate: created.date, sourceModule: 'MANUAL', sourceType: 'PettyCash', sourceId: created.id,
          description: `Petty cash payout — ${purpose}`, createdById: user.userId,
          lines: [
            { accountId: expenseAccountId, debit: grandTotal, outletId: outletIdVal || undefined },
            { accountId: cashAccountId, credit: grandTotal, outletId: outletIdVal || undefined },
          ],
        })
      }
    }
    return created
  })

  return NextResponse.json(item, { status: 201 })
}
