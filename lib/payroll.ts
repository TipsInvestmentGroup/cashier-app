import { prisma } from '@/lib/prisma'
import { PAYROLL_ELIGIBLE_BILL_TYPES, CREDIT_LIMIT_BILL_TYPES, STAFF_LOSS_TYPE } from '@/lib/bill-types'
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
    billType: { in: [...PAYROLL_ELIGIBLE_BILL_TYPES] },
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
    const isStaff = a.billType === STAFF_LOSS_TYPE
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
    .filter((a) => (CREDIT_LIMIT_BILL_TYPES as readonly string[]).includes(a.billType))
    .sort((x, y) => y.overLimit - x.overLimit || y.spent - x.spent)

  const staffLosses = accounts
    .filter((a) => a.billType === STAFF_LOSS_TYPE && a.outstanding > 0)
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
      billType: STAFF_LOSS_TYPE,
      creditLimit: 0,
      spent: a.outstanding,
      deduction: a.outstanding,
    })),
  ]

  const totals = {
    overLimit: rows.filter((r) => r.billType !== STAFF_LOSS_TYPE).reduce((s, r) => s + r.deduction, 0),
    staffLoss: rows.filter((r) => r.billType === STAFF_LOSS_TYPE).reduce((s, r) => s + r.deduction, 0),
    total: rows.reduce((s, r) => s + r.deduction, 0),
    exceededCount: rows.filter((r) => r.billType !== STAFF_LOSS_TYPE).length,
    staffLossCount: rows.filter((r) => r.billType === STAFF_LOSS_TYPE).length,
  }

  const period = {
    mode: monthly ? 'monthly' : 'all-time',
    month: monthly ? monthParam : null,
    start: monthStart?.toISOString() ?? null,
    end: monthEnd?.toISOString() ?? null,
  }

  return { creditAccounts, staffLosses, rows, totals, period }
}

export interface AdminDirectorBillLine {
  id: string
  date: string
  amount: number
  dueDate: string | null
  status: string
  outletName: string
  description: string | null
}

export interface AdminDirectorAccount {
  personId: string | null
  personName: string
  billType: string
  creditLimit: number
  totalSignedBills: number
  remainingBalance: number
  amountExceeding: number
  payrollPaid: number
  deductionStatus: 'Within Limit' | 'Pending Deduction' | 'Deducted'
  billCount: number
  bills: AdminDirectorBillLine[]
}

/**
 * Admin & Director Bills report: one row per person with their signed-bill
 * total, credit limit, remaining balance, and payroll-deduction status,
 * plus the underlying bills for drill-down. Reuses the same monthly/all-time
 * modes as computePayrollReport.
 */
export async function computeAdminDirectorBills(opts: { month?: string | null; outletId?: string | null }) {
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
    billType: { in: [...CREDIT_LIMIT_BILL_TYPES] },
  }
  if (opts.outletId) where.outletId = opts.outletId
  if (monthly) where.date = { gte: monthStart, lte: monthEnd }
  else where.status = { not: 'PAID' }

  const bills = await prisma.signedBill.findMany({
    where,
    include: {
      person: { select: { creditLimit: true } },
      outlet: { select: { name: true } },
      payments: { select: { amountPaid: true, paymentMethod: true } },
    },
    orderBy: { date: 'desc' },
  })

  type Acc = {
    personId: string | null
    personName: string
    billType: string
    creditLimit: number
    totalSignedBills: number
    payrollPaid: number
    billCount: number
    bills: AdminDirectorBillLine[]
  }
  const map = new Map<string, Acc>()

  for (const b of bills) {
    const paid = b.payments.reduce((s, p) => s + p.amountPaid, 0)
    const payrollPaid = b.payments.filter((p) => p.paymentMethod === 'PAYROLL').reduce((s, p) => s + p.amountPaid, 0)
    const outstanding = b.amount - paid
    const spentAmount = monthly ? b.amount : outstanding
    if (spentAmount <= 0 && outstanding <= 0) continue
    const key = `${b.personId || `name:${b.personName}`}|${b.billType}`
    const limit = b.person?.creditLimit ?? 0
    const cur = map.get(key) || {
      personId: b.personId,
      personName: b.personName,
      billType: b.billType,
      creditLimit: limit,
      totalSignedBills: 0,
      payrollPaid: 0,
      billCount: 0,
      bills: [],
    }
    cur.totalSignedBills += spentAmount
    cur.payrollPaid += payrollPaid
    cur.billCount += 1
    cur.bills.push({
      id: b.id,
      date: b.date.toISOString(),
      amount: b.amount,
      dueDate: b.dueDate?.toISOString() ?? null,
      status: b.status,
      outletName: b.outlet.name,
      description: b.description ?? null,
    })
    if (limit > cur.creditLimit) cur.creditLimit = limit
    map.set(key, cur)
  }

  const accounts: AdminDirectorAccount[] = [...map.values()]
    .map((a) => {
      const amountExceeding = Math.max(0, a.totalSignedBills - a.creditLimit)
      const remainingBalance = a.creditLimit - a.totalSignedBills
      const deductionStatus: AdminDirectorAccount['deductionStatus'] =
        amountExceeding <= 0 ? 'Within Limit' : a.payrollPaid >= amountExceeding ? 'Deducted' : 'Pending Deduction'
      return { ...a, amountExceeding, remainingBalance, deductionStatus }
    })
    .sort((x, y) => y.amountExceeding - x.amountExceeding || y.totalSignedBills - x.totalSignedBills)

  const totals = {
    totalSignedBills: accounts.reduce((s, a) => s + a.totalSignedBills, 0),
    totalExceeding: accounts.reduce((s, a) => s + a.amountExceeding, 0),
    exceededCount: accounts.filter((a) => a.amountExceeding > 0).length,
    pendingCount: accounts.filter((a) => a.deductionStatus === 'Pending Deduction').length,
  }

  const period = {
    mode: monthly ? 'monthly' : 'all-time',
    month: monthly ? monthParam : null,
  }

  return { accounts, totals, period }
}
