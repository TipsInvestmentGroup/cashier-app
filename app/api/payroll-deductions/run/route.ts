import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'
import { startOfMonth, endOfMonth, parse, isValid } from 'date-fns'

/**
 * Runs the payroll deduction for a period: settles the over-limit amounts
 * (Admins/Directors) and staff losses by creating PAYROLL payment records
 * against the person's outstanding bills (oldest first). This clears the
 * deducted amounts from receivables.
 *
 * Safe to re-run: settled bills drop out, so a second run finds nothing new.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ['ACCOUNTANT', 'ADMIN'])) {
    return NextResponse.json({ error: 'Only Accountant or Admin can run payroll deductions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const monthParam: string | undefined = body.month
  const outletId: string | undefined = body.outletId

  let monthStart: Date | null = null
  let monthEnd: Date | null = null
  if (monthParam && monthParam !== 'all') {
    const parsed = parse(monthParam, 'yyyy-MM', new Date())
    if (isValid(parsed)) {
      monthStart = startOfMonth(parsed)
      monthEnd = endOfMonth(parsed)
    }
  }
  const monthly = monthStart !== null

  const where: Record<string, unknown> = {
    billType: { in: ['ADMIN', 'DIRECTOR', 'STAFF_LOSS'] },
  }
  if (outletId) where.outletId = outletId
  if (monthly) where.date = { gte: monthStart, lte: monthEnd }
  else where.status = { not: 'PAID' }

  const bills = await prisma.signedBill.findMany({
    where,
    include: {
      person: { select: { creditLimit: true } },
      payments: { select: { amountPaid: true, paymentMethod: true } },
    },
    orderBy: { date: 'asc' },
  })

  // Group by person + type
  type Group = {
    personId: string | null
    personName: string
    billType: string
    creditLimit: number
    grossSpent: number
    payrollPaid: number
    bills: { id: string; outstanding: number; outletId: string }[]
  }
  const groups = new Map<string, Group>()
  for (const b of bills) {
    const paid = b.payments.reduce((s, p) => s + p.amountPaid, 0)
    const payrollPaid = b.payments.filter((p) => p.paymentMethod === 'PAYROLL').reduce((s, p) => s + p.amountPaid, 0)
    const outstanding = b.amount - paid
    const key = `${b.personId || `name:${b.personName}`}|${b.billType}`
    const limit = b.person?.creditLimit ?? 0
    const g = groups.get(key) || {
      personId: b.personId,
      personName: b.personName,
      billType: b.billType,
      creditLimit: limit,
      grossSpent: 0,
      payrollPaid: 0,
      bills: [],
    }
    g.grossSpent += b.amount
    g.payrollPaid += payrollPaid
    if (limit > g.creditLimit) g.creditLimit = limit
    if (outstanding > 0) g.bills.push({ id: b.id, outstanding, outletId: b.outletId })
    groups.set(key, g)
  }

  const periodLabel = monthly ? monthParam : 'all-time'
  const settlements: { personName: string; billType: string; deducted: number }[] = []
  let totalDeducted = 0

  for (const g of groups.values()) {
    const totalOutstanding = g.bills.reduce((s, x) => s + x.outstanding, 0)
    const isStaff = g.billType === 'STAFF_LOSS'
    const overLimit = isStaff ? totalOutstanding : Math.max(0, (monthly ? g.grossSpent : totalOutstanding) - g.creditLimit)
    // Still recoverable: in monthly mode subtract payroll already applied (gross-based);
    // all-time `outstanding` already nets prior payroll. Never exceed what is owed.
    let remaining = isStaff
      ? totalOutstanding
      : monthly
        ? Math.min(Math.max(0, overLimit - g.payrollPaid), totalOutstanding)
        : Math.min(overLimit, totalOutstanding)
    if (remaining <= 0) continue

    const deductedForPerson = remaining

    // Allocate across this person's outstanding bills, oldest first
    for (const bill of g.bills) {
      if (remaining <= 0) break
      const alloc = Math.min(remaining, bill.outstanding)
      if (alloc <= 0) continue

      // Reference generation (sequence counter + registry row) must be atomic
      // with the PaidBill row itself — same reasoning as lib/bill-reference.ts.
      await prisma.$transaction(async (tx) => {
        const recordId = crypto.randomUUID()
        // Always linked to a signedBillId here — g.billType is that signed
        // bill's own billType (ADMIN | DIRECTOR | STAFF_LOSS), the truest
        // legacy signal, same rule as lib/payment-alloc.ts.
        const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'PAID_BILL', g.billType)
        const ref = await generateBillReference(tx, {
          recordId, sourceModel: 'PaidBill', billTypeCode, personId: g.personId, outletId: bill.outletId,
        })

        await tx.paidBill.create({
          data: {
            id: recordId,
            signedBillId: bill.id,
            personId: g.personId,
            payerName: g.personName,
            amountPaid: alloc,
            paymentMethod: 'PAYROLL',
            notes: `Payroll deduction (${periodLabel})`,
            billRef: `PAYROLL-${periodLabel}`,
            outletId: bill.outletId,
            cashierId: user.userId,
            internalBillId: ref.internalBillId,
            displayReference: ref.displayReference,
            billTypeConfigId: ref.billTypeConfigId,
          },
        })

        // Recompute and update bill status
        const agg = await tx.paidBill.aggregate({
          where: { signedBillId: bill.id },
          _sum: { amountPaid: true },
        })
        const bRow = await tx.signedBill.findUnique({ where: { id: bill.id }, select: { amount: true } })
        const totalPaid = agg._sum.amountPaid || 0
        const newStatus = bRow && totalPaid >= bRow.amount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'
        await tx.signedBill.update({ where: { id: bill.id }, data: { status: newStatus } })
      })

      remaining -= alloc
    }

    const actuallyDeducted = deductedForPerson - Math.max(0, remaining)
    if (actuallyDeducted > 0) {
      settlements.push({ personName: g.personName, billType: g.billType, deducted: actuallyDeducted })
      totalDeducted += actuallyDeducted
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'RUN_PAYROLL_DEDUCTION',
      entity: 'PayrollDeduction',
      details: `Period: ${periodLabel}${outletId ? `, outlet ${outletId}` : ''}. Settled ${settlements.length} accounts, total ${totalDeducted}.`,
    },
  })

  return NextResponse.json({
    ok: true,
    period: periodLabel,
    settledCount: settlements.length,
    totalDeducted,
    settlements,
  })
}
