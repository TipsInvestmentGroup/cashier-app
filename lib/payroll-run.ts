// The Universal Payroll Framework's RUN engine (Phase 3) — the first code that
// writes real financial records. A PayrollRun moves through an explicit state
// machine (DRAFT → CALCULATED → PENDING_APPROVAL → APPROVED → LOCKED → POSTED →
// [REVERSED]); a locked/posted run is never edited (corrections are a new run +
// a GL reversal). On POST it emits ONE balanced JournalEntry via
// lib/ledger.ts postJournalEntry and — for staff-purchase deductions — writes
// the matching PaidBill{PAYROLL} subledger rows and credits ACCOUNTS_RECEIVABLE,
// closing Credit-framework Phase 5. Run creation/posting is gated on the module
// being enabled. See docs/payroll-framework-design.md §9.
import crypto from 'crypto'
import type { Db } from '@/lib/ledger'
import { postJournalEntry, reverseJournalEntry, type JournalLineInput } from '@/lib/ledger'
import { resolveAccountId } from '@/lib/finance-mapping'
import { roundMoney } from '@/lib/utils'
import { resolvePayrollConfig, resolveCompanyId } from '@/lib/payroll-config'
import { resolveEffectivePeriodFields } from '@/lib/business-periods'
import { payrollPeriodForDate } from '@/lib/business-periods-shared'
import { previewPayslip } from '@/lib/payroll-calc'
import { syncCreditForPerson } from '@/lib/credit-ledger'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'
import { PAYROLL_ELIGIBLE_BILL_TYPES } from '@/lib/bill-types'

export interface RunUser { userId: string; role: string; name?: string | null }

// Terminal + intermediate states. Transitions are validated in transitionRun.
export const RUN_STATES = ['DRAFT', 'CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'LOCKED', 'POSTED', 'PAID', 'REVERSED'] as const
export const DEFAULT_APPROVER_ROLES = ['DIRECTOR', 'ADMIN']
const A_R_KEY = 'ACCOUNTS_RECEIVABLE'

async function writeAudit(db: Db, runId: string | null, action: string, user: RunUser, extra: { field?: string; previousValue?: string; newValue?: string; reason?: string } = {}) {
  await db.payrollAuditLog.create({
    data: { runId, action, userId: user.userId, userName: user.name ?? null, field: extra.field ?? null, previousValue: extra.previousValue ?? null, newValue: extra.newValue ?? null, reason: extra.reason ?? null },
  })
}

async function emitGlobalAudit(db: Db, user: RunUser, action: string, details: string) {
  await db.auditLog.create({ data: { userId: user.userId, action, entity: 'PayrollRun', details } })
}

/** Create a DRAFT run for a period + scope. Gated on the module being enabled. */
export async function createPayrollRun(db: Db, opts: { outletId?: string | null; payGroupId?: string | null; runType?: string; date?: Date; user: RunUser }) {
  const cfg = await resolvePayrollConfig(db, { outletId: opts.outletId })
  if (!cfg.enabled) throw new Error('Payroll module is disabled — enable it in Payroll Settings before creating a run')

  const companyId = await resolveCompanyId(db, opts.outletId)
  if (!companyId) throw new Error('No company resolved for this run')

  const date = opts.date ?? new Date()
  const fields = await resolveEffectivePeriodFields({ outletId: opts.outletId, date })
  const pp = payrollPeriodForDate(date, fields)
  const periodKey = `${pp.end.getFullYear()}-${String(pp.end.getMonth() + 1).padStart(2, '0')}`

  const run = await db.payrollRun.create({
    data: {
      companyId,
      outletId: opts.outletId ?? null,
      payGroupId: opts.payGroupId ?? null,
      runType: opts.runType ?? 'REGULAR',
      status: 'DRAFT',
      periodKey,
      periodStart: pp.start,
      periodEnd: pp.end,
      processingDate: pp.processingDate,
      paymentDate: pp.paymentDate,
      lockDate: pp.lockDate,
      currency: cfg.defaultCurrency,
      createdById: opts.user.userId,
    },
  })
  await writeAudit(db, run.id, 'CREATE', opts.user, { newValue: periodKey })
  await emitGlobalAudit(db, opts.user, 'CREATE_PAYROLL_RUN', `Run ${run.id} for ${periodKey}${opts.payGroupId ? ` (payGroup ${opts.payGroupId})` : ''}`)
  return run
}

/** (Re)calculate a DRAFT/CALCULATED run: rebuild every payslip from the current
 *  config, refresh totals, set CALCULATED. Idempotent (deletes prior payslips). */
export async function calculateRun(db: Db, runId: string, user: RunUser) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('Run not found')
  if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new Error(`Cannot recalculate a run in status ${run.status}`)

  const employees = await db.employee.findMany({
    where: { companyId: run.companyId, status: 'ACTIVE', ...(run.outletId ? { outletId: run.outletId } : {}), ...(run.payGroupId ? { payGroupId: run.payGroupId } : {}) },
    select: { id: true },
  })

  // Rebuild from scratch (cascade deletes lines).
  await db.payslip.deleteMany({ where: { runId } })

  let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployer = 0, count = 0
  for (const emp of employees) {
    const p = await previewPayslip(db, emp.id, { date: run.periodStart })
    const slip = await db.payslip.create({
      data: {
        runId,
        employeeId: emp.id,
        employeeNumber: p.employee.employeeNumber,
        categoryId: p.employee.categoryId,
        payGroupId: p.employee.payGroupId,
        personId: null, // resolved below from the employee record
        currency: p.currency,
        gross: p.gross,
        taxable: p.taxable,
        pensionable: p.pensionable,
        totalDeductions: p.totalDeductions,
        net: p.net,
        employerCost: p.employerCost,
        status: 'CALCULATED',
        warnings: p.warnings.length ? JSON.stringify(p.warnings) : null,
      },
    })
    // Snapshot the person link (for credit settlement at POST).
    const empRow = await db.employee.findUnique({ where: { id: emp.id }, select: { personId: true } })
    if (empRow?.personId) await db.payslip.update({ where: { id: slip.id }, data: { personId: empRow.personId } })

    await db.payslipLine.createMany({
      data: p.lines.map((l, i) => ({
        payslipId: slip.id,
        componentCode: l.code,
        componentName: l.name,
        componentType: l.componentType,
        bucket: l.bucket,
        amount: l.amount,
        taxable: l.taxable,
        pensionable: l.pensionable,
        glMappingKey: l.glMappingKey,
        sortOrder: i,
      })),
    })
    totalGross += p.gross; totalDeductions += p.totalDeductions; totalNet += p.net; totalEmployer += p.employerCost; count++
  }

  const updated = await db.payrollRun.update({
    where: { id: runId },
    data: {
      status: 'CALCULATED',
      totalGross: roundMoney(totalGross),
      totalDeductions: roundMoney(totalDeductions),
      totalNet: roundMoney(totalNet),
      totalEmployerCost: roundMoney(totalEmployer),
      employeeCount: count,
    },
  })
  await writeAudit(db, runId, 'CALCULATE', user, { newValue: `${count} payslips, net ${roundMoney(totalNet)}` })
  return updated
}

/** Resolve who may approve this run: the pay group's approverRoles, else the
 *  default supervisor roles. */
async function approverRolesFor(db: Db, run: { payGroupId: string | null }): Promise<string[]> {
  if (run.payGroupId) {
    const g = await db.payGroup.findUnique({ where: { id: run.payGroupId }, select: { approverRoles: true } })
    if (g?.approverRoles) {
      try { const roles = JSON.parse(g.approverRoles) as string[]; if (Array.isArray(roles) && roles.length) return roles } catch { /* fall through */ }
    }
  }
  return DEFAULT_APPROVER_ROLES
}

/**
 * Drive a run through its lifecycle. Validates the transition, enforces the
 * approver-role gate on APPROVE, and delegates POST/REVERSE to the money paths.
 */
export async function transitionRun(db: Db, runId: string, action: 'submit' | 'approve' | 'reject' | 'lock' | 'post' | 'reverse', user: RunUser, reason?: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('Run not found')

  const expect = (from: string[]) => { if (!from.includes(run.status)) throw new Error(`Cannot ${action} a run in status ${run.status}`) }

  switch (action) {
    case 'submit':
      expect(['CALCULATED'])
      await writeAudit(db, runId, 'SUBMIT', user)
      return db.payrollRun.update({ where: { id: runId }, data: { status: 'PENDING_APPROVAL' } })
    case 'approve': {
      expect(['PENDING_APPROVAL'])
      const roles = await approverRolesFor(db, run)
      // ADMIN always overrides (owner-full-access convention, cf. lib/rbac.ts).
      if (user.role !== 'ADMIN' && !roles.includes(user.role)) throw new Error(`Your role (${user.role}) is not authorized to approve this run`)
      await writeAudit(db, runId, 'APPROVE', user, { reason })
      return db.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date() } })
    }
    case 'reject':
      expect(['PENDING_APPROVAL'])
      await writeAudit(db, runId, 'REJECT', user, { reason })
      return db.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATED' } })
    case 'lock':
      expect(['APPROVED'])
      await writeAudit(db, runId, 'LOCK', user)
      return db.payrollRun.update({ where: { id: runId }, data: { status: 'LOCKED', lockedById: user.userId, lockedAt: new Date() } })
    case 'post':
      expect(['LOCKED'])
      return postRun(db, runId, user)
    case 'reverse':
      expect(['POSTED', 'PAID'])
      return reverseRun(db, runId, user, reason)
    default:
      throw new Error(`Unknown action ${action}`)
  }
}

/**
 * Post the run to the GL and settle staff-purchase recoveries. Runs inside a
 * $transaction so the JournalEntry, the PaidBill subledger rows, and the run
 * status all commit together (or not at all). Emits ONE balanced entry:
 *   Dr <earning glMappingKey|SALARY_EXPENSE>            (per key)
 *   Dr EMPLOYER_CONTRIB_EXPENSE                          (Σ employer)
 *     Cr NET_PAY_PAYABLE                                 (Σ net)
 *     Cr <deduction glMappingKey|PAYROLL_DEDUCTIONS_PAYABLE>  (per key)
 *     Cr <employer glMappingKey>                         (per key)
 * A deduction mapped to ACCOUNTS_RECEIVABLE is a staff-purchase recovery: its
 * amount is allocated across the employee's outstanding payroll-eligible signed
 * bills as PaidBill{PAYROLL}, and the credit ledger is resynced.
 */
async function postRun(db: Db, runId: string, user: RunUser) {
  return (db as unknown as { $transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> }).$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } })
    if (!run) throw new Error('Run not found')
    if (run.status !== 'LOCKED') throw new Error(`Cannot post a run in status ${run.status}`)

    const payslips = await tx.payslip.findMany({ where: { runId }, include: { lines: true } })

    const earningByKey = new Map<string, number>()
    const deductionByKey = new Map<string, number>()
    const employerByKey = new Map<string, number>()
    let netTotal = 0, employerTotal = 0
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, roundMoney((m.get(k) ?? 0) + v))

    for (const slip of payslips) {
      netTotal += slip.net
      for (const l of slip.lines) {
        if (l.amount <= 0) continue
        if (l.bucket === 'EARNING') add(earningByKey, l.glMappingKey || 'SALARY_EXPENSE', l.amount)
        else if (l.bucket === 'DEDUCTION') add(deductionByKey, l.glMappingKey || 'PAYROLL_DEDUCTIONS_PAYABLE', l.amount)
        else if (l.bucket === 'EMPLOYER') { add(employerByKey, l.glMappingKey || 'PAYROLL_DEDUCTIONS_PAYABLE', l.amount); employerTotal = roundMoney(employerTotal + l.amount) }
      }
    }
    netTotal = roundMoney(netTotal)

    const lines: JournalLineInput[] = []
    const acct = (key: string) => resolveAccountId(tx, { companyId: run.companyId, outletId: run.outletId, key })
    for (const [key, amt] of earningByKey) if (amt > 0) lines.push({ accountId: await acct(key), debit: amt, description: `Payroll ${run.periodKey} — ${key}` })
    if (employerTotal > 0) lines.push({ accountId: await acct('EMPLOYER_CONTRIB_EXPENSE'), debit: employerTotal, description: `Payroll ${run.periodKey} — employer contributions` })
    if (netTotal > 0) lines.push({ accountId: await acct('NET_PAY_PAYABLE'), credit: netTotal, description: `Payroll ${run.periodKey} — net pay` })
    for (const [key, amt] of deductionByKey) if (amt > 0) lines.push({ accountId: await acct(key), credit: amt, description: `Payroll ${run.periodKey} — ${key}` })
    for (const [key, amt] of employerByKey) if (amt > 0) lines.push({ accountId: await acct(key), credit: amt, description: `Payroll ${run.periodKey} — ${key} (employer)` })

    let journalEntryId: string | null = null
    if (lines.length) {
      const je = await postJournalEntry(tx, {
        companyId: run.companyId,
        entryDate: run.processingDate,
        sourceModule: 'PAYROLL',
        sourceType: 'PayrollRun',
        sourceId: run.id,
        description: `Payroll ${run.periodKey}${run.payGroupId ? ` (payGroup ${run.payGroupId})` : ''}`,
        createdById: user.userId,
        lines,
      })
      journalEntryId = je.id
    }

    // ── Staff-purchase recovery: settle the A/R-mapped deductions into the
    // signed-bill subledger so it stays consistent with the GL A/R credit. ──
    const billRef = `PAYROLL-RUN-${run.id}`
    for (const slip of payslips) {
      if (!slip.personId) continue
      const recovery = slip.lines.filter((l) => l.bucket === 'DEDUCTION' && (l.glMappingKey || '') === A_R_KEY && l.amount > 0)
      let toSettle = roundMoney(recovery.reduce((s, l) => s + l.amount, 0))
      if (toSettle <= 0) continue

      const bills = await tx.signedBill.findMany({
        where: { personId: slip.personId, billType: { in: [...PAYROLL_ELIGIBLE_BILL_TYPES] }, status: { not: 'PAID' } },
        include: { payments: { select: { amountPaid: true } } },
        orderBy: { date: 'asc' },
      })
      const settledBillIds: string[] = []
      for (const bill of bills) {
        if (toSettle <= 0) break
        const paid = bill.payments.reduce((s, p) => s + p.amountPaid, 0)
        const outstanding = roundMoney(bill.amount - paid)
        if (outstanding <= 0) continue
        const alloc = roundMoney(Math.min(toSettle, outstanding))
        const recordId = crypto.randomUUID()
        const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'PAID_BILL', bill.billType)
        const ref = await generateBillReference(tx, { recordId, sourceModel: 'PaidBill', billTypeCode, personId: slip.personId, outletId: bill.outletId })
        await tx.paidBill.create({
          data: {
            id: recordId,
            signedBillId: bill.id,
            personId: slip.personId,
            payerName: bill.personName,
            amountPaid: alloc,
            paymentMethod: 'PAYROLL',
            notes: `Payroll deduction (run ${run.periodKey})`,
            billRef,
            outletId: bill.outletId,
            cashierId: user.userId,
            internalBillId: ref.internalBillId,
            displayReference: ref.displayReference,
            billTypeConfigId: ref.billTypeConfigId,
          },
        })
        const agg = await tx.paidBill.aggregate({ where: { signedBillId: bill.id }, _sum: { amountPaid: true } })
        const totalPaid = agg._sum.amountPaid || 0
        await tx.signedBill.update({ where: { id: bill.id }, data: { status: totalPaid >= bill.amount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID' } })
        settledBillIds.push(bill.id)
        toSettle = roundMoney(toSettle - alloc)
      }
      // Stamp the audit ref on the recovery line(s) and resync the credit ledger.
      if (settledBillIds.length) {
        for (const l of recovery) await tx.payslipLine.update({ where: { id: l.id }, data: { sourceRef: `Settled ${settledBillIds.length} bill(s)` } })
        await syncCreditForPerson(tx, slip.personId)
      }
    }

    const updated = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'POSTED', journalEntryId, postedAt: new Date() } })
    await tx.payslip.updateMany({ where: { runId }, data: { status: 'LOCKED' } })
    await writeAudit(tx, runId, 'POST', user, { newValue: journalEntryId ? `JE ${journalEntryId}` : 'no financial impact' })
    await emitGlobalAudit(tx, user, 'POST_PAYROLL_RUN', `Run ${runId} (${run.periodKey}) posted: gross ${run.totalGross}, net ${run.totalNet}${journalEntryId ? `, JE ${journalEntryId}` : ''}`)
    return updated
  })
}

/**
 * Reverse a posted run: reverse its GL entry (equal-and-opposite, respecting
 * period locks), undo the PaidBill{PAYROLL} recoveries it created (so the
 * subledger matches), and mark the run REVERSED. Corrections are then a fresh
 * CORRECTION run — the original is never edited.
 */
async function reverseRun(db: Db, runId: string, user: RunUser, reason?: string) {
  return (db as unknown as { $transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> }).$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } })
    if (!run) throw new Error('Run not found')
    if (!['POSTED', 'PAID'].includes(run.status)) throw new Error(`Cannot reverse a run in status ${run.status}`)

    if (run.journalEntryId) await reverseJournalEntry(tx, { journalEntryId: run.journalEntryId, userId: user.userId, reason: reason ?? `Payroll run ${run.periodKey} reversed` })

    // Undo this run's payroll payments and restore bill statuses.
    const billRef = `PAYROLL-RUN-${run.id}`
    const payments = await tx.paidBill.findMany({ where: { billRef }, select: { id: true, signedBillId: true, personId: true } })
    const affectedBills = new Set<string>()
    const affectedPersons = new Set<string>()
    for (const p of payments) { if (p.signedBillId) affectedBills.add(p.signedBillId); if (p.personId) affectedPersons.add(p.personId) }
    await tx.paidBill.deleteMany({ where: { billRef } })
    for (const billId of affectedBills) {
      const agg = await tx.paidBill.aggregate({ where: { signedBillId: billId }, _sum: { amountPaid: true } })
      const bill = await tx.signedBill.findUnique({ where: { id: billId }, select: { amount: true } })
      const totalPaid = agg._sum.amountPaid || 0
      if (bill) await tx.signedBill.update({ where: { id: billId }, data: { status: totalPaid >= bill.amount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID' } })
    }
    for (const personId of affectedPersons) await syncCreditForPerson(tx, personId)

    const updated = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'REVERSED', reversedAt: new Date() } })
    await writeAudit(tx, runId, 'REVERSE', user, { reason })
    await emitGlobalAudit(tx, user, 'REVERSE_PAYROLL_RUN', `Run ${runId} (${run.periodKey}) reversed${reason ? `: ${reason}` : ''}`)
    return updated
  })
}
