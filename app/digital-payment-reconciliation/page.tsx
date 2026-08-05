'use client'
import { ReconciliationView } from '@/components/ReconciliationView'

// §1 nav item "Digital Payment Reconciliation" — the custodian-facing view for
// Digital Expenses funds. Reconciles the linked bank/GL balance against the
// expense payments booked from the fund and surfaces unverified digital
// payments; proof-of-payment verification stays in Finance → Payment
// Verifications, which this links to.
export default function DigitalPaymentReconciliationPage() {
  return (
    <ReconciliationView
      fundClass="DIGITAL"
      title="Digital Payment Reconciliation"
      blurb="Tie each digital fund's balance to its linked bank account and check every payment has proof."
    />
  )
}
