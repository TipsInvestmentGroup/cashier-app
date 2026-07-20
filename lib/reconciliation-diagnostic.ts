// Live self-diagnostic for the Excess/Reconciliation accounting model
// (objective #6 of the redesign brief). Read-only: it never mutates data — it
// re-runs the audit checks against live rows and returns findings in the
// Issue / Root cause / Affected modules / Recommended fix / Severity shape.
// Backs GET /api/reconciliation-diagnostic and the diagnostic page.
import { classForReason, type AccountingClass } from '@/lib/reconciliation-classification'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK'

export interface DiagnosticFinding {
  code: string
  issue: string
  rootCause: string
  affectedModules: string[]
  recommendedFix: string
  severity: Severity
  count: number
  sample?: string[]
}

/** Class implied by the legacy category alone (code ignored) — used to detect
 *  category drift against the code-first policy class. */
function categoryImpliedClass(category?: string | null): AccountingClass {
  return classForReason(null, category)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runReconciliationDiagnostic(prisma: any, opts?: { outletId?: string | null }): Promise<DiagnosticFinding[]> {
  const findings: DiagnosticFinding[] = []
  const outletId = opts?.outletId || null
  const collWhere = outletId ? { collection: { outletId } } : {}
  const cashWhere = outletId ? { cashRecon: { outletId } } : {}

  // ── C1: Difference Reasons whose stored accountingClass is null or stale ──
  const reasons = await prisma.excessReason.findMany()
  const staleClass = reasons.filter((r: any) => r.accountingClass !== classForReason(r.code, r.category)) // eslint-disable-line @typescript-eslint/no-explicit-any
  if (staleClass.length) {
    findings.push({
      code: 'REASON_CLASS_STALE',
      issue: `${staleClass.length} Difference Reason(s) have a missing or out-of-date accounting class.`,
      rootCause: 'accountingClass was never backfilled, or the policy class for this reason changed after it was stored.',
      affectedModules: ['Difference Reasons', 'Excess Recon', 'Finance'],
      recommendedFix: 'Run the excess-reason accounting-class backfill (seed) to re-derive class from the reason code.',
      severity: 'MEDIUM',
      count: staleClass.length,
      sample: staleClass.slice(0, 8).map((r: any) => `${r.code} (class=${r.accountingClass ?? 'null'}, should be ${classForReason(r.code, r.category)})`), // eslint-disable-line @typescript-eslint/no-explicit-any
    })
  }

  // ── C2: Category drift — money owed classified as audit-only (or vice-versa) ──
  // The Excess-Recon ledger still filters on the legacy `category`, so a reason
  // whose category implies a different class than its code-based policy will be
  // shown/settled under the wrong bucket (e.g. CUSTOMER_EXCESS stuck NON_PAYABLE
  // hides a real customer refund liability).
  const drift = reasons.filter((r: any) => categoryImpliedClass(r.category) !== classForReason(r.code, r.category)) // eslint-disable-line @typescript-eslint/no-explicit-any
  if (drift.length) {
    findings.push({
      code: 'REASON_CATEGORY_DRIFT',
      issue: `${drift.length} reason(s) have a legacy category that disagrees with their accounting class.`,
      rootCause: 'The reserved reason was seeded under an old category default and the reserved-code guard blocks fixing it in the UI (D3).',
      affectedModules: ['Difference Reasons', 'Excess Recon', 'Payables'],
      recommendedFix: 'Correct the reason category to match its policy class (migration), or switch the Excess-Recon ledger to filter on accountingClass.',
      severity: 'HIGH',
      count: drift.length,
      sample: drift.slice(0, 8).map((r: any) => `${r.code}: category ${r.category} -> implies ${categoryImpliedClass(r.category)}, policy ${classForReason(r.code, r.category)}`), // eslint-disable-line @typescript-eslint/no-explicit-any
    })
  }

  // ── C3/C4: excess rows unclassified or drifted from current policy ──
  const [collRows, cashRows] = await Promise.all([
    prisma.collectionExcess.findMany({ where: collWhere, select: { id: true, reason: true, category: true, accountingClass: true, paidAmount: true } }),
    prisma.cashReconExcess.findMany({ where: cashWhere, select: { id: true, cashReconId: true, reason: true, category: true, accountingClass: true, paidAmount: true } }),
  ])
  const allExcess = [...collRows.map((r: any) => ({ ...r, src: 'COLLECTION' })), ...cashRows.map((r: any) => ({ ...r, src: 'CASH_RECON' }))] // eslint-disable-line @typescript-eslint/no-explicit-any
  const unclassifiedRows = allExcess.filter((r) => !r.accountingClass)
  if (unclassifiedRows.length) {
    findings.push({
      code: 'EXCESS_ROW_UNCLASSIFIED',
      issue: `${unclassifiedRows.length} recorded excess row(s) have no accounting class (created before the classification layer).`,
      rootCause: 'Rows written before Phase 1 never got an accountingClass snapshot.',
      affectedModules: ['Excess Recon', 'Finance'],
      recommendedFix: 'Backfill accountingClass on historical CollectionExcess/CashReconExcess rows from their reason.',
      severity: 'LOW',
      count: unclassifiedRows.length,
    })
  }
  const driftedRows = allExcess.filter((r) => r.accountingClass && r.accountingClass !== classForReason(r.reason, r.category))
  if (driftedRows.length) {
    findings.push({
      code: 'EXCESS_ROW_CLASS_DRIFT',
      issue: `${driftedRows.length} excess row(s) have a snapshot class that no longer matches their reason's policy class.`,
      rootCause: 'The policy class for this reason changed after the row was recorded (snapshots are intentionally frozen).',
      affectedModules: ['Excess Recon', 'Finance'],
      recommendedFix: 'Review these rows; re-classify only if the original snapshot was wrong (do not rewrite settled history blindly).',
      severity: 'LOW',
      count: driftedRows.length,
      sample: driftedRows.slice(0, 8).map((r) => `${r.src}/${r.id}: ${r.reason} stored ${r.accountingClass}, policy ${classForReason(r.reason, r.category)}`),
    })
  }

  // ── C5: UNASSIGNED rows that were settled anyway ──
  const settledUnassigned = allExcess.filter((r) => r.reason === 'UNASSIGNED' && r.paidAmount > 0)
  if (settledUnassigned.length) {
    findings.push({
      code: 'SETTLED_WHILE_UNCLASSIFIED',
      issue: `${settledUnassigned.length} unclassified ("Needs reason") excess row(s) were settled before the classification gate existed.`,
      rootCause: 'Pre-gate settlements allowed paying out a row with no valid reason.',
      affectedModules: ['Excess Recon', 'Audit'],
      recommendedFix: 'Assign a correct reason to each historical row so its settlement is properly classified.',
      severity: 'MEDIUM',
      count: settledUnassigned.length,
      sample: settledUnassigned.slice(0, 8).map((r) => `${r.src}/${r.id}`),
    })
  }

  // ── C6: PAYABLE collection settlements missing their GL entry ──
  const settledPayableColl = collRows.filter((r: any) => r.paidAmount > 0 && classForReason(r.reason, r.category) === 'PAYABLE') // eslint-disable-line @typescript-eslint/no-explicit-any
  if (settledPayableColl.length) {
    const settlementEntries = await prisma.journalEntry.findMany({
      where: { sourceType: 'ExcessSettlement', sourceId: { in: settledPayableColl.map((r: any) => r.id) } }, // eslint-disable-line @typescript-eslint/no-explicit-any
      select: { sourceId: true },
    })
    const posted = new Set(settlementEntries.map((e: any) => e.sourceId)) // eslint-disable-line @typescript-eslint/no-explicit-any
    const missing = settledPayableColl.filter((r: any) => !posted.has(r.id)) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (missing.length) {
      findings.push({
        code: 'COLLECTION_SETTLEMENT_NOT_IN_GL',
        issue: `${missing.length} settled PAYABLE collection-excess row(s) have no settlement journal entry.`,
        rootCause: 'Settled before GL posting existed (pre-Phase 3a).',
        affectedModules: ['Excess Recon', 'General Ledger', 'Finance'],
        recommendedFix: 'Post catch-up Dr Excess-Payable / Cr Cash entries for these historical settlements, or accept as pre-cutover.',
        severity: 'MEDIUM',
        count: missing.length,
        sample: missing.slice(0, 8).map((r: any) => r.id), // eslint-disable-line @typescript-eslint/no-explicit-any
      })
    }
  }

  // ── C7: cash-recon excess without its recon-time GL payout entry (pre-D10) ──
  // Cash-recon excess now posts Dr Sales Revenue / Cr Cash at reconciliation
  // (D10). Reconciliations saved before that existed have excess rows but no
  // CashReconExcessPayout entry — re-saving the recon posts the catch-up.
  const reconIdsWithExcess: string[] = Array.from(new Set(cashRows.map((r: any) => r.cashReconId as string))) // eslint-disable-line @typescript-eslint/no-explicit-any
  if (reconIdsWithExcess.length) {
    const payoutEntries = await prisma.journalEntry.findMany({
      where: { sourceType: 'CashReconExcessPayout', sourceId: { in: reconIdsWithExcess } },
      select: { sourceId: true },
    })
    const posted = new Set(payoutEntries.map((e: any) => e.sourceId)) // eslint-disable-line @typescript-eslint/no-explicit-any
    const missingRecons = reconIdsWithExcess.filter((id) => !posted.has(id))
    if (missingRecons.length) {
      findings.push({
        code: 'CASH_RECON_PAYOUT_NOT_IN_GL',
        issue: `${missingRecons.length} cash reconciliation(s) with excess paid out have no GL payout entry.`,
        rootCause: 'The reconciliation was saved before cash-recon excess posted to the GL (pre-D10).',
        affectedModules: ['Cash Reconciliation', 'General Ledger'],
        recommendedFix: 'Re-save each affected reconciliation to post the catch-up Dr Sales Revenue / Cr Cash entry.',
        severity: 'MEDIUM',
        count: missingRecons.length,
        sample: missingRecons.slice(0, 8),
      })
    }
  }

  // ── C8: approved refunds with no GL entry (pre-D7) ──
  const refundWhere = outletId ? { outletId, approvalStatus: 'APPROVED' } : { approvalStatus: 'APPROVED' }
  const approvedRefunds = await prisma.excessRefund.findMany({ where: refundWhere, select: { id: true, journalEntryId: true } })
  const refundsNoGl = approvedRefunds.filter((r: any) => !r.journalEntryId) // eslint-disable-line @typescript-eslint/no-explicit-any
  if (refundsNoGl.length) {
    findings.push({
      code: 'REFUND_APPROVED_NOT_IN_GL',
      issue: `${refundsNoGl.length} approved customer refund(s) have no GL entry.`,
      rootCause: 'Approved before refund GL posting existed (pre-D7).',
      affectedModules: ['Excess Refunds', 'General Ledger', 'Daily Report'],
      recommendedFix: 'Post catch-up Dr Sales Revenue / Cr Cash entries for these historical refunds, or accept as pre-cutover.',
      severity: 'LOW',
      count: refundsNoGl.length,
      sample: refundsNoGl.slice(0, 8).map((r: any) => r.id), // eslint-disable-line @typescript-eslint/no-explicit-any
    })
  }

  if (findings.length === 0) {
    findings.push({
      code: 'ALL_CLEAR',
      issue: 'No reconciliation-accounting inconsistencies detected for the selected scope.',
      rootCause: '—',
      affectedModules: [],
      recommendedFix: '—',
      severity: 'OK',
      count: 0,
    })
  }
  return findings
}
