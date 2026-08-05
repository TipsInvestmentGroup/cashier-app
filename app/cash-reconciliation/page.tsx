'use client'
import { ReconciliationView } from '@/components/ReconciliationView'

// §1 nav item "Cash Reconciliation" — the custodian-facing view for Cashier
// Cash funds. Read-only reconciliation of the drawer's ledger against its §5
// computed position; physical-count entry stays in the existing Cash
// Reconciliation flow on the Daily screen, which this links to.
export default function CashReconciliationPage() {
  return (
    <ReconciliationView
      fundClass="CASHIER_CASH"
      title="Cash Reconciliation"
      blurb="Confirm each cashier fund's ledger agrees with its live cash position, and see the last physical count."
    />
  )
}
