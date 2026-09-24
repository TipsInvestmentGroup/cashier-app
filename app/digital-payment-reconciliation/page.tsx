'use client'
import { ReconStandalone } from '@/components/recon/ReconStandalone'

// Reconciliation section — standalone, editable Digital Reconciliation (spec §2).
// Reuses the same DigitalReconForm the Close-the-Day wizard uses, with its own
// date/outlet pickers, and stacks the read-only custodian view beneath it.
export default function DigitalPaymentReconciliationPage() {
  return <ReconStandalone kind="digital" />
}
