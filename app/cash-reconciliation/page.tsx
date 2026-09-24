'use client'
import { ReconStandalone } from '@/components/recon/ReconStandalone'

// Reconciliation section — standalone, editable Cash Reconciliation (spec §2).
// Reuses the same CashReconForm the Close-the-Day wizard uses, with its own
// date/outlet pickers, and stacks the read-only custodian view beneath it.
export default function CashReconciliationPage() {
  return <ReconStandalone kind="cash" />
}
