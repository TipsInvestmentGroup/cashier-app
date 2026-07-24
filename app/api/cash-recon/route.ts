import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, writeOutletId } from '@/lib/auth'
import { canVerifyCash } from '@/lib/cash-verify'
import { roundMoney } from '@/lib/utils'
import { isValidExcessReasonCode } from '@/lib/excess-reasons-db'
import { classForReason } from '@/lib/reconciliation-classification'
import { generateBillReference } from '@/lib/bill-reference'
import { syncFromCashRecon } from '@/lib/payment-verification'
import { autoSettleExcessPayment } from '@/lib/excess-settlement'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

/** Yesterday's (or the most recent prior) closing balance becomes today's opening. */
async function previousClosing(day: Date, outletId?: string | null): Promise<number> {
  const prev = await prisma.cashRecon.findFirst({
    where: { date: { lt: startOfDay(day) }, outletId: outletId || null },
    orderBy: { date: 'desc' },
  })
  return prev?.closingBalance || 0
}

/** Computed cash figures for a day+outlet (collected / paid-cash / expenses). */
async function computeCash(dayStart: Date, dayEnd: Date, outletId?: string | null) {
  const range = { gte: dayStart, lte: dayEnd }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId
  const [coll, paid, petty] = await Promise.all([
    prisma.dailyCollection.aggregate({ where: f, _sum: { cash: true } }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: 'CASH' }, _sum: { amountPaid: true } }),
    // Only cash actually disbursed from the cashier's drawer reduces it — paid,
    // CASH, and drawn from the cashier fund (accountant-fund payments don't count).
    prisma.pettyCash.aggregate({ where: { ...f, paymentMethod: 'CASH', paymentStatus: 'PAID', pettyType: 'CASHIER' }, _sum: { amount: true } }),
  ])
  return {
    cashCollected: coll._sum.cash || 0,
    paidBillsCash: paid._sum.amountPaid || 0,
    cashExpenses: petty._sum.amount || 0,
  }
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  // Cashiers are strictly locked to their own outlet.
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const dateParam = searchParams.get('date')

  // Single-day computed view (for the reconciliation form)
  if (dateParam) {
    const parsed = parse(dateParam, 'yyyy-MM-dd', new Date())
    const day = isValid(parsed) ? parsed : new Date()
    const computed = await computeCash(startOfDay(day), endOfDay(day), outletId)
    const existing = await prisma.cashRecon.findFirst({
      where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, ...(outletId ? { outletId } : {}) },
      include: { excessItems: true },
    })
    const autoOpening = await previousClosing(day, outletId)
    return NextResponse.json({ computed, existing, autoOpening, canVerify: await canVerifyCash(user.email) })
  }

  // List
  const items = await prisma.cashRecon.findMany({
    where: outletId ? { outletId } : {},
    orderBy: { date: 'desc' },
    take: 200,
  })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { date, outletId, cashDeposited = 0, notes } = body
  const rawExcessItems: { id?: string; amount: number; reason: string; staffId?: string; personId?: string }[] = Array.isArray(body.excessItems) ? body.excessItems : []
  const day = date ? new Date(date) : new Date()
  // Cashiers always reconcile their own outlet.
  const usedOutletId = writeOutletId(user, outletId)

  const excessItems = rawExcessItems
    .map((it) => ({ id: it.id || null, amount: roundMoney(it.amount), reason: it.reason, staffId: it.staffId || null, personId: it.personId || null }))
    .filter((it) => it.amount > 0)

  for (const it of excessItems) {
    if (!(await isValidExcessReasonCode(it.reason))) {
      return NextResponse.json({ error: 'A reason is required for each excess amount paid' }, { status: 400 })
    }
    if (it.reason === 'STAFF_TIP' && !it.staffId) {
      return NextResponse.json({ error: 'Select the staff name for the excess amount paid' }, { status: 400 })
    }
    if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) {
      return NextResponse.json({ error: 'Select the customer name for the excess amount paid' }, { status: 400 })
    }
  }

  const [staffRows, personRows] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: excessItems.filter((i) => i.staffId).map((i) => i.staffId as string) } }, select: { id: true, name: true } }),
    prisma.person.findMany({ where: { id: { in: excessItems.filter((i) => i.personId).map((i) => i.personId as string) } }, select: { id: true, name: true } }),
  ])
  const staffName = (id: string | null) => (id ? staffRows.find((s) => s.id === id)?.name || null : null)
  const personName = (id: string | null) => (id ? personRows.find((p) => p.id === id)?.name || null : null)

  const excess = roundMoney(excessItems.reduce((s, it) => s + it.amount, 0))

  // Opening = previous closing (auto). Closing computed & stored.
  const opening = await previousClosing(day, usedOutletId)
  const c = await computeCash(startOfDay(day), endOfDay(day), usedOutletId)
  const deposited = roundMoney(cashDeposited)
  const closing = roundMoney(opening + c.cashCollected + c.paidBillsCash - c.cashExpenses - deposited - excess)

  // One reconciliation per day+outlet — update if it exists
  const existing = await prisma.cashRecon.findFirst({
    where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, outletId: usedOutletId },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {
    date: day,
    outletId: usedOutletId,
    openingBalance: opening,
    cashDeposited: deposited,
    excessAmountPaid: excess,
    closingBalance: closing,
    notes: notes || null,
    cashierId: user.userId,
  }
  // Verified amount: only an authorized officer may set/change it.
  if (body.verifiedAmount !== undefined && body.verifiedAmount !== null && body.verifiedAmount !== '') {
    if (await canVerifyCash(user.email)) {
      data.verifiedAmount = roundMoney(body.verifiedAmount)
      data.verifiedBy = user.name
    } else {
      return NextResponse.json({ error: 'Only an authorized officer can enter the verified cash amount' }, { status: 403 })
    }
  }

  let item
  try {
    item = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.cashRecon.update({ where: { id: existing.id }, data })
      : await tx.cashRecon.create({ data })

    // Sync the day's excess items with what was just submitted, but preserve
    // paidAmount on rows that already have a settlement recorded (Excess Recon) —
    // a wholesale delete+recreate would silently wipe recorded payments.
    const priorItems = existing ? await tx.cashReconExcess.findMany({ where: { cashReconId: saved.id } }) : []
    const incomingIds = new Set(excessItems.filter((it) => it.id).map((it) => it.id as string))
    const toRemove = priorItems.filter((p) => !incomingIds.has(p.id))
    const blockedRemoval = toRemove.find((p) => p.paidAmount > 0 || p.settledAsSourceAmount > 0)
    if (blockedRemoval) {
      const settled = blockedRemoval.paidAmount + blockedRemoval.settledAsSourceAmount
      throw new Error(`Cannot remove an excess item that already has ${settled} settled — clear its payments in Excess Recon first`)
    }
    if (toRemove.length > 0) {
      await tx.cashReconExcess.deleteMany({ where: { id: { in: toRemove.map((p) => p.id) } } })
    }
    for (const it of excessItems) {
      const prior = it.id ? priorItems.find((p) => p.id === it.id) : undefined
      // Auto-settlement already redirected part of this row's own amount to
      // pay down someone else's balance — the row can't be edited down below
      // that without unwinding those settlements first (same guard style as
      // the paidAmount protection above/on the single-item edit route).
      if (prior && it.amount < prior.settledAsSourceAmount) {
        throw new Error(`Cannot reduce this excess amount below the ${prior.settledAsSourceAmount} already auto-settled against outstanding balances`)
      }
      const fields = {
        amount: it.amount,
        reason: it.reason,
        // Cash Recon excess is always an over-collection to pay out — the
        // Collection form's NON_PAYABLE/STAFF_LOSS categories don't apply here.
        category: 'PAYABLE_EXCESS',
        // Accounting class still derives from the reason code, so a STAFF_TIP
        // cash-recon line is ADJUSTMENT (pass-through) even though its legacy
        // category is PAYABLE_EXCESS.
        accountingClass: classForReason(it.reason, 'PAYABLE_EXCESS'),
        staffId: it.staffId,
        staffName: staffName(it.staffId),
        personId: it.personId,
        personName: personName(it.personId),
      }
      let rowId: string
      if (prior) {
        await tx.cashReconExcess.update({ where: { id: it.id as string }, data: fields })
        rowId = it.id as string
      } else {
        const recordId = crypto.randomUUID()
        const ref = await generateBillReference(tx, {
          recordId, sourceModel: 'CashReconExcess', billTypeCode: 'EXS', date: day, personId: it.personId, outletId: usedOutletId,
        })
        await tx.cashReconExcess.create({
          data: {
            id: recordId, cashReconId: saved.id, ...fields,
            internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          },
        })
        rowId = recordId
      }

      // Auto-settlement engine (generic across every PAYABLE_EXCESS reason):
      // this row's cash already left the till, so before it stands as its own
      // new pending excess, apply only the newly-added amount (never re-run on
      // an unchanged/decreased save) against outstanding same-reason
      // CollectionExcess balances, oldest first.
      const priorAmount = prior?.amount || 0
      const deltaForSettlement = roundMoney(it.amount - priorAmount)
      if (deltaForSettlement > 0) {
        const result = await autoSettleExcessPayment(tx, {
          reason: it.reason, amount: deltaForSettlement, staffId: it.staffId, personId: it.personId,
          outletId: usedOutletId, sourceCashReconExcessId: rowId, userId: user.userId,
        })
        if (result.allocated > 0) {
          await tx.cashReconExcess.update({
            where: { id: rowId },
            data: { settledAsSourceAmount: roundMoney((prior?.settledAsSourceAmount || 0) + result.allocated) },
          })
        }
      }
    }

    // D10 — cash-recon excess is cash paid OUT of the till at reconciliation
    // time (it reduces the closing balance, like a deposit). That cash came in
    // via the day's collection and was booked to Sales Revenue, so paying it
    // back out reverses that revenue against cash: Dr Sales Revenue / Cr Cash.
    // Posted idempotently as a DELTA — the recon is re-saved repeatedly as the
    // day closes, so we true-up the net Sales-Revenue posting to the current
    // excess total instead of reversing/re-posting each time (delta 0 = no-op).
    // The basis nets out whatever the auto-settlement engine has redirected to
    // pay down outstanding CollectionExcess balances (that portion posts its
    // own Dr Excess-Payable / Cr Cash inside autoSettleExcessPayment) — only
    // the unmatched remainder is a genuine Sales-Revenue reversal.
    const outlet = usedOutletId ? await tx.outlet.findUnique({ where: { id: usedOutletId }, select: { companyId: true } }) : null
    const companyId = outlet?.companyId || (await resolveDefaultCompanyId(tx))
    if (companyId) {
      const freshItems = await tx.cashReconExcess.findMany({ where: { cashReconId: saved.id } })
      const excessNetOfAutoSettlement = roundMoney(freshItems.reduce((s, it) => s + roundMoney(it.amount - it.settledAsSourceAmount), 0))
      const salesRevenueAccountId = await resolveAccountId(tx, { companyId, key: 'SALES_REVENUE' })
      const priorLines = await tx.journalLine.findMany({
        where: { accountId: salesRevenueAccountId, journalEntry: { sourceType: 'CashReconExcessPayout', sourceId: saved.id } },
        select: { debit: true, credit: true },
      })
      const postedNet = roundMoney(priorLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0))
      const delta = roundMoney(excessNetOfAutoSettlement - postedNet)
      if (delta !== 0) {
        const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: 'CASH', outletId: usedOutletId })
        await postJournalEntry(tx, {
          companyId, entryDate: day, sourceModule: 'COLLECTIONS', sourceType: 'CashReconExcessPayout', sourceId: saved.id,
          description: `Cash reconciliation excess paid out — ${saved.id}`, createdById: user.userId,
          lines: delta > 0
            ? [{ accountId: salesRevenueAccountId, debit: delta, outletId: usedOutletId }, { accountId: cashAccountId, credit: delta, outletId: usedOutletId }]
            : [{ accountId: cashAccountId, debit: -delta, outletId: usedOutletId }, { accountId: salesRevenueAccountId, credit: -delta, outletId: usedOutletId }],
        })
      }
    }
    return saved
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error saving cash reconciliation' }, { status: 400 })
  }

  await prisma.auditLog.create({
    data: { userId: user.userId, action: existing ? 'UPDATE' : 'CREATE', entity: 'CashRecon', entityId: item.id, details: `Deposited ${deposited}${excess > 0 ? `, excess ${excess} (${excessItems.length} item${excessItems.length === 1 ? '' : 's'})` : ''}, closing ${closing}` },
  })

  // Feeds the Reconciliation Workflow Engine's PaymentVerification pilot flow
  // (source=SYSTEM_GENERATED) once an officer has verified the cash amount —
  // no-op for any company that hasn't enabled the PAYMENT_VERIFICATION check.
  if (data.verifiedAmount !== undefined) {
    await syncFromCashRecon(item.id).catch(() => {})
  }

  const withItems = await prisma.cashRecon.findUnique({ where: { id: item.id }, include: { excessItems: true } })
  return NextResponse.json(withItems, { status: 201 })
}
