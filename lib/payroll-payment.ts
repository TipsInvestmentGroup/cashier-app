// Payout & settlement for the Universal Payroll Framework (Phase 5). A POSTED
// run left a NET_PAY_PAYABLE liability on the GL; a PaymentBatch turns each
// payslip's net into a payout instruction, exports a file, and — when marked
// PAID — posts the settlement entry (Dr NET_PAY_PAYABLE / Cr Cash·Bank·MobileMoney)
// that clears the liability, moving the run to PAID. See docs/payroll-framework-design.md §9-10.
import type { Db } from '@/lib/ledger'
import { postJournalEntry, type JournalLineInput } from '@/lib/ledger'
import { resolveAccountId } from '@/lib/finance-mapping'
import { roundMoney } from '@/lib/utils'

export interface PayUser { userId: string; role: string; name?: string | null }

const METHOD_TO_KEY: Record<string, string> = { BANK: 'BANK', MOBILE_MONEY: 'MOBILE_MONEY', CASH: 'CASH' }

/** Resolve a display payee name for an employee (person, else login, else number). */
async function payeeNameFor(db: Db, employeeId: string, employeeNumber: string | null): Promise<{ name: string; method: string; ref: string | null }> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { personId: true, userId: true, paymentMethod: true, bankRef: true, mobileMoneyRef: true } })
  let name = employeeNumber ? `Employee ${employeeNumber}` : 'Employee'
  if (emp?.personId) {
    const person = await db.person.findUnique({ where: { id: emp.personId }, select: { name: true } })
    if (person?.name) name = person.name
  } else if (emp?.userId) {
    const user = await db.user.findUnique({ where: { id: emp.userId }, select: { name: true } })
    if (user?.name) name = user.name
  }
  const method = emp?.paymentMethod || 'BANK'
  const ref = method === 'MOBILE_MONEY' ? emp?.mobileMoneyRef ?? null : emp?.bankRef ?? null
  return { name, method, ref }
}

/**
 * Create a payout batch for a POSTED run: one PaymentInstruction per payslip with
 * net > 0. Idempotent-guarded — refuses if a non-reversed batch already exists.
 */
export async function createPaymentBatch(db: Db, runId: string, user: PayUser) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('Run not found')
  if (run.status !== 'POSTED') throw new Error(`Cannot pay a run in status ${run.status} (must be POSTED)`)
  const existing = await db.paymentBatch.findFirst({ where: { runId, status: { not: 'REVERSED' } } })
  if (existing) throw new Error('A payment batch already exists for this run')

  const payslips = await db.payslip.findMany({ where: { runId, net: { gt: 0 } } })
  const methods = new Set<string>()
  let total = 0
  const instructions: { payslipId: string; employeeId: string; payeeName: string; method: string; payeeRef: string | null; amount: number }[] = []
  for (const s of payslips) {
    const { name, method, ref } = await payeeNameFor(db, s.employeeId, s.employeeNumber)
    methods.add(method)
    total = roundMoney(total + s.net)
    instructions.push({ payslipId: s.id, employeeId: s.employeeId, payeeName: name, method, payeeRef: ref, amount: s.net })
  }
  const batchMethod = methods.size === 0 ? 'BANK' : methods.size === 1 ? [...methods][0] : 'MIXED'

  return db.paymentBatch.create({
    data: {
      runId, companyId: run.companyId, status: 'PENDING', method: batchMethod,
      totalAmount: total, employeeCount: instructions.length, createdById: user.userId,
      instructions: { create: instructions },
    },
    include: { instructions: true },
  })
}

/** Build a CSV payout file from a batch's instructions. */
export function buildPaymentCsv(batch: { instructions: { payeeName: string; method: string; payeeRef: string | null; amount: number }[] }): string {
  const rows = [['Payee', 'Method', 'Reference', 'Amount']]
  for (const i of batch.instructions) rows.push([i.payeeName, i.method, i.payeeRef ?? '', String(i.amount)])
  // Quote fields that contain a comma/quote; escape embedded quotes.
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
}

/** Mark a batch EXPORTED (records that the file was generated). */
export async function markBatchExported(db: Db, batchId: string) {
  return db.paymentBatch.update({ where: { id: batchId }, data: { status: 'EXPORTED', exportedAt: new Date() } })
}

/**
 * Mark a batch PAID: post the settlement GL entry (Dr NET_PAY_PAYABLE / Cr the
 * cash/bank/mobile account per method) and move the run to PAID. In a transaction.
 */
export async function markBatchPaid(db: Db, batchId: string, user: PayUser) {
  return (db as unknown as { $transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> }).$transaction(async (tx) => {
    const batch = await tx.paymentBatch.findUnique({ where: { id: batchId }, include: { instructions: true } })
    if (!batch) throw new Error('Payment batch not found')
    if (!['PENDING', 'EXPORTED'].includes(batch.status)) throw new Error(`Cannot pay a batch in status ${batch.status}`)
    const run = await tx.payrollRun.findUnique({ where: { id: batch.runId } })
    if (!run) throw new Error('Run not found')

    const byMethod = new Map<string, number>()
    for (const i of batch.instructions) byMethod.set(i.method, roundMoney((byMethod.get(i.method) ?? 0) + i.amount))
    const total = roundMoney([...byMethod.values()].reduce((s, v) => s + v, 0))

    let journalEntryId: string | null = null
    if (total > 0) {
      const lines: JournalLineInput[] = [{ accountId: await resolveAccountId(tx, { companyId: batch.companyId, outletId: run.outletId, key: 'NET_PAY_PAYABLE' }), debit: total, description: `Payroll ${run.periodKey} — net pay settled` }]
      for (const [method, amt] of byMethod) {
        if (amt <= 0) continue
        const key = METHOD_TO_KEY[method] ?? 'BANK'
        lines.push({ accountId: await resolveAccountId(tx, { companyId: batch.companyId, outletId: run.outletId, key }), credit: amt, description: `Payroll ${run.periodKey} — paid via ${method}` })
      }
      const je = await postJournalEntry(tx, { companyId: batch.companyId, entryDate: run.paymentDate, sourceModule: 'PAYROLL', sourceType: 'PaymentBatch', sourceId: batch.id, description: `Payroll ${run.periodKey} — payout`, createdById: user.userId, lines })
      journalEntryId = je.id
    }

    await tx.paymentInstruction.updateMany({ where: { batchId }, data: { status: 'PAID' } })
    await tx.payslip.updateMany({ where: { runId: batch.runId }, data: { status: 'PAID' } })
    await tx.payrollRun.update({ where: { id: batch.runId }, data: { status: 'PAID' } })
    return tx.paymentBatch.update({ where: { id: batchId }, data: { status: 'PAID', journalEntryId, paidAt: new Date() } })
  })
}
