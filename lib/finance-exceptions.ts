// Data Validation & Data Quality — Stage 5. A live scan (not a stored
// snapshot, same "compute at request time" convention as the AP/AR aging
// reports) for the specific, concrete issues below. This is NOT an
// exhaustive rules engine — it covers what's cheaply and reliably
// detectable from data this app actually has today. Extending it means
// adding another checker function to CHECKS, not redesigning anything.
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { companyAccountBalance } from './finance-banking'
import { REQUEST_BILL_TYPES } from './bill-types'

export type ExceptionSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface FinanceException {
  id: string
  type: string
  severity: ExceptionSeverity
  message: string
  entityType: string
  entityId: string
  link: string
}

async function checkGrnsNeedingCosting(companyId: string): Promise<FinanceException[]> {
  const grns = await prisma.grn.findMany({ where: { companyId, needsCosting: true }, select: { id: true, grnNumber: true } })
  return grns.map((g) => ({
    id: `grn-costing-${g.id}`, type: 'GRN_NEEDS_COSTING', severity: 'MEDIUM' as const,
    message: `GRN ${g.grnNumber} was received with no cost — Inventory/AP accrual was never posted`,
    entityType: 'Grn', entityId: g.id, link: '/finance/payables',
  }))
}

async function checkNegativeAccountBalances(companyId: string): Promise<FinanceException[]> {
  const accounts = await prisma.companyPaymentAccount.findMany({ where: { companyId, isActive: true } })
  const results: FinanceException[] = []
  for (const a of accounts) {
    const balance = await companyAccountBalance(prisma, a.id)
    if (balance < 0) {
      results.push({
        id: `account-negative-${a.id}`, type: 'NEGATIVE_ACCOUNT_BALANCE', severity: 'HIGH',
        message: `${a.accountName} has a negative balance (${balance}) — review for a missing deposit or an overdraft`,
        entityType: 'CompanyPaymentAccount', entityId: a.id, link: '/finance/banking',
      })
    }
  }
  return results
}

async function checkUnbalancedJournalEntries(companyId: string): Promise<FinanceException[]> {
  const entries = await prisma.journalEntry.findMany({ where: { companyId }, include: { lines: true } })
  const results: FinanceException[] = []
  for (const e of entries) {
    const debit = roundMoney(e.lines.reduce((s, l) => s + l.debit, 0))
    const credit = roundMoney(e.lines.reduce((s, l) => s + l.credit, 0))
    if (debit !== credit) {
      results.push({
        id: `je-unbalanced-${e.id}`, type: 'UNBALANCED_JOURNAL_ENTRY', severity: 'CRITICAL',
        message: `Journal entry ${e.entryNumber} does not balance (debit ${debit} vs credit ${credit}) — this should never happen and indicates a bug`,
        entityType: 'JournalEntry', entityId: e.id, link: '/finance/ledger',
      })
    }
  }
  return results
}

async function checkDuplicateSupplierInvoices(companyId: string): Promise<FinanceException[]> {
  const invoices = await prisma.supplierInvoice.findMany({
    where: { companyId, supplierInvoiceRef: { not: null }, status: { not: 'CANCELLED' } },
    select: { id: true, invoiceNumber: true, supplierId: true, supplierInvoiceRef: true },
  })
  const seen = new Map<string, typeof invoices>()
  for (const inv of invoices) {
    const key = `${inv.supplierId}|${inv.supplierInvoiceRef}`
    seen.set(key, [...(seen.get(key) || []), inv])
  }
  const results: FinanceException[] = []
  for (const group of seen.values()) {
    if (group.length <= 1) continue
    for (const inv of group) {
      results.push({
        id: `dup-invoice-${inv.id}`, type: 'DUPLICATE_SUPPLIER_INVOICE', severity: 'HIGH',
        message: `Invoice ${inv.invoiceNumber} shares the same supplier invoice reference as ${group.length - 1} other invoice(s) — check for a duplicate entry`,
        entityType: 'SupplierInvoice', entityId: inv.id, link: '/finance/payables',
      })
    }
  }
  return results
}

async function checkDuplicateSuppliers(): Promise<FinanceException[]> {
  const suppliers = await prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true } })
  const seen = new Map<string, typeof suppliers>()
  for (const s of suppliers) {
    const key = s.name.trim().toLowerCase()
    seen.set(key, [...(seen.get(key) || []), s])
  }
  const results: FinanceException[] = []
  for (const group of seen.values()) {
    if (group.length <= 1) continue
    for (const s of group) {
      results.push({
        id: `dup-supplier-${s.id}`, type: 'DUPLICATE_SUPPLIER', severity: 'MEDIUM',
        message: `Supplier "${s.name}" looks like a duplicate of ${group.length - 1} other supplier record(s) with the same name`,
        entityType: 'Supplier', entityId: s.id, link: '/finance/payables',
      })
    }
  }
  return results
}

async function checkStalePendingApprovals(companyId: string): Promise<FinanceException[]> {
  const cutoff = new Date(Date.now() - 3 * 86400000)
  const bills = await prisma.signedBill.findMany({
    where: { billType: { in: [...REQUEST_BILL_TYPES] }, approvalStatus: 'PENDING', createdAt: { lte: cutoff }, outlet: { companyId } },
    select: { id: true, billType: true, personName: true, amount: true, createdAt: true },
  })
  return bills.map((b) => ({
    id: `stale-approval-${b.id}`, type: 'STALE_PENDING_APPROVAL', severity: 'MEDIUM' as const,
    message: `${b.billType} bill for ${b.personName} (${b.amount}) has been awaiting approval for over 3 days`,
    entityType: 'SignedBill', entityId: b.id, link: '/receivables',
  }))
}

async function checkStaleReconciliations(companyId: string): Promise<FinanceException[]> {
  const cutoff = new Date(Date.now() - 7 * 86400000)
  const recs = await prisma.accountReconciliation.findMany({
    where: { companyPaymentAccount: { companyId }, status: 'PENDING_APPROVAL', submittedAt: { lte: cutoff } },
    include: { companyPaymentAccount: { select: { accountName: true } } },
  })
  return recs.map((r) => ({
    id: `stale-recon-${r.id}`, type: 'STALE_PENDING_RECONCILIATION', severity: 'LOW' as const,
    message: `Reconciliation for ${r.companyPaymentAccount.accountName} has been awaiting approval for over 7 days`,
    entityType: 'AccountReconciliation', entityId: r.id, link: '/finance/reconciliation',
  }))
}

const CHECKS = [
  checkGrnsNeedingCosting, checkNegativeAccountBalances, checkUnbalancedJournalEntries,
  checkDuplicateSupplierInvoices, checkStalePendingApprovals, checkStaleReconciliations,
]

/** Runs every checker and returns the combined exception list, most severe
 *  first. checkDuplicateSuppliers isn't companyId-scoped (Supplier has no
 *  company dimension in this app), so it's run once regardless of company. */
export async function scanExceptions(companyId: string): Promise<FinanceException[]> {
  const results = await Promise.all([...CHECKS.map((check) => check(companyId)), checkDuplicateSuppliers()])
  const severityRank: Record<ExceptionSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  return results.flat().sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
}
