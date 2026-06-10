import { prisma } from '@/lib/prisma'
import { startOfMonth, endOfMonth, parse, isValid } from 'date-fns'

/**
 * Payroll Deduction Report computation.
 *
 * Credit limits apply to ADMIN and DIRECTOR signed bills:
 *   spent      = monthly gross consumption (monthly mode) or unpaid balance (all-time)
 *   overLimit  = max(0, spent - creditLimit)   -> deducted from payroll
 * STAFF_LOSS bills are fully recoverable (whole outstanding amount).
 *
 * Modes (via `month`):
 *   - 'YYYY-MM' : MONTHLY consumption vs the monthly credit limit (gross, any status)
 *   - 'all'/undefined : ALL-TIME outstanding (amount - payments)
 */
export interface PayrollRow {
  personName: string
  category: string
  billType: string
  creditLimit: number
  spent: number
  deduction: number
}

export async function computePayrollReport(opts: { month?: string | null; outletId?: string | null }) {
  const monthParam = opts.month ?? null

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
  if (opts.outletId) where.outletId = opts.outletId
  if (monthly) where.date = { gte: monthStart, lte: monthEnd }
  else where.status = { not: 'PAID' }

  const bills = await prisma.signedBill.findMany({
    where,
    include: {
      person: { select: { creditLimit: true } },
      payments: { select: { amountPaid: true, paymentMethod: true } },
    },
  })

  type Acc = {
    personName: string
    billType: string
    creditLimit: number
    spent: number
    outstanding: number
    payrollPaid: number
    billCount: number
  }
  const map = new Map<string, Acc>()

  for (const b of bills) {
    const paid = b.payments.reduce((s, p) => s + p.amountPaid, 0)
    const payrollPaid = b.payments.filter((p) => p.paymentMethod === 'PAYROLL').reduce((s, p) => s + p.amountPaid, 0)
    const outstanding = b.amount - paid
    const spent = monthly ? b.amount : outstanding
    if (spent <= 0 && outstanding <= 0) continue
    const key = `${b.personId || `name:${b.personName}`}|${b.billType}`
    const limit = b.person?.creditLimit ?? 0
    const cur = map.get(key) || {
      personName: b.personName,
      billType: b.billType,
      creditLimit: limit,
      spent: 0,
      outstanding: 0,
      payrollPaid: 0,
      billCount: 0,
    }
    cur.spent += spent
    cur.outstanding += Math.max(0, outstanding)
    cur.payrollPaid += payrollPaid
    cur.billCount += 1
    if (limit > cur.creditLimit) cur.creditLimit = limit
    map.set(key, cur)
  }

  const accounts = [...map.values()].map((a) => {
    const isStaff = a.billType === 'STAFF_LOSS'
    const overLimit = isStaff ? a.outstanding : Math.max(0, a.spent - a.creditLimit)
    const recoverable = isStaff
      ? a.outstanding
      : monthly
        ? Math.min(Math.max(0, overLimit - a.payrollPaid), a.outstanding)
        : Math.min(overLimit, a.outstanding)
    const balance = a.spent - a.creditLimit
    return { ...a, balance, overLimit, recoverable, exceeded: !isStaff && a.spent > a.creditLimit }
  })

  const creditAccounts = accounts
    .filter((a) => a.billType === 'ADMIN' || a.billType === 'DIRECTOR')
    .sort((x, y) => y.overLimit - x.overLimit || y.spent - x.spent)

  const staffLosses = accounts
    .filter((a) => a.billType === 'STAFF_LOSS' && a.outstanding > 0)
    .sort((x, y) => y.outstanding - x.outstanding)

  const rows: PayrollRow[] = [
    ...creditAccounts
      .filter((a) => a.recoverable > 0)
      .map((a) => ({
        personName: a.personName,
        category: a.billType === 'DIRECTOR' ? 'Director Over-Limit' : 'Admin Over-Limit',
        billType: a.billType,
        creditLimit: a.creditLimit,
        spent: a.spent,
        deduction: a.recoverable,
      })),
    ...staffLosses.map((a) => ({
      personName: a.personName,
      category: 'Staff Loss',
      billType: 'STAFF_LOSS',
      creditLimit: 0,
      spent: a.outstanding,
      deduction: a.outstanding,
    })),
  ]

  const totals = {
    overLimit: rows.filter((r) => r.billType !== 'STAFF_LOSS').reduce((s, r) => s + r.deduction, 0),
    staffLoss: rows.filter((r) => r.billType === 'STAFF_LOSS').reduce((s, r) => s + r.deduction, 0),
    total: rows.reduce((s, r) => s + r.deduction, 0),
    exceededCount: rows.filter((r) => r.billType !== 'STAFF_LOSS').length,
    staffLossCount: rows.filter((r) => r.billType === 'STAFF_LOSS').length,
  }

  const period = {
    mode: monthly ? 'monthly' : 'all-time',
    month: monthly ? monthParam : null,
    start: monthStart?.toISOString() ?? null,
    end: monthEnd?.toISOString() ?? null,
  }

  return { creditAccounts, staffLosses, rows, totals, period }
}
